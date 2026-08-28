import {prisma} from "../lib/db.js"

export interface UpsertImageUpdateCheckInput {
    imageRef: string // canonical image ref (primary key)
    lastCheckedAt: Date
    latestTag?: string | null
    latestDigest?: string | null
    currentDigest?: string | null
    hasUpdate: boolean
    checkError?: string | null
    availableTags?: string[] | null
}

export class ImageUpdateCheckRepository {
    async upsert(input: UpsertImageUpdateCheckInput) {
        // JSON-encoding is an implementation detail of persistence — callers
        // pass a real string[] and never see the encoded column value.
        const availableTags = input.availableTags ? JSON.stringify(input.availableTags) : null
        return prisma.imageUpdateCheck.upsert({
            where: {imageRef: input.imageRef},
            create: {
                imageRef: input.imageRef,
                lastCheckedAt: input.lastCheckedAt,
                latestTag: input.latestTag ?? null,
                latestDigest: input.latestDigest ?? null,
                currentDigest: input.currentDigest ?? null,
                hasUpdate: input.hasUpdate,
                checkError: input.checkError ?? null,
                availableTags,
            },
            update: {
                lastCheckedAt: input.lastCheckedAt,
                latestTag: input.latestTag ?? null,
                latestDigest: input.latestDigest ?? null,
                currentDigest: input.currentDigest ?? null,
                hasUpdate: input.hasUpdate,
                checkError: input.checkError ?? null,
                availableTags,
            },
        })
    }

    async findByImageRef(imageRef: string) {
        return prisma.imageUpdateCheck.findUnique({where: {imageRef}})
    }

    async findDueForCheck(cutoff: Date, imageRefs: string[]) {
        return prisma.imageUpdateCheck.findMany({
            where: {
                imageRef: {in: imageRefs},
                OR: [
                    {lastCheckedAt: {lt: cutoff}},
                ],
            },
            orderBy: {lastCheckedAt: "asc"},
        })
    }

    async findByImageRefs(imageRefs: string[]) {
        return prisma.imageUpdateCheck.findMany({
            where: {imageRef: {in: imageRefs}},
        })
    }
}

export const imageUpdateCheckRepository = new ImageUpdateCheckRepository()
