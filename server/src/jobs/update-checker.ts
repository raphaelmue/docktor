import cron from "node-cron"
import semver from "semver"
import type {DockerExecutor} from "../infrastructure/docker-executor.js"
import {dockerExecutor} from "../infrastructure/docker-executor.js"
import type {StateBroadcaster} from "../lib/state-broadcaster.js"
import {stateEventBroadcaster} from "../lib/state-broadcaster.js"

export const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000 // 6 hours

// ---------------------------------------------------------------------------
// Pure exported functions (unit-testable without class instantiation)
// ---------------------------------------------------------------------------

export function normalizeImageRef(imageRef: string): string {
    let ref = imageRef
        .replace(/^docker\.io\/library\//, "")
        .replace(/^docker\.io\//, "")
    if (!ref.includes(":")) ref = ref + ":latest"
    return ref
}

/**
 * Reconstructs the canonical imageRef for a service's stored image + tag
 * columns, using the same spelling as `findAllImageRefs()` so callers that
 * need to look up an ImageUpdateCheck row for a specific service (e.g. the
 * stack detail route's badge lookup) always agree with what was persisted.
 * Returns null for build-only services (no image), which must be excluded
 * from the checked image set rather than producing a guaranteed-failure ref.
 */
export function buildImageRefFromService(
    image: string | null | undefined,
    imageTag: string | null | undefined,
): string | null {
    if (!image || !image.trim()) return null
    const ref = imageTag ? `${image}:${imageTag}` : image
    return normalizeImageRef(ref)
}

export function detectRegistry(imageRef: string): "dockerhub" | "ghcr" | "private" {
    const normalized = normalizeImageRef(imageRef)
    const firstSlash = normalized.indexOf("/")
    if (firstSlash === -1) return "dockerhub"
    const host = normalized.substring(0, firstSlash)
    if (!host.includes(".")) return "dockerhub"
    if (host === "ghcr.io") return "ghcr"
    return "private"
}

export function parseDateTag(tag: string): Date | null {
    const DATE_PATTERNS = [
        /^(\d{4})-(\d{2})-(\d{2})$/,
        /^(\d{4})(\d{2})(\d{2})$/,
        /^(\d{4})(\d{2})$/,
    ]
    for (const pattern of DATE_PATTERNS) {
        const m = pattern.exec(tag)
        if (m) {
            const year = m[1]
            const month = m[2] ?? "01"
            const day = m[3] ?? "01"
            const d = new Date(`${year}-${month}-${day}`)
            if (!isNaN(d.getTime())) return d
        }
    }
    return null
}

export type CompareResult = "newer" | "same" | "older" | "unknown"

export interface CompareOptions {
    currentDigest?: string | null
    latestDigest?: string | null
}

export function compareVersions(
    currentTag: string,
    latestTag: string,
    opts?: CompareOptions,
): CompareResult {
    // 1. Try date tag first — date strings would be miscoerced by semver (e.g.
    //    semver.coerce("2024-01-01") yields "2024.0.0" losing month and day)
    const currentDate = parseDateTag(currentTag)
    const latestDate = parseDateTag(latestTag)
    if (currentDate && latestDate) {
        if (latestDate > currentDate) return "newer"
        if (latestDate.getTime() === currentDate.getTime()) return "same"
        return "older"
    }

    // 2. Try semver (with coerce for truncated tags like "28", "1.25")
    const current = semver.coerce(currentTag)
    const latest = semver.coerce(latestTag)
    if (current && latest) {
        if (semver.gt(latest, current)) return "newer"
        if (semver.eq(latest, current)) return "same"
        return "older"
    }

    // 3. Digest fallback
    if (opts?.currentDigest && opts?.latestDigest) {
        if (opts.latestDigest !== opts.currentDigest) return "newer"
        return "same"
    }

    return "unknown"
}

/**
 * Pure function: given image update check records and a total check interval,
 * returns the next image due for checking (never-checked first, then oldest).
 *
 * @param images - Array of image update check records (imageRef + lastCheckedAt)
 * @param checkIntervalMs - Total check interval in ms (e.g. 6 * 60 * 60 * 1000)
 * @returns The first image due, or null if all are within their stagger window
 */
export function getNextImageToCheck(
    images: Array<{imageRef: string; lastCheckedAt: Date | null}>,
    checkIntervalMs: number,
): {imageRef: string; lastCheckedAt: Date | null} | null {
    if (images.length === 0) return null

    const staggerMs = checkIntervalMs / images.length
    const cutoff = new Date(Date.now() - staggerMs)

    // Never-checked images are always due
    const neverChecked = images.find((img) => img.lastCheckedAt === null)
    if (neverChecked) return neverChecked

    // Find the oldest-checked image that is past the stagger cutoff
    const due = images
        .filter((img) => img.lastCheckedAt !== null && img.lastCheckedAt < cutoff)
        .sort((a, b) => (a.lastCheckedAt as Date).getTime() - (b.lastCheckedAt as Date).getTime())

    return due[0] ?? null
}

// ---------------------------------------------------------------------------
// Repository interface (matches mock in tests)
// ---------------------------------------------------------------------------

export interface ImageUpdateCheckRecord {
    imageRef: string
    lastCheckedAt: Date | null
    latestTag?: string | null
    latestDigest?: string | null
    currentDigest?: string | null
    hasUpdate?: boolean
}

export interface UpdateCheckerRepo {
    findAllImageRefs(): Promise<string[]>
    getImageUpdateCheck(imageRef: string): Promise<ImageUpdateCheckRecord | null>
    upsertImageUpdateCheck(input: {
        imageRef: string
        lastCheckedAt: Date
        latestTag?: string | null
        latestDigest?: string | null
        currentDigest?: string | null
        hasUpdate: boolean
        checkError?: string | null
    }): Promise<void>
    findStacksByImageRef(imageRef: string): Promise<Array<{id: string}>>
}

// ---------------------------------------------------------------------------
// Lazy production implementation of UpdateCheckerRepo
// ---------------------------------------------------------------------------

async function createProductionRepo(): Promise<UpdateCheckerRepo> {
    const [{prisma}, {imageUpdateCheckRepository}, {stackRepository}] = await Promise.all([
        import("../lib/db.js"),
        import("../repositories/image-update-check-repository.js"),
        import("../repositories/stack-repository.js"),
    ])

    return {
        async findAllImageRefs(): Promise<string[]> {
            const rows = await prisma.service.findMany({
                select: {image: true, imageTag: true},
                distinct: ["image", "imageTag"],
            })
            // Build-only services (no image) reconstruct into a ref of just
            // a colon and a tag if not filtered — buildImageRefFromService
            // returns null for those, which we drop here.
            return rows
                .map((r: {image: string; imageTag: string | null}) =>
                    buildImageRefFromService(r.image, r.imageTag),
                )
                .filter((ref): ref is string => ref !== null)
        },

        async getImageUpdateCheck(imageRef: string) {
            return imageUpdateCheckRepository.findByImageRef(imageRef)
        },

        async upsertImageUpdateCheck(input) {
            await imageUpdateCheckRepository.upsert({
                ...input,
                lastCheckedAt: input.lastCheckedAt,
            })
        },

        async findStacksByImageRef(imageRef: string) {
            // Parse the imageRef to get image and tag components
            const normalizedRef = normalizeImageRef(imageRef)
            const colonIndex = normalizedRef.lastIndexOf(":")
            const image = colonIndex > 0 ? normalizedRef.substring(0, colonIndex) : normalizedRef
            const tag = colonIndex > 0 ? normalizedRef.substring(colonIndex + 1) : null

            // Find stacks that have at least one service using this imageRef
            const services = await prisma.service.findMany({
                where: {
                    image: image,
                    imageTag: tag,
                },
                select: {stackId: true},
                distinct: ["stackId"],
            })
            return services.map((s: {stackId: string}) => ({id: s.stackId}))
        },
    }
}

// ---------------------------------------------------------------------------
// UpdateChecker class
// ---------------------------------------------------------------------------

export class UpdateChecker {
    private cronTask: cron.ScheduledTask | null = null
    private readonly repo: UpdateCheckerRepo | null
    private readonly docker: Pick<DockerExecutor, "manifestInspect" | "imageDigest">
    private readonly broadcaster: Pick<StateBroadcaster, "publish">

    constructor(
        repo?: UpdateCheckerRepo,
        docker?: Pick<DockerExecutor, "manifestInspect" | "imageDigest">,
        broadcaster?: Pick<StateBroadcaster, "publish">,
    ) {
        this.repo = repo ?? null
        this.docker = docker ?? dockerExecutor
        this.broadcaster = broadcaster ?? stateEventBroadcaster
    }

    private async getRepo(): Promise<UpdateCheckerRepo> {
        if (this.repo !== null) return this.repo
        return createProductionRepo()
    }

    async start(): Promise<void> {
        this.cronTask = cron.schedule("*/5 * * * *", async () => {
            try {
                await this.checkNextImage()
            } catch (err) {
                console.error("[UpdateChecker] error:", err)
            }
        })
        console.log("[UpdateChecker] started — checking every 5 minutes, staggered over 6-hour window")
    }

    stop(): void {
        this.cronTask?.stop()
        this.cronTask = null
    }

    async checkNextImage(): Promise<void> {
        const repo = await this.getRepo()
        const imageRefs = await repo.findAllImageRefs()
        if (imageRefs.length === 0) return

        // Fetch all existing records to determine which image is due
        const existingRecords = await Promise.all(
            imageRefs.map(async (ref) => {
                const record = await repo.getImageUpdateCheck(ref)
                return {
                    imageRef: ref,
                    lastCheckedAt: record?.lastCheckedAt ?? null,
                }
            }),
        )

        const next = getNextImageToCheck(existingRecords, CHECK_INTERVAL_MS)
        if (!next) {
            console.log("[UpdateChecker] all images checked within stagger window, skipping")
            return
        }

        await this.checkImage(next.imageRef)
    }

    async checkImage(imageRef: string): Promise<void> {
        const repo = await this.getRepo()
        console.log(`[UpdateChecker] checking ${imageRef}`)

        try {
            const result = await this.docker.manifestInspect(imageRef)
            if (!result) {
                console.warn(`[UpdateChecker] manifestInspect returned null for ${imageRef} - image not found in registry or invalid imageRef`)
                await repo.upsertImageUpdateCheck({
                    imageRef,
                    lastCheckedAt: new Date(),
                    hasUpdate: false,
                    checkError: `Image not found in registry: ${imageRef}`,
                })
                return
            }

            const {digest: latestDigest, latestTag} = result
            const tag = imageRef.split(":")[1] ?? "latest"
            // Local-only, no registry traffic — resolves what is actually
            // deployed so the digest branch below has both operands.
            const currentDigest = await this.docker.imageDigest(imageRef)

            let hasUpdate = false

            if (latestTag && tag !== "latest") {
                const existing = await repo.getImageUpdateCheck(imageRef)
                const comparison = compareVersions(tag, latestTag, {
                    currentDigest: existing?.currentDigest ?? null,
                    latestDigest: latestDigest ?? null,
                })
                hasUpdate = comparison === "newer"
            } else if (latestDigest !== null && currentDigest !== null) {
                // Compare the registry digest against what is actually
                // deployed locally — decidable on the very first check,
                // unlike comparing against a previously stored observation.
                hasUpdate = latestDigest !== currentDigest
            }

            await repo.upsertImageUpdateCheck({
                imageRef,
                lastCheckedAt: new Date(),
                latestTag: latestTag ?? null,
                latestDigest: latestDigest ?? null,
                currentDigest: currentDigest ?? null,
                hasUpdate,
                checkError: null,
            })

            if (hasUpdate) {
                const stacks = await repo.findStacksByImageRef(imageRef)
                for (const stack of stacks) {
                    this.broadcaster.publish({
                        type: "update_available",
                        stackId: stack.id,
                        imageRef,
                        latestTag: latestTag ?? null,
                        hasUpdate: true,
                    })
                }
            }
        } catch (err: any) {
            const checkError = err.message ?? String(err)
            await repo.upsertImageUpdateCheck({
                imageRef,
                lastCheckedAt: new Date(),
                hasUpdate: false,
                checkError,
            })
            console.error(`[UpdateChecker] failed to check ${imageRef}:`, err)
        }
    }

    async triggerUpdate(imageRef: string, stack: {id: string}): Promise<void> {
        try {
            // Verify manifest is accessible (also serves as a connectivity check)
            await this.docker.manifestInspect(imageRef)

            this.broadcaster.publish({
                type: "update_available",
                stackId: stack.id,
                imageRef,
                latestTag: null,
                hasUpdate: true,
            })
        } catch (err: any) {
            console.error(`[UpdateChecker] triggerUpdate failed for ${imageRef}:`, err)
            this.broadcaster.publish({
                type: "update_error",
                stackId: stack.id,
                imageRef,
                error: err.message ?? String(err),
            } as any)
        }
    }
}

export const updateChecker = new UpdateChecker()
