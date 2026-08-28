import cron from "node-cron"
import {watch} from "chokidar"
import type {FSWatcher} from "chokidar"
import {readFile} from "node:fs/promises"
import type {StateBroadcaster} from "../lib/state-broadcaster.js"
import {stateEventBroadcaster} from "../lib/state-broadcaster.js"
import {hashComposeContent} from "../lib/compose-parser.js"
import {createComposeConfig, type ComposeConfig} from "../domain/compose-config.js"
import {getStacksDir} from "../lib/stacks-dir.js"

export interface FileWatcherRepo {
    findAllStacks(): Promise<Array<{id: string; composeFilePath: string; hash: string | null}>>
    findStackByPath(composePath: string): Promise<{id: string; composeFilePath: string; hash: string | null} | null>
    updateStackHash(args: {stackId: string; hash: string}): Promise<void>
    syncServicesFromCompose(stackId: string, composeConfig: ComposeConfig): Promise<void>
    createStackEvent(args: {stackId: string; type: string; message?: string; payload?: string}): Promise<void>
}

export class FileWatcher {
    private watcher: FSWatcher | null = null
    private cronTask: cron.ScheduledTask | null = null
    private readonly repo: FileWatcherRepo | null
    private readonly broadcaster: Pick<StateBroadcaster, "publish">

    constructor(
        repo?: FileWatcherRepo,
        broadcaster?: Pick<StateBroadcaster, "publish">,
    ) {
        this.repo = repo ?? null
        this.broadcaster = broadcaster ?? stateEventBroadcaster
    }

    private async getRepo(): Promise<FileWatcherRepo> {
        if (this.repo !== null) return this.repo
        // Lazy-load to avoid pulling db.ts into the module graph at test time
        const {stackRepository} = await import("../repositories/stack-repository.js")
        return stackRepository as unknown as FileWatcherRepo
    }

    isWatching(): boolean {
        return this.watcher !== null
    }

    async start(): Promise<void> {
        const stacksRoot = getStacksDir()
        console.log(`[FileWatcher] Starting file watcher on: ${stacksRoot}`)

        // On Windows, fs.watch (chokidar's default) is unreliable for detecting file changes.
        // process.platform reflects the container's OS (always "linux" under Docker), not the
        // Docker host's OS — Docker Desktop on Windows/Mac virtualizes bind mounts and often
        // fails to propagate host-side inotify events into the container regardless of the
        // container's own platform. DOCKTOR_FS_POLLING lets an operator force the correct mode
        // when auto-detection can't see through that layer; unset falls back to platform detection.
        const pollingOverride = process.env.DOCKTOR_FS_POLLING
        const usePolling = pollingOverride !== undefined ? pollingOverride === "true" : process.platform === "win32"
        if (usePolling) {
            console.log(`[FileWatcher] Polling mode enabled (interval: 1000ms)${pollingOverride !== undefined ? " [DOCKTOR_FS_POLLING override]" : " [Windows detected]"}`)
        }

        this.watcher = watch(stacksRoot, {
            ignoreInitial: true,
            awaitWriteFinish: {stabilityThreshold: 1000, pollInterval: 100},
            depth: 2,
            // Matches chokidar's own documented pattern for a function-based `ignored`
            // (stats?.isFile() && ...): readdirp does not always supply `stats` during
            // directory-filter traversal, and `stats?.isFile()` short-circuits to a falsy
            // "don't ignore" in that case. A `stats?.isDirectory() ?? false` guard instead
            // defaults to "not a directory" when stats is missing and falls through to the
            // suffix check below, wrongly filtering out (and blocking traversal into) any
            // directory whose name doesn't end in "docker-compose.yml" — silently breaking
            // live change detection entirely regardless of usePolling.
            ignored: (filePath: string, stats?: import("node:fs").Stats) =>
                Boolean(stats?.isFile() && !filePath.endsWith("docker-compose.yml")),
            usePolling,
            interval: usePolling ? 1000 : undefined,
        })

        this.watcher.on("ready", () => {
            console.log(`[FileWatcher] Chokidar is ready and watching`)
        })

        this.watcher.on("change", (filePath) => {
            console.log(`[FileWatcher] Chokidar detected CHANGE: ${filePath}`)
            this.handleFileChange(filePath).catch((err: unknown) => {
                console.error("[FileWatcher] handleFileChange error:", err)
            })
        })

        this.watcher.on("add", (filePath) => {
            console.log(`[FileWatcher] Chokidar detected ADD: ${filePath}`)
            this.handleFileChange(filePath).catch((err: unknown) => {
                console.error("[FileWatcher] handleFileChange error (add):", err)
            })
        })

        this.watcher.on("error", (err) => {
            console.error("[FileWatcher] chokidar error:", err)
        })

        this.cronTask = cron.schedule("*/60 * * * * *", async () => {
            try {
                await this.reconcile()
            } catch (err) {
                console.error("[FileWatcher] reconcile error:", err)
            }
        })
    }

