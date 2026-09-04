import type {FastifyPluginAsyncZod} from "fastify-type-provider-zod";
import {z} from "zod";
import {requireAuth} from "../lib/auth-middleware.js";
import {onboardingService} from "../application/onboarding-service.js";
import {brownfieldScanner} from "../infrastructure/brownfield-scanner.js";
import {migrationService} from "../application/migration-service.js";
import {wizardStep5Schema} from "@docktor/shared";

// T-05.1-32/T-05.1-33: this plugin gives an authenticated user, after the
// setup wizard has closed, its own reachable copy of the brownfield
// scan/adopt/migrate capability that server/src/routes/setup.ts exposes only
// while the wizard is incomplete. Every route here is gated by requireAuth
// as the plugin's very first statement — the exact regression guard against
// the original filed blocker (unauthenticated /api/setup/scan + /adopt).
const importRoutes: FastifyPluginAsyncZod = async (app) => {
    app.addHook("onRequest", requireAuth);

    // Scan filesystem for existing compose stacks
    app.post(
        "/api/stacks/import/scan",
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

    // Adopt a discovered stack in-place
    app.post(
        "/api/stacks/import/adopt",
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
            const result = await onboardingService.adoptInPlace(composePath, displayName);
            return result;
        },
    );

    // Preview migration changes
    app.post(
        "/api/stacks/import/migrate/preview",
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
        "/api/stacks/import/migrate",
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

export default importRoutes;
