import {execFile} from "node:child_process";
import {promisify} from "node:util";
import {prisma} from "../lib/db.js";
import {hashComposeContent} from "../lib/compose-parser.js";
import {getStackPath, getComposePath} from "../lib/stacks-dir.js";
import {NotFoundError, BadRequestError} from "../lib/errors.js";
import type {StackStatus} from "../generated/prisma/enums.js";
import fs from "node:fs/promises";

const execFileAsync = promisify(execFile);

async function composeExec(
    stackPath: string,
    args: string[],
): Promise<{stdout: string; stderr: string}> {
    return execFileAsync("docker", ["compose", ...args], {
        cwd: stackPath,
        timeout: 120_000,
    });
}

async function transitionStatus(
    id: string,
    allowedFrom: StackStatus[],
    to: StackStatus,
    message?: string,
) {
    const stack = await prisma.stack.findUnique({where: {id}});
    if (!stack) {
        throw new NotFoundError(`Stack "${id}" not found`);
    }

    if (!allowedFrom.includes(stack.status as StackStatus)) {
        throw new BadRequestError(
            `Cannot transition from "${stack.status}" to "${to}". Allowed from: ${allowedFrom.join(", ")}`,
        );
    }

    await prisma.stack.update({
        where: {id},
        data: {
            status: to,
            previousStatus: stack.status,
        },
    });

    await prisma.statusLog.create({
        data: {
            stackId: id,
            fromStatus: stack.status,
            toStatus: to,
            message,
        },
    });
}

export async function deployStack(id: string) {
    const stack = await prisma.stack.findUnique({where: {id}});
    if (!stack) {
        throw new NotFoundError(`Stack "${id}" not found`);
    }

    await transitionStatus(
        id,
        ["DRAFT", "STOPPED", "ERROR", "RUNNING", "HEALTHY", "UNHEALTHY"],
        "DEPLOYING",
        "Deployment started",
    );

    const stackPath = getStackPath(id);
    let success = true;
    let errorMessage: string | undefined;

    try {
        await composeExec(stackPath, ["up", "-d", "--remove-orphans"]);
    } catch (err: any) {
        success = false;
        errorMessage = err.stderr || err.message;
    }

    const composeContent = await fs.readFile(getComposePath(id), "utf-8");
    const hash = hashComposeContent(composeContent);

    await prisma.deployment.create({
        data: {
            stackId: id,
            composeHash: hash,
            success,
            errorMessage: errorMessage ?? null,
        },
    });

    if (success) {
        await transitionStatus(id, ["DEPLOYING"], "RUNNING", "Deployment succeeded");
        await prisma.stack.update({
            where: {id},
            data: {configChanged: false},
        });
    } else {
        await transitionStatus(
            id,
            ["DEPLOYING"],
            "ERROR",
            `Deployment failed: ${errorMessage}`,
        );
    }

    return {success, errorMessage};
}

export async function stopStack(id: string) {
    await transitionStatus(
        id,
        ["RUNNING", "HEALTHY", "UNHEALTHY", "ERROR"],
        "STOPPED",
        "Stack stopped",
    );

    const stackPath = getStackPath(id);
    try {
        await composeExec(stackPath, ["stop"]);
    } catch (err: any) {
        await transitionStatus(
            id,
            ["STOPPED"],
            "ERROR",
            `Stop failed: ${err.stderr || err.message}`,
        );
        throw err;
    }
}

export async function restartStack(id: string) {
    const stack = await prisma.stack.findUnique({where: {id}});
    if (!stack) {
        throw new NotFoundError(`Stack "${id}" not found`);
    }

    const allowed: StackStatus[] = ["RUNNING", "HEALTHY", "UNHEALTHY"];
    if (!allowed.includes(stack.status as StackStatus)) {
        throw new BadRequestError(
            `Cannot restart stack in "${stack.status}" status`,
        );
    }

    const stackPath = getStackPath(id);
    await composeExec(stackPath, ["restart"]);

    await prisma.statusLog.create({
        data: {
            stackId: id,
            fromStatus: stack.status,
            toStatus: stack.status,
            message: "Stack restarted",
        },
    });
}

export interface ContainerStatus {
    service: string;
    state: string;
    status: string;
    ports: string;
}

export async function getContainerStatuses(
    id: string,
): Promise<ContainerStatus[]> {
    const stack = await prisma.stack.findUnique({where: {id}});
    if (!stack) {
        throw new NotFoundError(`Stack "${id}" not found`);
    }

    const stackPath = getStackPath(id);
    try {
        const {stdout} = await composeExec(stackPath, [
            "ps",
            "--format",
            "json",
        ]);

        if (!stdout.trim()) return [];

        // docker compose ps --format json outputs one JSON object per line
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
