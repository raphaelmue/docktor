import fs from "node:fs/promises";
import {auth} from "../lib/auth.js";
import {StackRepository} from "../repositories/stack-repository.js";
import {SettingsRepository} from "../repositories/settings-repository.js";
import {encrypt} from "../lib/crypto.js";
import {slugify} from "../lib/slugify.js";
import {AppError, BadRequestError, ConflictError} from "../lib/errors.js";
import {createComposeConfig} from "../domain/compose-config.js";
import type {
    WizardStep1Input,
    WizardStep2Input,
    WizardStep3Input,
    WizardStep4Input,
} from "@docktor/shared";

export interface Step1Result {
    user: {id: string; email: string; name: string | null};
    sessionToken: string;
}

// T-05-09: durable "wizard finished" signal, deliberately independent from
// `userCount`. Step1 creates the admin, so `userCount > 0` becomes true the
// instant step1 succeeds — long before steps 2-5/adopt/migrate are actually
// done. routes/setup.ts's preHandler gates on this marker instead, so the
// just-created admin can keep using the rest of the wizard, while the
// routes still become permanently unreachable once the wizard genuinely
// finishes. See completeWizard()/isWizardComplete() below.
export const SETUP_WIZARD_COMPLETE_KEY = "setup.wizardComplete";

export class OnboardingService {
    constructor(
        private readonly authClient: typeof auth.api,
        private readonly settingsRepo: SettingsRepository,
        private readonly cryptoLib: {encrypt: typeof encrypt},
        private readonly stackRepo: StackRepository,
        // WR-05: injectable so adoptInPlace's file read is unit-testable
        // without touching the real filesystem.
        private readonly fsLib: {readFile: typeof fs.readFile} = fs,
    ) {}

    /**
     * WIZ-02: Create admin account via better-auth signUpEmail
     * Returns session token for auto-login
     */
    async handleWizardStep1(input: WizardStep1Input): Promise<Step1Result> {
        const result = await this.authClient.signUpEmail({
            body: {
                email: input.email,
                password: input.password,
                name: input.email.split("@")[0], // Default name from email
            },
        });

        if (!result.user || !result.token) {
            // WR-03: unexpected upstream auth state, not a client input
            // problem — keep the default 500 but use the typed hierarchy.
            throw new AppError("Signup succeeded but no session returned");
        }

        return {
            user: {
                id: result.user.id,
                email: result.user.email,
                name: result.user.name,
            },
            sessionToken: result.token,
        };
    }

    /**
     * WIZ-03: Save instance settings (name, base URL, timezone)
     */
    async handleWizardStep2(input: WizardStep2Input): Promise<void> {
        await this.settingsRepo.upsert("instanceName", input.instanceName);
        await this.settingsRepo.upsert("baseUrl", input.baseUrl || "");
        await this.settingsRepo.upsert("timezone", input.timezone);
    }

    /**
     * WIZ-04: Save backup repository settings with encrypted password
     */
    async handleWizardStep3(input: WizardStep3Input): Promise<void> {
        if (!input.repoType) return; // User skipped or left empty

        await this.settingsRepo.upsert("backupRepoType", input.repoType);

        if (input.repoPath) {
            await this.settingsRepo.upsert("backupRepoPath", input.repoPath);
        }

        // SFTP-specific settings
        if (input.repoType === "sftp") {
            if (input.sftpHost)
                await this.settingsRepo.upsert("backupSftpHost", input.sftpHost);
            if (input.sftpUser)
                await this.settingsRepo.upsert("backupSftpUser", input.sftpUser);
        }

        // S3-specific settings
        if (input.repoType === "s3") {
            if (input.s3Endpoint)
                await this.settingsRepo.upsert("backupS3Endpoint", input.s3Endpoint);
            if (input.s3Bucket)
                await this.settingsRepo.upsert("backupS3Bucket", input.s3Bucket);
            if (input.s3AccessKey)
                await this.settingsRepo.upsert("backupS3AccessKey", input.s3AccessKey);
            if (input.s3SecretKey) {
                await this.settingsRepo.upsert(
                    "backupS3SecretKey",
                    this.cryptoLib.encrypt(input.s3SecretKey),
                );
            }
        }

        // Encrypt and save restic password
        if (input.password) {
            await this.settingsRepo.upsert(
                "backupPassword",
                this.cryptoLib.encrypt(input.password),
            );
        }
    }

    /**
     * WIZ-05: Save SMTP settings with encrypted password
     */
    async handleWizardStep4(input: WizardStep4Input): Promise<void> {
        if (!input.host) return; // User skipped or left empty

        await this.settingsRepo.upsert("smtpHost", input.host);
        await this.settingsRepo.upsert("smtpPort", String(input.port));
        await this.settingsRepo.upsert("smtpEncryption", input.encryption);
        await this.settingsRepo.upsert("smtpUsername", input.username || "");
        await this.settingsRepo.upsert("smtpFrom", input.from);

        if (input.password) {
            await this.settingsRepo.upsert(
                "smtpPassword",
                this.cryptoLib.encrypt(input.password),
            );
        }
    }

    /**
     * BF-03: Adopt stack in-place (no filesystem moves — the stack directory
     * stays where it is; only the compose file is read to build the config).
     * Creates Stack record pointing to existing directory.
     */
    async adoptInPlace(
        composePath: string,
        displayName: string,
    ): Promise<{id: string}> {
        const id = slugify(displayName);
        if (!id) {
            // WR-03: an empty slug is a client input problem — 400, not 500.
            throw new BadRequestError("Display name produces an empty slug");
        }

        if (await this.stackRepo.exists(id)) {
            throw new ConflictError(`Stack "${id}" already exists`);
        }

        // WR-05: file I/O belongs in the application layer, not the route
        // handler — read the compose file here instead of in routes/setup.ts.
        const composeContent = await this.fsLib.readFile(composePath, "utf-8");

        // WR-10: also strip bare "compose.yml" (no docker- prefix), matching
        // the full set of file names BrownfieldScanner now recognizes —
        // otherwise hostPath would retain the filename and break subsequent
        // `docker compose` invocations that `cwd` into hostPath.
        const hostPath = composePath.replace(
            /[\/\\](docker-compose\.(yml|yaml)|compose\.(yml|yaml))$/,
            "",
        );
        const composeConfig = createComposeConfig(composeContent);

        const stack = await this.stackRepo.create({
            id,
            displayName,
            description: `Imported from ${hostPath}`,
            hostPath,
            composeConfig,
        });

        return {id: stack.id};
    }

    /**
     * T-05-09: has the wizard been marked fully complete?
     * Read by routes/setup.ts's preHandler to decide whether wizard routes
     * (steps 2-5, adopt, migrate) are still reachable.
     */
    async isWizardComplete(): Promise<boolean> {
        return (await this.settingsRepo.get(SETUP_WIZARD_COMPLETE_KEY)) !== null;
    }

    /**
     * T-05-09: mark the wizard as fully complete. Called once, at the very
     * end of the wizard (Finish, or Skip on the final step) — after this,
     * every /api/setup/* route beyond /status becomes permanently
     * unreachable again.
     */
    async completeWizard(): Promise<void> {
        await this.settingsRepo.upsert(SETUP_WIZARD_COMPLETE_KEY, "true");
    }
}

// Production singleton with real dependencies
const settingsRepository = new SettingsRepository();
const stackRepository = new StackRepository();

export const onboardingService = new OnboardingService(
    auth.api,
    settingsRepository,
    {encrypt},
    stackRepository,
);