    async stop(): Promise<void> {
        if (this.watcher) {
            await this.watcher.close()
            this.watcher = null
        }
        if (this.cronTask) {
            this.cronTask.stop()
            this.cronTask = null
        }
    }

    async handleFileChange(filePath: string): Promise<void> {
        console.log(`[FileWatcher] File changed: ${filePath}`)
        const repo = await this.getRepo()
        const stack = await repo.findStackByPath(filePath)
        if (!stack) {
            console.log(`[FileWatcher] No stack found for path: ${filePath}`)
            return
        }
        console.log(`[FileWatcher] Found stack: ${stack.id}`)

        let content: string
        try {
            content = await readFile(filePath, "utf-8")
        } catch (err: any) {
            if (err.code === "ENOENT") {
                console.log(`[FileWatcher] File not found, skipping: ${filePath}`)
                return
            }
            throw err
        }

        const newHash = hashComposeContent(content)
        const oldHash = stack.hash ?? ""

        // No-op if hash is unchanged
        if (newHash === oldHash) {
            console.log(`[FileWatcher] Hash unchanged for ${filePath}, skipping`)
            return
        }

        console.log(`[FileWatcher] Hash changed for ${stack.id}: ${oldHash.slice(0, 8)}... -> ${newHash.slice(0, 8)}...`)

        // Try to parse the compose content
        let composeConfig: ComposeConfig
        try {
            composeConfig = createComposeConfig(content)
        } catch (err: any) {
            // Invalid YAML or no services key
            console.log(`[FileWatcher] Config error for ${stack.id}: ${err.message}`)
            await repo.createStackEvent({
                stackId: stack.id,
                type: "config_error",
                message: err.message,
            })
            this.broadcaster.publish({
                type: "config_error",
                stackId: stack.id,
                message: err.message,
            })
            return
        }

        // Valid compose file with changed hash — sync config-derived service metadata
        // (image, imageTag, ports, volumes) without touching container runtime columns,
        // then update hash and broadcast. Sync runs before updateStackHash: if it throws,
        // the stored hash stays stale so the 60s reconcile() retry picks it back up.
        await repo.syncServicesFromCompose(stack.id, composeConfig)
        console.log(`[FileWatcher] syncServicesFromCompose completed for ${stack.id} (${composeConfig.services.length} services)`)
        await repo.updateStackHash({stackId: stack.id, hash: newHash})
        await repo.createStackEvent({
            stackId: stack.id,
            type: "config_changed",
            payload: JSON.stringify({oldHash, newHash}),
        })
        console.log(`[FileWatcher] Broadcasting config_changed event for ${stack.id}`)
        this.broadcaster.publish({
            type: "config_changed",
            stackId: stack.id,
            newHash,
        })
    }

    async reconcile(): Promise<void> {
        const repo = await this.getRepo()
        const stacks = await repo.findAllStacks()

        for (const stack of stacks) {
            try {
                const content = await readFile(stack.composeFilePath, "utf-8")
                const newHash = hashComposeContent(content)

                if (newHash !== (stack.hash ?? "")) {
                    await this.handleFileChange(stack.composeFilePath)
                }
            } catch (err: any) {
                if (err.code === "ENOENT") {
                    console.log(`[FileWatcher] Reconcile: file not found for stack ${stack.id}, skipping`)
                    continue
                }
                console.error(`[FileWatcher] Reconcile error for stack ${stack.id}:`, err)
            }
        }
    }
}

export const fileWatcher = new FileWatcher()
