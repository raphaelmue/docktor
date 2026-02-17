import path from "node:path";

export function getStacksDir(): string {
    return path.resolve(process.env.DOCKTOR_STACKS_DIR ?? "./stacks");
}

export function getStackPath(id: string): string {
    return path.join(getStacksDir(), id);
}

export function getComposePath(id: string): string {
    return path.join(getStackPath(id), "docker-compose.yml");
}

export function getEnvPath(id: string): string {
    return path.join(getStackPath(id), ".env");
}
