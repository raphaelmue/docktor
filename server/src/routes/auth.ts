import type {FastifyPluginAsync} from "fastify";
import {auth} from "../lib/auth.js";
import {toNodeHandler} from "better-auth/node";

const authRoutes: FastifyPluginAsync = async (app) => {
    const handler = toNodeHandler(auth);

    // Prevent Fastify from consuming the request body —
    // better-auth needs to read the raw stream itself.
    app.removeAllContentTypeParsers();
    app.addContentTypeParser("*", function (_request, _payload, done) {
        done(null);
    });

    app.all("/api/auth/*", async (request, reply) => {
        reply.hijack();
        return handler(request.raw, reply.raw);
    });
};

export default authRoutes;
