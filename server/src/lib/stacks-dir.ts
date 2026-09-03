import {mkdir} from "node:fs/promises";
import path from "node:path";

export function getStacksDir(): string {
    return path.resolve(process.env.DOCKTOR_STACKS_DIR ?? "./stacks");
}

/**
 * Ensures the top-level managed stacks directory exists, creating it
 * (including any missing intermediate segments) if absent. Idempotent: an
 * already-existing directory (the normal case, where the bind mount
 * attached) is left untouched and this resolves without error.
 *
 * Why this exists at all — it looks trivially redundant with the volume
 * mount declared in docker-compose.yml, and a future reader may be tempted
 * to delete it as dead weight. It is not: the application must not depend
 * on the container runtime auto-creating a missing bind-mount source.
 * Docker's short-syntax bind-mount auto-creation is legacy and best-effort,
 * not a guaranteed contract, and Docker Desktop's virtualized backends
 * (e.g. WSL2) handle a bare Linux absolute path that maps to no real host
 * location via a materially different code path than native Linux
 * dockerd's plain mkdir. That divergence is exactly how a cleanly booted
 * server ended up with no stacks directory and no error on a Windows/
 * Docker Desktop host (gap G-05.1-3). The only other directory creation in
 * this codebase — stack-filesystem.ts's createDirectory() — is per-stack
 * and on-demand; nothing else ever guarantees the top-level directory
 * exists, so this is the single place that does.
 */
export async function ensureStacksDir(): Promise<string> {
    const target = getStacksDir();
    try {
        await mkdir(target, {recursive: true});
    } catch (err) {
        throw new Error(
            `Failed to create the managed stacks directory at "${target}" — Docktor cannot manage any stack without it. Check whether the stacks volume in docker-compose.yml is actually mounted, and whether DOCKTOR_STACKS_DIR/DOCKTOR_STACKS_HOST_DIR point at a path this container can write to.`,
            {cause: err},
        );
    }
    return target;
}

/**
 * Joins the stacks directory with a stack id and asserts the result stays
 * under that directory. Stack ids are slugify()'d at creation time
 * (StackService.createStack), which is what actually keeps `..` out of the
 * joined path — this is defense-in-depth so the guarantee is enforced here
 * too, at the path layer, rather than solely upstream at slug time.
 */
export function getStackPath(id: string): string {
    const stacksDir = getStacksDir();
    const resolved = path.join(stacksDir, id);
    if (!resolved.startsWith(stacksDir + path.sep)) {
        throw new Error(
            `Stack id "${id}" resolves outside the managed stacks directory (${resolved} is not under ${stacksDir}) — refusing to use it as a stack path`,
        );
    }
    return resolved;
}

export function getComposePath(id: string): string {
    return path.join(getStackPath(id), "docker-compose.yml");
}

export function getEnvPath(id: string): string {
    return path.join(getStackPath(id), ".env");
}

/**
 * Verifies that the host-side path of the stacks directory volume mount
 * (DOCKTOR_STACKS_HOST_DIR) matches the container-side path Docktor itself
 * resolves (getStacksDir(), driven by DOCKTOR_STACKS_DIR). Docktor runs
 * Docker-outside-of-Docker: `docker compose` inside this container resolves
 * relative bind mounts declared in a managed stack's compose file against
 * its own filesystem view, then sends the resulting absolute path to the
 * *host's* Docker daemon over the mounted socket. If the two paths differ,
 * the host daemon silently creates directories at a path that does not
 * exist inside this container, misplacing every relative-volume stack's
 * data (see .planning/todos/pending/2026-08-28-dood-bind-mount-path-mismatch.md).
 *
 * When DOCKTOR_STACKS_HOST_DIR is unset, this only warns and returns rather
 * than throwing — an operator running Docktor outside of Docker (e.g. a dev
 * setup where DooD does not apply) has no host-side path to compare
 * against and must not be blocked at startup.
 */
export function assertStacksDirMatchesHost(): void {
    const hostDir = process.env.DOCKTOR_STACKS_HOST_DIR;
    const containerDir = getStacksDir();

    if (!hostDir) {
        console.warn(
            `[stacks-dir] DOCKTOR_STACKS_HOST_DIR is not set — cannot verify that the host-side stacks path matches the container-side path (${containerDir}). If Docktor is running Docker-outside-of-Docker, relative bind mounts in managed stacks will be written to the wrong host location unless the two are actually identical. Set DOCKTOR_STACKS_HOST_DIR to the host path of the stacks volume mount to enable this check.`,
        );
        return;
    }

    const normalizedHostDir = path.resolve(hostDir);
    if (normalizedHostDir !== containerDir) {
        throw new Error(
            `Stacks directory path mismatch: DOCKTOR_STACKS_HOST_DIR ("${normalizedHostDir}") does not match the container-side DOCKTOR_STACKS_DIR ("${containerDir}"). Docktor runs Docker-outside-of-Docker — the stacks directory must be mounted at the identical absolute path on both the host and inside this container, or relative bind mounts declared in managed stacks' compose files will be written to the wrong host location. Fix docker-compose.yml so DOCKTOR_STACKS_HOST_DIR drives both sides of the stacks volume mapping and matches DOCKTOR_STACKS_DIR.`,
        );
    }
}
