import type {FastifyPluginAsyncZod} from "fastify-type-provider-zod";
import {z} from "zod";
import {prisma} from "../lib/db.js";
import {onboardingService} from "../application/onboarding-service.js";
import {brownfieldScanner} from "../infrastructure/brownfield-scanner.js";
import {migrationService} from "../application/migration-service.js";
import {
    wizardStep1Schema,
    wizardStep2Schema,
    wizardStep3Schema,
    wizardStep4Schema,
    wizardStep5Schema,
} from "@docktor/shared";
import fs from "node:fs/promises";

const setupRoutes: FastifyPluginAsyncZod = async (app) => {
    // CR-01: every /api/setup/* route beyond step 1 must stop being reachable
    // once setup is complete — otherwise an unauthenticated caller can rewrite
    // backup/SMTP credentials or trigger filesystem scans/migrations forever.
    app.addHook("preHandler", async (request, reply) => {
        if (request.method === "GET" && request.url === "/api/setup/status") return;
        if (request.url === "/api/setup/step1") return;

        const userCount = await prisma.user.count();
        if (userCount > 0) {
            return reply.status(410).send({error: "Setup already complete"});
        }
    });

    // Check if setup is complete (users exist)
    app.get("/api/setup/status", async () => {
        const userCount = await prisma.user.count();
        return {setupComplete: userCount > 0};
    });

    // Step 1: Create admin account (public)
    app.post(
        "/api/setup/step1",
        {
            schema: {
                body: wizardStep1Schema,
            },
        },
        async (request, reply) => {
            // Prevent creating more users if setup is complete
            const userCount = await prisma.user.count();
            if (userCount > 0) {
                return reply.status(400).send({error: "Setup already complete"});
            }

            const result = await onboardingService.handleWizardStep1(request.body);
            return result;
        },
    );

    // Step 2: Configure instance settings (requires auth after step 1)
    app.post(
        "/api/setup/step2",
        {
            schema: {
                body: wizardStep2Schema,
            },
        },
        async (request) => {
            await onboardingService.handleWizardStep2(request.body);
            return {success: true};
        },
    );

    // Step 3: Configure backup repository (optional)
    app.post(
        "/api/setup/step3",
        {
            schema: {
                body: wizardStep3Schema,
            },
        },
        async (request) => {
            await onboardingService.handleWizardStep3(request.body);
            return {success: true};
        },
    );

    // Step 4: Configure SMTP (optional)
    app.post(
        "/api/setup/step4",
        {
            schema: {
                body: wizardStep4Schema,
            },
        },
        async (request) => {
            await onboardingService.handleWizardStep4(request.body);
            return {success: true};
        },
    );

    // Step 5: Brownfield scan
    app.post(
        "/api/setup/scan",
        {
            schema: {
                body: wizardStep5Schema,
            },
        },
        async (request) => {
            const {directories} = request.body;
            const result = await brownfieldScanner.scan(directories);
            return result;
        },
    );

    // Adopt stack in-place
    app.post(
        "/api/setup/adopt",
        {
            schema: {
                body: z.object({
                    composePath: z.string(),
                    displayName: z.string().min(1),
                }),
            },
        },
        async (request) => {
            const {composePath, displayName} = request.body;
            const content = await fs.readFile(composePath, "utf-8");
            const result = await onboardingService.adoptInPlace(composePath, displayName, content);
            return result;
        },
    );

    // Preview migration changes
    app.post(
        "/api/setup/migrate/preview",
        {
            schema: {
                body: z.object({
                    composePath: z.string(),
                    volumeSelections: z.array(z.object({
                        originalPath: z.string(),
                        newPath: z.string(),
                        convert: z.boolean(),
                    })),
                    namedVolumeSelections: z.record(z.string(), z.boolean()),
                }),
            },
        },
        async (request) => {
            const {composePath, volumeSelections, namedVolumeSelections} = request.body;
            const namedVolMap = new Map(Object.entries(namedVolumeSelections) as [string, boolean][]);
            const result = await migrationService.previewMigration(composePath, volumeSelections, namedVolMap);
            return result;
        },
    );

    // Execute migration
    app.post(
        "/api/setup/migrate",
        {
            schema: {
                body: z.object({
                    composePath: z.string(),
                    displayName: z.string().min(1),
                    volumeSelections: z.array(z.object({
                        originalPath: z.string(),
                        newPath: z.string(),
                        convert: z.boolean(),
                    })),
                    namedVolumeSelections: z.record(z.string(), z.boolean()),
                }),
            },
        },
        async (request) => {
            const {composePath, displayName, volumeSelections, namedVolumeSelections} = request.body;
            const namedVolMap = new Map(Object.entries(namedVolumeSelections) as [string, boolean][]);
            const result = await migrationService.migrate({
                composePath,
                displayName,
                volumeSelections,
                namedVolumeSelections: namedVolMap,
            });
            return result;
        },
    );
};

export default setupRoutes;
