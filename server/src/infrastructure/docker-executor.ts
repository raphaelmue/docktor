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
}
