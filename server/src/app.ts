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
import settingsRoutes from "./routes/settings.js";
import eventsRoutes from "./routes/events.js";
import notificationRoutes from "./routes/notifications.js";
import {AppError} from "./lib/errors.js";
import {startJobs, stopJobs} from "./jobs/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const envToLogger: Record<string, object | boolean> = {
    development: {
        transport: {
            target: "pino-pretty",
            options: {translateTime: "HH:MM:ss Z", ignore: "pid,hostname"},
        },
    },
    production: true,
    test: false,
};

export async function buildApp() {
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
            const issues: any[] = (error as any).validation ?? []
            const fields: Record<string, string> = {}
            for (const issue of issues) {
                // Zod issues: { path: ["fieldName", ...], message: "..." }
                const field = Array.isArray(issue.path) ? issue.path[0] : issue.instancePath?.replace(/^\//, "")
                if (field) fields[String(field)] = issue.message
            }
            return reply.status(400).send({
                error: "Validation error",
                fields: Object.keys(fields).length > 0 ? fields : undefined,
                details: issues,
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
    await app.register(settingsRoutes);
    await app.register(eventsRoutes);
    await app.register(notificationRoutes);

    // Jobs: start/stop with server lifecycle (skipped in test environment)
    if (process.env.NODE_ENV !== "test") {
        app.addHook("onReady", async () => {
            await startJobs();
            app.log.info("Jobs started");
        });

        app.addHook("onClose", async () => {
            stopJobs();
            app.log.info("Jobs stopped");
        });
    }

    // In production, serve the built client SPA
    const clientDistPath =
        process.env.CLIENT_DIST_PATH ??
        path.join(__dirname, "../../client/dist");

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

    return app;
}
