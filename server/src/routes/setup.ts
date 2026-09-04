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
    wizardStep6Schema,
} from "@docktor/shared";

// WR-07: unique-key row used as an atomic "first admin" lock — see step1
// handler below. `Setting.key` is the table's primary key, so Postgres
// itself guarantees only one concurrent insert can ever win.
const SETUP_STEP1_LOCK_KEY = "setup.step1Lock";

const setupRoutes: FastifyPluginAsyncZod = async (app) => {
    // CR-01/T-05-09: every /api/setup/* route beyond step 1 must stop being
    // reachable once the wizard is genuinely finished — otherwise an
    // unauthenticated caller can rewrite backup/SMTP credentials or trigger
    // filesystem scans/migrations forever. Gate on the durable
    // `isWizardComplete()` marker, NOT on `userCount > 0`: step1 creates the
    // admin, so userCount becomes 1 the instant step1 succeeds — long before
    // steps 2-5/adopt/migrate are actually done. Gating on userCount alone
    // 410s the just-created admin out of their own wizard after step 1.
    app.addHook("preHandler", async (request, reply) => {
        if (request.method === "GET" && request.url === "/api/setup/status") return;
        if (request.url === "/api/setup/step1") return;

        if (await onboardingService.isWizardComplete()) {
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

            // WR-07: the count-then-create sequence above is not atomic — two
            // concurrent requests (double-clicked "Next", two browser tabs)
            // could both observe userCount === 0 and both proceed. Atomically
            // claim a one-time lock row before creating the account; the
            // unique primary key on Setting.key means Postgres guarantees
            // only one concurrent insert can win, so a losing request is
            // rejected here before it ever reaches signUpEmail. The lock is
            // always released afterward (`finally`) — it only needs to
            // survive the race window, since `userCount > 0` becomes the
            // durable "already complete" guard for every request from then on.
            try {
                await prisma.setting.create({
                    data: {key: SETUP_STEP1_LOCK_KEY, value: new Date().toISOString()},
                });
            } catch {
                return reply.status(400).send({error: "Setup already complete"});
            }

            try {
                const result = await onboardingService.handleWizardStep1(request.body);
                return result;
            } finally {
                await prisma.setting.delete({where: {key: SETUP_STEP1_LOCK_KEY}}).catch(() => {});
            }
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
            // WR-05: file I/O now lives in OnboardingService.adoptInPlace —
            // the route only extracts/validates the body and delegates.
            const result = await onboardingService.adoptInPlace(composePath, displayName);
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

    // Step 6: Deploy the managed proxy stack (optional, terminal step — D-09/D-10)
    app.post(
        "/api/setup/step6",
        {
            schema: {
                body: wizardStep6Schema,
            },
        },
        async (request, reply) => {
            // The plugin's preHandler above only closes this route once the
            // wizard is *finished* (isWizardComplete()) — before an admin
            // exists it would otherwise stay reachable, since userCount only
            // becomes >0 once step1 succeeds. Mirrors /api/setup/complete's
            // own guard below.
            const userCount = await prisma.user.count();
            if (userCount === 0) {
                return reply
                    .status(400)
                    .send({error: "Cannot deploy the proxy stack before creating an admin account"});
            }

            await onboardingService.handleWizardStep6(request.body);
            return {success: true};
        },
    );

    // T-05-09: mark the wizard as fully complete. Called once by the client
    // at the very end of the wizard (Finish, or Skip on the final step).
    // After this succeeds, the preHandler above permanently closes every
    // /api/setup/* route beyond /status, same as the old (broken)
    // "userCount > 0" gate intended.
    app.post("/api/setup/complete", async (_request, reply) => {
        const userCount = await prisma.user.count();
        if (userCount === 0) {
            return reply
                .status(400)
                .send({error: "Cannot complete setup before creating an admin account"});
        }

        await onboardingService.completeWizard();
        return reply.send({success: true});
    });
};

export default setupRoutes;
