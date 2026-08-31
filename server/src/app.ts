import type {FastifyError} from "fastify";
import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import fastifyCookie from "@fastify/cookie";
import fastifyCors from "@fastify/cors";
import {serializerCompiler, validatorCompiler, type ZodTypeProvider,} from "fastify-type-provider-zod";
import path from "node:path";
import {fileURLToPath} from "node:url";
import setupRoutes from "./routes/setup.js";
import authRoutes from "./routes/auth.js";
import stackRoutes from "./routes/stacks.js";
import settingsRoutes from "./routes/settings.js";
import eventsRoutes from "./routes/events.js";
import notificationRoutes from "./routes/notifications.js";
import backupRoutes from "./routes/backups.js";
import {AppError} from "./lib/errors.js";
import {startJobs, stopJobs} from "./jobs/index.js";
import {prisma} from "./lib/db.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// WR-01: shape of a single validation issue attached to FastifyError by
// fastify-type-provider-zod (Zod-style `path`) or ajv (`instancePath`).
interface ValidationIssue {
    path?: Array<string | number>;
    instancePath?: string;
    message: string;
}

const envToLogger: Record<string, object | boolean> = {
    development: {
        transport: {
            target: "pino-pretty",
            options: {translateTime: "HH:MM:ss Z", ignore: "pid,hostname,reqId,req,res"},
        },
        level: "info",
    },
    production: {
        level: "warn",
    },
    test: false,
};

export async function buildApp() {
    const env = process.env.NODE_ENV ?? "development";

    const app = Fastify({
        logger: envToLogger[env] ?? true,
        disableRequestLogging: true,
    }).withTypeProvider<ZodTypeProvider>();

    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);

    await app.register(fastifyCors, {
        origin: env === "development" ? "http://localhost:5173" : false,
        credentials: true,
    });

    await app.register(fastifyCookie);

    // First-run detection: redirect to setup wizard if no users exist
    app.addHook("onRequest", async (request, reply) => {
        // Skip for setup routes, auth routes, and static assets
        if (
            request.url.startsWith("/api/setup") ||
            request.url.startsWith("/api/auth/") ||
            request.url === "/setup" ||
            !request.url.startsWith("/api/")
        ) {
            return;
        }

        // Check if any users exist
        const userCount = await prisma.user.count();

        if (userCount === 0) {
            return reply.status(503).send({
                error: "Setup required",
                redirectTo: "/setup",
            });
        }
    });

    // Global error handler for AppError subclasses
    app.setErrorHandler((error: FastifyError | AppError, _request, reply) => {
        if (error instanceof AppError) {
            return reply.status(error.statusCode).send({error: error.message});
        }
        // Zod validation errors (from type-provider-zod validator compiler)
        if (error.statusCode === 400 && "validation" in error) {
            // Safe: fastify-type-provider-zod attaches a `validation` array to
            // FastifyError on validation failures; the base FastifyError type
            // doesn't declare this field, but its shape is documented by the
            // plugin (Zod issues use `path`, ajv-style issues use `instancePath`).
            const issues = (error as FastifyError & {validation?: ValidationIssue[]}).validation ?? []
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
    await app.register(setupRoutes);
    await app.register(authRoutes);
    await app.register(stackRoutes);
    await app.register(settingsRoutes);
    await app.register(eventsRoutes);
    await app.register(notificationRoutes);
    await app.register(backupRoutes);

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
