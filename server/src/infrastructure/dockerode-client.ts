import Dockerode from "dockerode"
import {processDockerLogChunk} from "../lib/docker-log-parser.js"

// Vitest mocks Dockerode as a plain function (vi.fn()), not a class.
// Using a factory wrapper lets tests inject the mock without `new`.
// In production, Dockerode is called with `new` via its normal constructor path.
function createDockerInstance(): Dockerode {
    const Docker = Dockerode as unknown as (opts?: object) => Dockerode
    return Docker() // Auto-detects socket path based on platform
}

export class DockerodeClient {
    private readonly docker: Dockerode

    constructor() {
        this.docker = createDockerInstance()
    }

    async getEventStream(signal?: AbortSignal): Promise<NodeJS.ReadableStream> {
        return (this.docker as any).getEvents({
            filters: {
                type: ["container"],
                event: ["start", "stop", "die", "kill", "health_status"],
            },
            abortSignal: signal,
        })
    }

    async inspectContainer(containerId: string): Promise<Dockerode.ContainerInspectInfo> {
        return this.docker.getContainer(containerId).inspect()
    }

    async listContainers(all = true): Promise<Dockerode.ContainerInfo[]> {
        return this.docker.listContainers({all})
    }

    async getLogStream(containerId: string, tail = 100): Promise<NodeJS.ReadableStream> {
        return this.docker.getContainer(containerId).logs({
            stdout: true,
            stderr: true,
            follow: true,
            tail,
            timestamps: true,
        }) as unknown as NodeJS.ReadableStream
    }

    /**
     * Resolves the last `tail` lines of a container's combined stdout/stderr
     * as a single string. Unlike getLogStream, `follow` is false — dockerode
     * resolves a terminated Buffer rather than a never-ending stream, which
     * is what a one-shot reconcile pass needs. Resolves "" (rather than
     * throwing) when the container does not exist, so a poller degrades to
     * "cannot distinguish failed from pending" instead of crashing.
     */
    async getLogTail(containerId: string, tail = 200): Promise<string> {
        let buffer: Buffer
        try {
            buffer = (await this.docker.getContainer(containerId).logs({
                stdout: true,
                stderr: true,
                follow: false,
                tail,
                timestamps: true,
            })) as unknown as Buffer
        } catch (err: any) {
            if (err?.statusCode === 404) return ""
            throw err
        }

        const lines: string[] = []
        processDockerLogChunk(buffer, containerId, (event) => {
            lines.push(event.line)
        })
        return lines.join("\n")
    }
}

let _dockerodeClient: DockerodeClient | undefined

export function getDockerodeClient(): DockerodeClient {
    if (!_dockerodeClient) {
        _dockerodeClient = new DockerodeClient()
    }
    return _dockerodeClient
}

export const dockerodeClient = new Proxy({} as DockerodeClient, {
    get(_target, prop, receiver) {
        return Reflect.get(getDockerodeClient(), prop, receiver)
    },
})
