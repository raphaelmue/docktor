import type {FastifyError} from "fastify";
import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import fastifyCookie from "@fastify/cookie";
import fastifyCors from "@fastify/cors";
import {serializerCompiler, validatorCompiler, type ZodTypeProvider,} from "fastify-type-provider-zod";
import path from "node:path";
import {fileURLToPath} from "node:url";
import authRoutes from "./routes/auth.js";
import stackRoutes from "./routes/stacks.js";
import {AppError} from "./lib/errors.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const envToLogger: Record<string, object | boolean> = {
    development: {
        transport: {
            target: "pino-pretty",
            options: {translateTime: "HH:MM:ss Z", ignore: "pid,hostname"},
        },
    },
    production: true,
};

const env = process.env.NODE_ENV ?? "development";

const app = Fastify({
    logger: envToLogger[env] ?? true,
}).withTypeProvider<ZodTypeProvider>();

app.setValidatorCompiler(validatorCompiler);
app.setSerializerCompiler(serializerCompiler);

await app.register(fastifyCors, {
    origin: env === "development" ? "http://localhost:5173" : false,
    credentials: true,
});

await app.register(fastifyCookie);

// Global error handler for AppError subclasses
app.setErrorHandler((error: FastifyError | AppError, _request, reply) => {
    if (error instanceof AppError) {
        return reply.status(error.statusCode).send({error: error.message});
    }
    // Zod validation errors (from type-provider-zod validator compiler)
    if (error.statusCode === 400 && "validation" in error) {
        return reply.status(400).send({
            error: "Validation error",
            details: (error as any).validation,
        });
    }
    if (error.name === "ZodError") {
        return reply.status(400).send({error: error.message});
    }
    app.log.error(error);
    reply.status(500).send({error: "Internal server error"});
});

// API routes
await app.register(authRoutes);
await app.register(stackRoutes);
// TODO: Register additional route plugins here
// await app.register(settingsRoutes, { prefix: "/api/settings" });
// await app.register(backupRoutes, { prefix: "/api/backups" });

// In production, serve the built client SPA
const clientDistPath =
    process.env.CLIENT_DIST_PATH ?? path.join(__dirname, "../../client/dist");

if (env === "production") {
    await app.register(fastifyStatic, {
        root: path.resolve(clientDistPath),
        prefix: "/",
        wildcard: false,
    });

    // SPA fallback: serve index.html for all non-API routes
    app.setNotFoundHandler((request, reply) => {
        if (request.url.startsWith("/api/")) {
            return reply.status(404).send({error: "Not found"});
        }
        return reply.sendFile("index.html");
    });
}

const port = parseInt(process.env.PORT ?? "3000", 10);
const host = process.env.HOST ?? "0.0.0.0";

try {
    await app.listen({port, host});
} catch (err) {
    app.log.error(err);
    process.exit(1);
}
