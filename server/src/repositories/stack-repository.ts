import {prisma} from "../lib/db.js";
import {NotFoundError} from "../lib/errors.js";
import type {StackStatus} from "../generated/prisma/enums.js";
import type {ComposeConfig} from "../domain/compose-config.js";
import path from "node:path";

export class StackRepository {
    async findByIdOrThrow(id: string) {
        const stack = await prisma.stack.findUnique({where: {id}});
        if (!stack) {
            throw new NotFoundError(`Stack "${id}" not found`);
        }
        return stack;
    }

    async findByIdWithRelations(id: string) {
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

    async findAll() {
        return prisma.stack.findMany({
            include: {services: true},
            orderBy: {createdAt: "desc"},
        });
    }

    async exists(id: string): Promise<boolean> {
        const stack = await prisma.stack.findUnique({where: {id}});
        return stack !== null;
    }

    async create(data: {
        id: string;
        displayName: string;
        description?: string | null;
        hostPath: string;
        composeConfig: ComposeConfig;
    }) {
        return prisma.stack.create({
            data: {
                id: data.id,
                displayName: data.displayName,
                description: data.description ?? null,
                hostPath: data.hostPath,
                lastKnownHash: data.composeConfig.hash,
                lastParsedAt: new Date(),
                services: {
                    create: data.composeConfig.services.map((s) => ({
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
    }

    async transitionStatus(
        id: string,
        fromStatus: StackStatus,
        toStatus: StackStatus,
        message?: string,
    ) {
        await prisma.$transaction([
            prisma.stack.update({
                where: {id},
                data: {
                    status: toStatus,
                    previousStatus: fromStatus,
                },
            }),
            prisma.statusLog.create({
                data: {
                    stackId: id,
                    fromStatus,
                    toStatus,
                    message,
                },
            }),
        ]);
    }

    async replaceServices(stackId: string, composeConfig: ComposeConfig) {
        await prisma.$transaction([
            prisma.service.deleteMany({where: {stackId}}),
            prisma.service.createMany({
                data: composeConfig.services.map((s) => ({
                    stackId,
                    serviceName: s.serviceName,
                    image: s.image,
                    imageTag: s.imageTag,
                    ports: s.ports.length ? JSON.stringify(s.ports) : null,
                    volumes: s.volumes.length
                        ? JSON.stringify(s.volumes)
                        : null,
                })),
            }),
            prisma.stack.update({
                where: {id: stackId},
                data: {
                    lastKnownHash: composeConfig.hash,
                    lastParsedAt: new Date(),
                },
            }),
        ]);
    }

    async updateMetadata(
        id: string,
        data: {displayName?: string; description?: string},
    ) {
        const updateData: Record<string, unknown> = {};
        if (data.displayName !== undefined)
            updateData.displayName = data.displayName;
        if (data.description !== undefined)
            updateData.description = data.description;

        if (Object.keys(updateData).length > 0) {
            await prisma.stack.update({where: {id}, data: updateData});
        }
    }

    async setConfigChanged(id: string, changed: boolean) {
        await prisma.stack.update({
            where: {id},
            data: {configChanged: changed},
        });
    }

    async recordDeployment(data: {
        stackId: string;
        composeHash: string;
        success: boolean;
        errorMessage?: string | null;
    }) {
        await prisma.deployment.create({
            data: {
                stackId: data.stackId,
                composeHash: data.composeHash,
                success: data.success,
                errorMessage: data.errorMessage ?? null,
            },
        });
    }

    async clearConfigChanged(id: string) {
        await prisma.stack.update({
            where: {id},
            data: {configChanged: false},
        });
    }

    async delete(id: string) {
        await prisma.stack.delete({where: {id}});
    }

    async findByComposeProject(composeProject: string) {
        return prisma.stack.findUnique({
            where: {id: composeProject},
            include: {services: true},
        });
    }

    async updateServiceState(data: {
        stackId: string;
        serviceName: string;
        containerId: string;
        containerState: string;
        healthStatus: string | null;
    }) {
        await prisma.service.updateMany({
            where: {stackId: data.stackId, serviceName: data.serviceName},
            data: {
                containerId: data.containerId,
                containerState: data.containerState,
                healthStatus: data.healthStatus,
            },
        });
    }

    async updateStackStatus(stackId: string, status: StackStatus) {
        // Get current status to check if it changed
        const current = await prisma.stack.findUnique({
            where: {id: stackId},
            select: {status: true},
        });

        if (!current) return null;

        const fromStatus = current.status as StackStatus;

        // Only update if status actually changed
        if (fromStatus === status) return null;

        // Update status and create log entry in a transaction
        const [, statusLog] = await prisma.$transaction([
            prisma.stack.update({
                where: {id: stackId},
                data: {
                    status,
                    previousStatus: fromStatus,
                },
            }),
            prisma.statusLog.create({
                data: {
                    stackId,
                    fromStatus,
                    toStatus: status,
                    message: "Status detected via container events",
                },
            }),
        ]);

        return statusLog;
    }

    // FileWatcher interface methods
    async findAllStacks() {
        const stacks = await prisma.stack.findMany({
            select: {
                id: true,
                hostPath: true,
                lastKnownHash: true,
            },
        });
        return stacks.map((s) => ({
            id: s.id,
            composeFilePath: `${s.hostPath}/docker-compose.yml`,
            hash: s.lastKnownHash,
        }));
    }

    async findStackByPath(composePath: string) {
        // Extract hostPath from composePath (remove docker-compose.yml)
        // Normalize both paths to handle cross-platform differences
        const normalizedComposePath = path.normalize(composePath);
        const hostPath = path.dirname(normalizedComposePath);

        // Try exact match first
        let stack = await prisma.stack.findFirst({
            where: {hostPath},
            select: {
                id: true,
                hostPath: true,
                lastKnownHash: true,
            },
        });

        // If not found, try case-insensitive search (Windows is case-insensitive)
        if (!stack && process.platform === "win32") {
            const allStacks = await prisma.stack.findMany({
                select: {id: true, hostPath: true, lastKnownHash: true},
            });
            stack = allStacks.find(
                (s) => s.hostPath.toLowerCase() === hostPath.toLowerCase()
            ) ?? null;
        }

        if (!stack) return null;
        return {
            id: stack.id,
            composeFilePath: composePath,
            hash: stack.lastKnownHash,
        };
    }

    async updateStackHash(args: {stackId: string; hash: string}) {
        await prisma.stack.update({
            where: {id: args.stackId},
            data: {
                lastKnownHash: args.hash,
                lastParsedAt: new Date(),
                configChanged: true,
            },
        });
    }

    async createStackEvent(args: {
        stackId: string;
        type: string;
        message?: string;
        payload?: string;
    }) {
        await prisma.stackEvent.create({
            data: {
                stackId: args.stackId,
                type: args.type as any, // StackEventType enum
                message: args.message ?? null,
                payload: args.payload ?? null,
            },
        });
    }
}

export const stackRepository = new StackRepository();
