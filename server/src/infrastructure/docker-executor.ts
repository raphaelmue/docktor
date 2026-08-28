import {execFile} from "node:child_process";
import {promisify} from "node:util";
import {getStackPath} from "../lib/stacks-dir.js";

const execFileAsync = promisify(execFile);

export interface ContainerStatus {
    service: string;
    state: string;
    status: string;
    ports: string;
}

export class DockerExecutor {
    private async composeExec(
        stackId: string,
        args: string[],
    ): Promise<{stdout: string; stderr: string}> {
        return execFileAsync("docker", ["compose", ...args], {
            cwd: getStackPath(stackId),
            timeout: 120_000,
        });
    }

    async up(stackId: string): Promise<void> {
        await this.composeExec(stackId, ["up", "-d", "--remove-orphans"]);
    }

    async stop(stackId: string): Promise<void> {
        await this.composeExec(stackId, ["stop"]);
    }

    async restart(stackId: string): Promise<void> {
        await this.composeExec(stackId, ["restart"]);
    }

    async down(stackId: string): Promise<void> {
        await this.composeExec(stackId, ["down", "-v"]);
    }

    async ps(stackId: string): Promise<ContainerStatus[]> {
        try {
            const {stdout} = await this.composeExec(stackId, [
                "ps",
                "--format",
                "json",
            ]);

            if (!stdout.trim()) return [];

            const lines = stdout.trim().split("\n");
            return lines.map((line) => {
                const obj = JSON.parse(line);
                return {
                    service: obj.Service ?? obj.Name ?? "",
                    state: obj.State ?? "",
                    status: obj.Status ?? "",
                    ports: obj.Ports ?? "",
                };
            });
        } catch {
            return [];
        }
    }

    async composePull(stackId: string): Promise<string> {
        const {stdout, stderr} = await this.composeExec(stackId, ["pull"]);
        // docker compose pull writes progress to stderr, combine both for analysis
        return stdout + "\n" + stderr;
    }

    async pull(imageRef: string): Promise<void> {
        await execFileAsync("docker", ["pull", imageRef], {
            timeout: 120_000,
        });
    }

    async manifestInspect(imageRef: string): Promise<{
        digest: string | null
        latestTag: string | null
    } | null> {
        try {
            const {stdout} = await execFileAsync(
                "docker",
                ["manifest", "inspect", "--verbose", imageRef],
                {timeout: 30_000},
            );
            // docker manifest inspect --verbose output:
            // Multi-arch: returns JSON array; single-arch: returns JSON object
            const parsed = JSON.parse(stdout);
            const manifest = Array.isArray(parsed) ? parsed[0] : parsed;

            // Extract digest from known field locations
            const digest: string | null =
                manifest?.Descriptor?.digest ??           // multi-arch descriptor
                manifest?.SchemaV2Manifest?.config?.digest ??  // single-arch v2
                manifest?.Ref ??
                null;

            if (!digest) {
                console.warn(`[DockerExecutor] manifestInspect: No digest found for ${imageRef}. Manifest keys: ${Object.keys(manifest).join(', ')}`);
            }

            return {digest, latestTag: null};
        } catch (err: any) {
            // "no such manifest" or "not found" = image not found in registry
            if (
                err.stderr?.includes("no such manifest") ||
                err.stderr?.includes("not found")
            ) {
                console.warn(`[DockerExecutor] manifestInspect: Image not found in registry: ${imageRef}. stderr: ${err.stderr}`);
                return null;
            }
            // 429 rate limit or auth error — re-throw so UpdateChecker can record checkError
            console.error(`[DockerExecutor] manifestInspect failed for ${imageRef}:`, err.message, err.stderr ?? "");
            throw err;
        }
    }

    /**
     * Resolves the repo digest of a locally present image. Reads only the
     * local image store (`docker image inspect`) — makes no network call
     * and cannot consume registry rate limit. Returns null (not a throw)
     * when the image is not present locally, since that is a normal
     * condition (e.g. a stack that has never been deployed).
     */
    async imageDigest(imageRef: string): Promise<string | null> {
        try {
            const {stdout} = await execFileAsync(
                "docker",
                ["image", "inspect", imageRef, "--format", "{{index .RepoDigests 0}}"],
                {timeout: 30_000},
            );
            const digest = stdout.trim();
            // Empty output, or the literal Go template rendering when
            // RepoDigests has no entry at index 0 (e.g. a locally built
            // image with no registry digest), both mean "no digest".
            if (!digest || digest === "<no value>" || digest.includes("index .RepoDigests")) {
                return null;
            }
            return digest;
        } catch (err: any) {
            console.warn(`[DockerExecutor] imageDigest: image not present locally or inspect failed for ${imageRef}: ${err.message ?? err}`);
            return null;
        }
    }
}

export const dockerExecutor = new DockerExecutor();
