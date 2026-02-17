import fs from "node:fs/promises";
import type {CreateStackInput, UpdateStackInput} from "@docktor/shared";
import {prisma} from "../lib/db.js";
import {slugify} from "../lib/slugify.js";
import {
    parseComposeContent,
    hashComposeContent,
} from "../lib/compose-parser.js";
import {
    getStackPath,
    getComposePath,
    getEnvPath,
} from "../lib/stacks-dir.js";
import {
    NotFoundError,
    ConflictError,
    BadRequestError,
} from "../lib/errors.js";

export async function createStack(input: CreateStackInput) {
    const id = slugify(input.displayName);
    if (!id) {
        throw new BadRequestError("Display name produces an empty slug");
    }

    const existing = await prisma.stack.findUnique({where: {id}});
    if (existing) {
        throw new ConflictError(`Stack "${id}" already exists`);
    }

    const stackPath = getStackPath(id);
    await fs.mkdir(stackPath, {recursive: true});
    await fs.writeFile(getComposePath(id), input.composeContent, "utf-8");
    if (input.envContent) {
        await fs.writeFile(getEnvPath(id), input.envContent, "utf-8");
    }

    const parsedServices = parseComposeContent(input.composeContent);
    const hash = hashComposeContent(input.composeContent);

    const stack = await prisma.stack.create({
        data: {
            id,
            displayName: input.displayName,
            description: input.description ?? null,
            hostPath: stackPath,
            lastKnownHash: hash,
            lastParsedAt: new Date(),
            services: {
                create: parsedServices.map((s) => ({
                    serviceName: s.serviceName,
                    image: s.image,
                    imageTag: s.imageTag,
                    ports: s.ports.length ? JSON.stringify(s.ports) : null,
                    volumes: s.volumes.length
                        ? JSON.stringify(s.volumes)
                        : null,
                })),
            },
            statusLogs: {
                create: {
                    toStatus: "DRAFT",
                    message: "Stack created",
                },
            },
        },
        include: {services: true},
    });

    return stack;
}

export async function listStacks() {
    return prisma.stack.findMany({
        include: {services: true},
        orderBy: {createdAt: "desc"},
    });
}

export async function getStack(id: string) {
    const stack = await prisma.stack.findUnique({
        where: {id},
        include: {
            services: true,
            deployments: {orderBy: {deployedAt: "desc"}, take: 10},
            statusLogs: {orderBy: {createdAt: "desc"}, take: 20},
        },
    });

    if (!stack) {
        throw new NotFoundError(`Stack "${id}" not found`);
    }

    return stack;
}

export async function updateStack(id: string, input: UpdateStackInput) {
    const stack = await prisma.stack.findUnique({where: {id}});
    if (!stack) {
        throw new NotFoundError(`Stack "${id}" not found`);
    }

    if (input.composeContent !== undefined) {
        await fs.writeFile(getComposePath(id), input.composeContent, "utf-8");

        const parsedServices = parseComposeContent(input.composeContent);
        const hash = hashComposeContent(input.composeContent);

        // Delete old services, create new ones
        await prisma.service.deleteMany({where: {stackId: id}});
        await prisma.service.createMany({
            data: parsedServices.map((s) => ({
                stackId: id,
                serviceName: s.serviceName,
                image: s.image,
                imageTag: s.imageTag,
                ports: s.ports.length ? JSON.stringify(s.ports) : null,
                volumes: s.volumes.length ? JSON.stringify(s.volumes) : null,
            })),
        });

        await prisma.stack.update({
            where: {id},
            data: {
                lastKnownHash: hash,
                lastParsedAt: new Date(),
                configChanged: hash !== stack.lastKnownHash,
            },
        });
    }

    if (input.envContent !== undefined) {
        if (input.envContent) {
            await fs.writeFile(getEnvPath(id), input.envContent, "utf-8");
        } else {
            await fs.unlink(getEnvPath(id)).catch(() => {});
        }
    }

    const updateData: Record<string, unknown> = {};
    if (input.displayName !== undefined)
        updateData.displayName = input.displayName;
    if (input.description !== undefined)
        updateData.description = input.description;

    if (Object.keys(updateData).length > 0) {
        await prisma.stack.update({where: {id}, data: updateData});
    }

    return getStack(id);
}

export async function deleteStack(id: string) {
    const stack = await prisma.stack.findUnique({where: {id}});
    if (!stack) {
        throw new NotFoundError(`Stack "${id}" not found`);
    }

    const allowed = ["DRAFT", "STOPPED", "ERROR"];
    if (!allowed.includes(stack.status)) {
        throw new BadRequestError(
            `Cannot delete stack in "${stack.status}" status. Must be DRAFT, STOPPED, or ERROR.`,
        );
    }

    const stackPath = getStackPath(id);
    await fs.rm(stackPath, {recursive: true, force: true});
    await prisma.stack.delete({where: {id}});
}

export async function getComposeContent(id: string): Promise<string> {
    const stack = await prisma.stack.findUnique({where: {id}});
    if (!stack) {
        throw new NotFoundError(`Stack "${id}" not found`);
    }

    try {
        return await fs.readFile(getComposePath(id), "utf-8");
    } catch {
        return "";
    }
}

export async function getEnvContent(id: string): Promise<string> {
    const stack = await prisma.stack.findUnique({where: {id}});
    if (!stack) {
        throw new NotFoundError(`Stack "${id}" not found`);
    }

    try {
        return await fs.readFile(getEnvPath(id), "utf-8");
    } catch {
        return "";
    }
}
