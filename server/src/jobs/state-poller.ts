import cron from "node-cron"
import type {DockerodeClient} from "../infrastructure/dockerode-client.js"
import {dockerodeClient} from "../infrastructure/dockerode-client.js"
import type {StateBroadcaster} from "../lib/state-broadcaster.js"
import {stateEventBroadcaster} from "../lib/state-broadcaster.js"
import type {StackStatus} from "../generated/prisma/enums.js"

export interface ServiceState {
    name: string
    containerState?: string | null
    healthStatus?: string | null
}

export interface StackWithServices {
    id: string
    status: string
    services: ServiceState[]
}

export interface UpdateServiceStateArgs {
    stackId: string
    serviceName: string
    containerId: string
    containerState: string
    healthStatus: string | null
}

export interface StatePollerRepo {
    findByComposeProject(composeProject: string): Promise<StackWithServices | null>
    findAll(): Promise<StackWithServices[]>
    updateServiceState(data: UpdateServiceStateArgs): Promise<void>
}

const TRANSITIONAL_STATES = new Set<string>([
    "DEPLOYING",
    "UPDATING",
    "BACKING_UP",
    "RESTORING",
    "MIGRATING",
])

function deriveStackStatus(services: Array<{containerState?: string | null; healthStatus?: string | null}>): StackStatus {
    const states = services.map((s) => s.containerState ?? "")
    const healthStatuses = services.map((s) => s.healthStatus ?? null)

    // If ANY service is "restarting" or "dead" → ERROR
    if (states.some((s) => s === "restarting" || s === "dead")) {
        return "ERROR"
    }

    // If ALL services are "exited" → STOPPED
    if (states.length > 0 && states.every((s) => s === "exited")) {
        return "STOPPED"
    }

    // If ANY service is "unhealthy" → UNHEALTHY
    if (healthStatuses.some((h) => h === "unhealthy")) {
        return "UNHEALTHY"
    }

    // If ALL running services are "healthy" (and at least one has health check) → HEALTHY
    const hasHealthCheck = healthStatuses.some((h) => h !== null)
    if (hasHealthCheck && healthStatuses.every((h) => h === "healthy" || h === null)) {
        return "HEALTHY"
    }

    // Default for mixed states and when all are running
    return "RUNNING"
}

export class StatePoller {
    private abortController: AbortController | null = null
    private cronTask: cron.ScheduledTask | null = null
    private readonly docker: Pick<DockerodeClient, "getEventStream" | "inspectContainer" | "listContainers">
    private readonly repo: StatePollerRepo | null
    private readonly broadcaster: Pick<StateBroadcaster, "publish">

    constructor(
        docker?: Pick<DockerodeClient, "getEventStream" | "inspectContainer" | "listContainers">,
        repo?: StatePollerRepo,
        broadcaster?: Pick<StateBroadcaster, "publish">,
    ) {
        this.docker = docker ?? dockerodeClient
        // repo is stored as-is; if undefined, getRepo() will load it lazily
        this.repo = repo ?? null
        this.broadcaster = broadcaster ?? stateEventBroadcaster
    }

    private async getRepo(): Promise<StatePollerRepo> {
        if (this.repo !== null) return this.repo
        // Lazy-load to avoid pulling db.ts into the module graph at test time
        const {stackRepository} = await import("../repositories/stack-repository.js")
        return stackRepository as unknown as StatePollerRepo
    }

    async start(): Promise<void> {
        await this.startEventStream()
        this.cronTask = cron.schedule("*/60 * * * * *", async () => {
            try {
                await this.reconcile()
            } catch (err) {
                console.error("[StatePoller] reconcile error:", err)
            }
        })
    }

    stop(): void {
        if (this.abortController) {
            this.abortController.abort()
            this.abortController = null
        }
        if (this.cronTask) {
            this.cronTask.stop()
            this.cronTask = null
        }
    }

    private async startEventStream(): Promise<void> {
        this.abortController = new AbortController()
        const signal = this.abortController.signal

        let stream: NodeJS.ReadableStream
        try {
            stream = await this.docker.getEventStream(signal)
        } catch (err) {
            if (signal.aborted) return
            console.error("[StatePoller] failed to open event stream:", err)
            setTimeout(() => {
                if (!signal.aborted) this.startEventStream()
            }, 2000)
            return
        }

        stream.on("data", (chunk: Buffer) => {
            try {
                const event = JSON.parse(chunk.toString())
                this.handleEvent(event).catch((err: unknown) => {
                    console.error("[StatePoller] handleEvent error:", err)
                })
            } catch {
                // ignore unparseable chunks
            }
        })

        stream.on("end", () => {
            if (signal.aborted) return
            setTimeout(() => {
                if (!signal.aborted) this.startEventStream()
            }, 2000)
        })

        stream.on("error", (err: Error) => {
            if (signal.aborted) return
            console.error("[StatePoller] event stream error:", err)
            setTimeout(() => {
                if (!signal.aborted) this.startEventStream()
            }, 2000)
        })
    }

    async handleEvent(event: {
        id: string
        status: string
        Actor: {Attributes: Record<string, string>}
    }): Promise<void> {
        const composeProject = event.Actor.Attributes["com.docker.compose.project"]
        const serviceName = event.Actor.Attributes["com.docker.compose.service"]

        // Skip unmanaged containers (no compose labels)
        if (!composeProject) return

        const repo = await this.getRepo()

        // Find the stack by compose project name
        const stack = await repo.findByComposeProject(composeProject)
        if (!stack) return

        // Skip stacks in transitional states
        if (TRANSITIONAL_STATES.has(stack.status)) return

        // Inspect the container
        const info = await this.docker.inspectContainer(event.id)
        const containerState = info.State.Status
        const healthStatus = (info.State as any).Health?.Status ?? null

        // Update the service row in DB
        await repo.updateServiceState({
            stackId: stack.id,
            serviceName,
            containerId: event.id,
            containerState,
            healthStatus,
        })

        // Derive aggregate stack status
        const updatedServices = stack.services.map((s) => {
            if (s.name === serviceName) {
                return {containerState, healthStatus}
            }
            return {containerState: s.containerState, healthStatus: s.healthStatus}
        })
        const derivedStatus = deriveStackStatus(updatedServices)

        // Publish SSE event
        this.broadcaster.publish({
            type: "container_state",
            stackId: stack.id,
            serviceName,
            containerState,
            healthStatus,
            stackStatus: derivedStatus,
        })
    }

    async reconcile(): Promise<void> {
        const repo = await this.getRepo()
        const containers = await this.docker.listContainers(true)

        // Group containers by compose project
        const byProject = new Map<string, typeof containers>()
        for (const container of containers) {
            const project = container.Labels?.["com.docker.compose.project"]
            if (!project) continue
            if (!byProject.has(project)) byProject.set(project, [])
            byProject.get(project)!.push(container)
        }

        // Update each project's services
        for (const [project, projectContainers] of byProject) {
            try {
                const stack = await repo.findByComposeProject(project)
                if (!stack) continue
                if (TRANSITIONAL_STATES.has(stack.status)) continue

                for (const container of projectContainers) {
                    const svcName = container.Labels?.["com.docker.compose.service"]
                    if (!svcName) continue

                    await repo.updateServiceState({
                        stackId: stack.id,
                        serviceName: svcName,
                        containerId: container.Id,
                        containerState: container.State,
                        healthStatus: null,
                    })
                }
            } catch (err) {
                console.error(`[StatePoller] reconcile error for project ${project}:`, err)
            }
        }
    }
}

export const statePoller = new StatePoller()
