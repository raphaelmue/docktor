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

        const hostPath = composePath.replace(
            /[\/\\]docker-compose\.(yml|yaml)$|[\/\\]compose\.yaml$/,
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
