import type {FastifyPluginAsyncZod} from "fastify-type-provider-zod";
import {z} from "zod";
import {createStackSchema, stackParamsSchema, updateStackSchema,} from "@docktor/shared";
import {requireAuth} from "../lib/auth-middleware.js";
import {stackService} from "../application/index.js";
import {prisma} from "../lib/db.js";
import {dockerodeClient} from "../infrastructure/dockerode-client.js";
import {processDockerLogChunk, type LogLineEvent} from "../lib/docker-log-parser.js";
import {normalizeImageRef} from "../jobs/update-checker.js";
import {imageUpdateCheckRepository} from "../repositories/image-update-check-repository.js";

const stackRoutes: FastifyPluginAsyncZod = async (app) => {
    app.addHook("onRequest", requireAuth);

    // List all stacks
    app.get("/api/stacks", async () => {
        return stackService.listStacks();
    });

    // Create stack
    app.post("/api/stacks", {
        schema: {body: createStackSchema},
    }, async (request, reply) => {
        const stack = await stackService.createStack(request.body);
        return reply.status(201).send(stack);
    });

    // Get stack detail
    app.get("/api/stacks/:id", {
        schema: {params: stackParamsSchema},
    }, async (request, reply) => {
        const stack = await stackService.getStack(request.params.id);
        if (!stack) {
            return reply.status(404).send({error: "Stack not found"});
        }

        // Load update check results for this stack's service images
        const imageRefs = stack.services.map((s) => normalizeImageRef(s.image));
        const updateChecks = await imageUpdateCheckRepository.findByImageRefs(imageRefs);
        const updateMap = new Map(updateChecks.map((u) => [u.imageRef, u]));

        return {
            ...stack,
            services: stack.services.map((svc) => ({
                ...svc,
                updateAvailable: updateMap.get(normalizeImageRef(svc.image))?.hasUpdate ?? false,
                latestTag: updateMap.get(normalizeImageRef(svc.image))?.latestTag ?? null,
            })),
        };
    });

    // Update stack
    app.put("/api/stacks/:id", {
        schema: {params: stackParamsSchema, body: updateStackSchema},
    }, async (request) => {
        return stackService.updateStack(request.params.id, request.body);
    });

    // Delete stack
    app.delete("/api/stacks/:id", {
        schema: {params: stackParamsSchema},
    }, async (request, reply) => {
        await stackService.deleteStack(request.params.id);
        return reply.status(204).send();
    });

    // Deploy stack
    app.post("/api/stacks/:id/deploy", {
        schema: {params: stackParamsSchema},
    }, async (request) => {
        return stackService.deployStack(request.params.id);
    });

    // Stop stack
    app.post("/api/stacks/:id/stop", {
        schema: {params: stackParamsSchema},
    }, async (request) => {
        await stackService.stopStack(request.params.id);
        return {success: true};
    });

    // Restart stack
    app.post("/api/stacks/:id/restart", {
        schema: {params: stackParamsSchema},
    }, async (request) => {
        await stackService.restartStack(request.params.id);
        return {success: true};
    });

    // Trigger image pull + container recreate (user-initiated, never automatic)
    app.post("/api/stacks/:id/update", {
        schema: {params: stackParamsSchema},
    }, async (request) => {
        await stackService.updateImages(request.params.id);
        return {success: true};
    });

    // Get compose file content
    app.get("/api/stacks/:id/compose", {
        schema: {params: stackParamsSchema},
    }, async (request) => {
        const content = await stackService.getComposeContent(
            request.params.id,
        );
        return {content};
    });

    // Get env file content
    app.get("/api/stacks/:id/env", {
        schema: {params: stackParamsSchema},
    }, async (request) => {
        const content = await stackService.getEnvContent(
            request.params.id,
        );
        return {content};
    });

    // Get live container statuses
    app.get("/api/stacks/:id/containers", {
        schema: {params: stackParamsSchema},
    }, async (request) => {
        return stackService.getContainerStatuses(request.params.id);
    });

    // Log stream query schema
    const logQuerySchema = z.object({
        service: z.string().optional().default("all"),
    })

    // Stream logs via SSE
    app.get("/api/stacks/:id/logs", {
        schema: {params: stackParamsSchema, querystring: logQuerySchema},
    }, async (request, reply) => {
        const {id} = request.params
        const {service} = request.query

        // Load stack services with containerIds from DB
        const stack = await prisma.stack.findUnique({
            where: {id},
            include: {services: {where: {containerId: {not: null}}}},
        })
        if (!stack) {
            return reply.status(404).send({error: "Stack not found"})
        }

        // Determine which services to stream
        const allServices = stack.services as Array<{serviceName: string; containerId: string | null}>
        const targetServices = service === "all"
            ? allServices
            : allServices.filter(s => s.serviceName === service)

        if (targetServices.length === 0) {
            return reply.status(400).send({error: `No running containers for service "${service}"`})
        }

        reply.raw.writeHead(200, {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        })
        reply.raw.write(": connected\n\n")

        const streams: NodeJS.ReadableStream[] = []

        for (const svc of targetServices) {
            const logStream = await dockerodeClient.getLogStream(svc.containerId!, 100)
            streams.push(logStream)

            logStream.on("data", (chunk: Buffer) => {
                processDockerLogChunk(chunk, svc.serviceName, (event) => {
                    reply.raw.write(`data: ${JSON.stringify(event)}\n\n`)
                })
            })
        }

        // MANDATORY: destroy all streams on client disconnect
        request.raw.on("close", () => {
            streams.forEach(s => (s as any).destroy())
        })

        await new Promise<void>((resolve) => {
            request.raw.on("close", resolve)
        })
    })
};

export default stackRoutes;
