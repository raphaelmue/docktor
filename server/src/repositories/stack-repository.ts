import {prisma} from "../lib/db.js";
import {NotFoundError} from "../lib/errors.js";
import type {StackStatus} from "../generated/prisma/enums.js";
import type {ComposeConfig} from "../domain/compose-config.js";

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
}

export const stackRepository = new StackRepository();
