import Dockerode from "dockerode"

// Vitest mocks Dockerode as a plain function (vi.fn()), not a class.
// Using a factory wrapper lets tests inject the mock without `new`.
// In production, Dockerode is called with `new` via its normal constructor path.
function createDockerInstance(): Dockerode {
    const Docker = Dockerode as unknown as (opts: {socketPath: string}) => Dockerode
    return Docker({socketPath: "/var/run/docker.sock"})
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
