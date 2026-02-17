import type {FastifyPluginAsync} from "fastify";
import {createStackSchema, updateStackSchema} from "@docktor/shared";
import {requireAuth} from "../lib/auth-middleware.js";
import * as stackService from "../services/stack-service.js";
import * as dockerService from "../services/docker-service.js";

const stackRoutes: FastifyPluginAsync = async (app) => {
    app.addHook("onRequest", requireAuth);

    // List all stacks
    app.get("/api/stacks", async () => {
        return stackService.listStacks();
    });

    // Create stack
    app.post("/api/stacks", async (request, reply) => {
        const input = createStackSchema.parse(request.body);
        const stack = await stackService.createStack(input);
        return reply.status(201).send(stack);
    });

    // Get stack detail
    app.get<{Params: {id: string}}>("/api/stacks/:id", async (request) => {
        return stackService.getStack(request.params.id);
    });

    // Update stack
    app.put<{Params: {id: string}}>("/api/stacks/:id", async (request) => {
        const input = updateStackSchema.parse(request.body);
        return stackService.updateStack(request.params.id, input);
    });

    // Delete stack
    app.delete<{Params: {id: string}}>(
        "/api/stacks/:id",
        async (request, reply) => {
            await stackService.deleteStack(request.params.id);
            return reply.status(204).send();
        },
    );

    // Deploy stack
    app.post<{Params: {id: string}}>(
        "/api/stacks/:id/deploy",
        async (request) => {
            return dockerService.deployStack(request.params.id);
        },
    );

    // Stop stack
    app.post<{Params: {id: string}}>(
        "/api/stacks/:id/stop",
        async (request) => {
            await dockerService.stopStack(request.params.id);
            return {success: true};
        },
    );

    // Restart stack
    app.post<{Params: {id: string}}>(
        "/api/stacks/:id/restart",
        async (request) => {
            await dockerService.restartStack(request.params.id);
            return {success: true};
        },
    );

    // Get compose file content
    app.get<{Params: {id: string}}>(
        "/api/stacks/:id/compose",
        async (request) => {
            const content = await stackService.getComposeContent(
                request.params.id,
            );
            return {content};
        },
    );

    // Get env file content
    app.get<{Params: {id: string}}>(
        "/api/stacks/:id/env",
        async (request) => {
            const content = await stackService.getEnvContent(
                request.params.id,
            );
            return {content};
        },
    );

    // Get live container statuses
    app.get<{Params: {id: string}}>(
        "/api/stacks/:id/containers",
        async (request) => {
            return dockerService.getContainerStatuses(request.params.id);
        },
    );
};

export default stackRoutes;
