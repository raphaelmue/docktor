import type {FastifyPluginAsyncZod} from "fastify-type-provider-zod";
import {z} from "zod";
import {createStackSchema, stackParamsSchema, stackServiceParamsSchema, updateStackSchema,} from "@docktor/shared";
import {requireAuth} from "../lib/auth-middleware.js";
import {stackService} from "../application/index.js";
import {prisma} from "../lib/db.js";
import {dockerodeClient} from "../infrastructure/dockerode-client.js";
import {processDockerLogChunk, type LogLineEvent} from "../lib/docker-log-parser.js";
import {buildImageRefFromService} from "../jobs/update-checker.js";
import {imageUpdateCheckRepository} from "../repositories/image-update-check-repository.js";
import {NotFoundError} from "../lib/errors.js";

/**
 * Decodes the JSON-encoded availableTags column into a candidate array,
 * newest first, alongside the persisted latestTag. Never throws — a
 * not-yet-checked image (no row) or an unparsable/absent column is a
 * normal state, not an error, and must yield an empty candidate list.
 */
function decodeUpgradeCandidates(
    row: {latestTag: string | null; availableTags: string | null} | null,
): {latestTag: string | null; candidates: string[]} {
    if (!row?.availableTags) return {latestTag: row?.latestTag ?? null, candidates: []};
    try {
        const parsed = JSON.parse(row.availableTags);
        const candidates = Array.isArray(parsed) ? parsed.filter((t): t is string => typeof t === "string") : [];
        return {latestTag: row.latestTag, candidates};
    } catch {
        return {latestTag: row.latestTag, candidates: []};
    }
}

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

        // Load update check results for this stack's service images. The
        // lookup key must reconstruct the same tag-qualified ref that
        // UpdateChecker.findAllImageRefs() persists (image + imageTag), not
        // just the untagged `image` column — otherwise a service on an
        // explicit tag never matches its own ImageUpdateCheck row.
        const serviceKeys = stack.services.map((svc) => ({
            svc,
            key: buildImageRefFromService(svc.image, svc.imageTag),
        }));
        const imageRefs = serviceKeys
            .map(({key}) => key)
            .filter((key): key is string => key !== null);
        const updateChecks = await imageUpdateCheckRepository.findByImageRefs(imageRefs);
        const updateMap = new Map(updateChecks.map((u) => [u.imageRef, u]));

        return {
            ...stack,
            services: serviceKeys.map(({svc, key}) => ({
                ...svc,
                updateAvailable: (key !== null ? updateMap.get(key)?.hasUpdate : undefined) ?? false,
                latestTag: (key !== null ? updateMap.get(key)?.latestTag : undefined) ?? null,
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
        const result = await stackService.updateImages(request.params.id);
        return {success: true, noUpdates: result.noUpdates};
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

    // Get persisted upgrade candidates for one service — reads only what the
    // staggered background check already persisted, never the registry.
    app.get("/api/stacks/:id/services/:serviceName/tags", {
        schema: {params: stackServiceParamsSchema},
    }, async (request) => {
        const {id, serviceName} = request.params;
        const stack = await stackService.getStack(id);
        if (!stack) throw new NotFoundError("Stack not found");

        // Resolved from the addressed stack's own service list only — this
        // scoping is the access control that prevents a guessed service name
        // from reading another stack's data.
        const svc = stack.services.find((s) => s.serviceName === serviceName);
        if (!svc) throw new NotFoundError("Service not found");

        const imageRef = buildImageRefFromService(svc.image, svc.imageTag);
        const row = imageRef ? await imageUpdateCheckRepository.findByImageRef(imageRef) : null;
        const {latestTag, candidates} = decodeUpgradeCandidates(row);

        return {currentTag: svc.imageTag ?? "latest", latestTag, candidates};
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
