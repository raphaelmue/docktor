import type {FastifyPluginAsyncZod} from "fastify-type-provider-zod";
import {createStackSchema, stackParamsSchema, updateStackSchema,} from "@docktor/shared";
import {requireAuth} from "../lib/auth-middleware.js";
import {stackService} from "../application/index.js";

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
    app.get("/api/s<tacks/:id", {
        schema: {params: stackParamsSchema},
    }, async (request) => {
        return stackService.getStack(request.params.id);
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
};

export default stackRoutes;
