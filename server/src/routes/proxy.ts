import type {FastifyPluginAsyncZod} from "fastify-type-provider-zod";
import {z} from "zod";
import {assignDomainSchema, proxySettingsSchema} from "@docktor/shared";
import {requireAuth} from "../lib/auth-middleware.js";
import {proxyService} from "../application/index.js";

const stackParamsSchema = z.object({id: z.string()});
const serviceParamsSchema = z.object({id: z.string(), serviceName: z.string()});
const proxyConfigParamsSchema = z.object({proxyConfigId: z.string()});

const proxyRoutes: FastifyPluginAsyncZod = async (app) => {
    app.addHook("onRequest", requireAuth);

    app.get(
        "/api/stacks/:id/proxy-configs",
        {schema: {params: stackParamsSchema}},
        async (request) => {
            return proxyService.listByStack(request.params.id);
        },
    );

    app.post(
        "/api/stacks/:id/services/:serviceName/proxy",
        {schema: {params: serviceParamsSchema, body: assignDomainSchema}},
        async (request, reply) => {
            const {id, serviceName} = request.params;
            const config = await proxyService.assignDomain(id, serviceName, request.body);
            return reply.status(201).send(config);
        },
    );

    app.delete(
        "/api/proxy-configs/:proxyConfigId",
        {schema: {params: proxyConfigParamsSchema}},
        async (request, reply) => {
            await proxyService.removeDomain(request.params.proxyConfigId);
            return reply.status(204).send();
        },
    );

    app.get("/api/settings/proxy", async () => {
        return proxyService.getProxyStackState();
    });

    app.put(
        "/api/settings/proxy",
        {schema: {body: proxySettingsSchema}},
        async (request) => {
            await proxyService.updateProxySettingsAndSync(request.body);
            return {success: true};
        },
    );

    app.post("/api/settings/proxy/deploy", async () => {
        await proxyService.deployProxyStack();
        return proxyService.getProxyStackState();
    });
};

export default proxyRoutes;
