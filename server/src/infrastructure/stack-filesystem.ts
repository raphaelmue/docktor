import fs from "node:fs/promises";
import {getComposePath, getEnvPath, getStackPath,} from "../lib/stacks-dir.js";

export class StackFilesystem {
    getStackDirectory(stackId: string): string {
        return getStackPath(stackId);
    }

    async createDirectory(stackId: string): Promise<string> {
        const hostPath = getStackPath(stackId);
        await fs.mkdir(hostPath, {recursive: true});
        return hostPath;
    }

    async writeCompose(stackId: string, content: string): Promise<void> {
        await fs.writeFile(getComposePath(stackId), content, "utf-8");
    }

    async readCompose(stackId: string): Promise<string> {
        try {
            return await fs.readFile(getComposePath(stackId), "utf-8");
        } catch {
            return "";
        }
    }

    async writeEnv(stackId: string, content: string): Promise<void> {
        await fs.writeFile(getEnvPath(stackId), content, "utf-8");
    }

    async readEnv(stackId: string): Promise<string> {
        try {
            return await fs.readFile(getEnvPath(stackId), "utf-8");
        } catch {
            return "";
        }
    }

    async removeEnv(stackId: string): Promise<void> {
        await fs.unlink(getEnvPath(stackId)).catch(() => {});
    }

    async removeDirectory(stackId: string): Promise<void> {
        await fs.rm(getStackPath(stackId), {recursive: true, force: true});
    }
}
