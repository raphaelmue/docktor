import type {CreateStackInput, UpdateStackInput} from "@docktor/shared";
import {slugify} from "../lib/slugify.js";
import {BadRequestError, ConflictError, NotFoundError} from "../lib/errors.js";
import {createComposeConfig} from "../domain/compose-config.js";
import {assertTransition, TransitionError,} from "../domain/stack-status-machine.js";
import {ComposeEditError, getServiceImageTag, setServiceImageTag} from "../lib/compose-editor.js";
import type {StackRepository} from "../repositories/stack-repository.js";
import type {StackFilesystem} from "../infrastructure/stack-filesystem.js";
import type {DockerExecutor} from "../infrastructure/docker-executor.js";
import type {StackStatus} from "../generated/prisma/enums.js";

export class StackService {
    constructor(
        private readonly repo: StackRepository,
        private readonly fs: StackFilesystem,
        private readonly docker: DockerExecutor,
    ) {}

    async createStack(input: CreateStackInput) {
        const id = slugify(input.displayName);
        if (!id) {
            throw new BadRequestError("Display name produces an empty slug");
        }

        if (await this.repo.exists(id)) {
            throw new ConflictError(`Stack "${id}" already exists`);
        }

        const hostPath = await this.fs.createDirectory(id);
        await this.fs.writeCompose(id, input.composeContent);
        if (input.envContent) {
            await this.fs.writeEnv(id, input.envContent);
        }

        const composeConfig = createComposeConfig(input.composeContent);

        return this.repo.create({
            id,
            displayName: input.displayName,
            description: input.description,
            hostPath,
            composeConfig,
        });
    }

    async listStacks() {
        return this.repo.findAll();
    }

    async getStack(id: string) {
        return this.repo.findByIdWithRelations(id);
    }

    async updateStack(id: string, input: UpdateStackInput) {
        const stack = await this.repo.findByIdOrThrow(id);

        if (input.composeContent !== undefined) {
            await this.fs.writeCompose(id, input.composeContent);
            const composeConfig = createComposeConfig(input.composeContent);
            // Don't update service records yet - wait until deployment
            // This keeps service records in sync with what's actually running
            await this.repo.setConfigChanged(
                id,
                composeConfig.hash !== stack.lastKnownHash,
            );
            // Update the hash so we can track changes
            if (composeConfig.hash !== stack.lastKnownHash) {
                await this.repo.updateStackHash({
                    stackId: id,
                    hash: composeConfig.hash,
                });
            }
        }

        if (input.envContent !== undefined) {
            if (input.envContent) {
                await this.fs.writeEnv(id, input.envContent);
            } else {
                await this.fs.removeEnv(id);
            }
        }

        if (input.displayName !== undefined || input.description !== undefined) {
            await this.repo.updateMetadata(id, {
                displayName: input.displayName,
                description: input.description,
            });
        }

        return this.repo.findByIdWithRelations(id);
    }

    async deleteStack(id: string) {
        const stack = await this.repo.findByIdOrThrow(id);
        this.guardTransition(stack.status as StackStatus, "DELETE");

        try {
            await this.docker.down(id);
        } catch (err: any) {
            // Continue with deletion even if docker down fails
            // (e.g., containers already removed manually)
        }

        await this.fs.removeDirectory(id);
        await this.repo.delete(id);
    }

    async deployStack(id: string) {
        const stack = await this.repo.findByIdOrThrow(id);
        this.guardTransition(stack.status as StackStatus, "DEPLOY");

        await this.repo.transitionStatus(
            id,
            stack.status as StackStatus,
            "DEPLOYING",
            "Deployment started",
        );

        let success = true;
        let errorMessage: string | undefined;

        try {
            await this.docker.up(id);
        } catch (err: any) {
            success = false;
            errorMessage = err.stderr || err.message;
        }

        // Everything below must stay inside this try/catch: no action's allowed-from
        // list includes DEPLOYING (stack-status-machine.ts) and StatePoller
        // unconditionally skips transitional statuses, so any unhandled failure here
        // (compose re-read/parse, a DB write) would leave the stack permanently stuck
        // in DEPLOYING with no way to recover it short of a manual DB edit.
        try {
            const composeContent = await this.fs.readCompose(id);
            const composeConfig = createComposeConfig(composeContent);

            await this.repo.recordDeployment({
                stackId: id,
                composeHash: composeConfig.hash,
                success,
                errorMessage,
            });

            if (success) {
                // Update service records to match the deployed compose file
                await this.repo.replaceServices(id, composeConfig);
                await this.repo.transitionStatus(
                    id,
                    "DEPLOYING",
                    "RUNNING",
                    "Deployment succeeded",
                );
                await this.repo.clearConfigChanged(id);
            } else {
                await this.repo.transitionStatus(
                    id,
                    "DEPLOYING",
                    "ERROR",
                    `Deployment failed: ${errorMessage}`,
                );
            }
        } catch (err: any) {
            success = false;
            errorMessage = err.message ?? String(err);
            await this.repo.transitionStatus(
                id,
                "DEPLOYING",
                "ERROR",
                `Deployment failed: ${errorMessage}`,
            );
        }

        return {success, errorMessage};
    }

    async stopStack(id: string) {
        const stack = await this.repo.findByIdOrThrow(id);
        this.guardTransition(stack.status as StackStatus, "STOP");

        await this.repo.transitionStatus(
            id,
            stack.status as StackStatus,
            "STOPPED",
            "Stack stopped",
        );

        try {
            await this.docker.stop(id);
        } catch (err: any) {
            await this.repo.transitionStatus(
                id,
                "STOPPED",
                "ERROR",
                `Stop failed: ${err.stderr || err.message}`,
            );
            throw err;
        }
    }

    async restartStack(id: string) {
        const stack = await this.repo.findByIdOrThrow(id);
        this.guardTransition(stack.status as StackStatus, "RESTART");

        await this.docker.restart(id);

        await this.repo.transitionStatus(
            id,
            stack.status as StackStatus,
            stack.status as StackStatus,
            "Stack restarted",
        );
        await this.repo.clearConfigChanged(id);
    }

    async updateImages(id: string): Promise<{noUpdates: boolean}> {
        const stack = await this.repo.findByIdOrThrow(id);
        this.guardTransition(stack.status as StackStatus, "UPDATE");

        await this.repo.transitionStatus(
            id,
            stack.status as StackStatus,
            "UPDATING",
            "Image update started",
        );

        let pullOutput = "";
        try {
            pullOutput = await this.docker.composePull(id);
            await this.docker.up(id);
        } catch (err: any) {
            await this.repo.transitionStatus(
                id,
                "UPDATING",
                "ERROR",
                err.stderr ?? err.message,
            );
            throw err;
        }

        // Everything below must stay inside this try/catch: no action's allowed-from
        // list includes UPDATING (stack-status-machine.ts) and StatePoller
        // unconditionally skips transitional statuses, so any unhandled failure here
        // (compose re-read/parse, a DB write) would leave the stack permanently stuck
        // in UPDATING with no way to recover it short of a manual DB edit.
        try {
            // After successful update, sync service records with the compose file
            const composeContent = await this.fs.readCompose(id);
            const composeConfig = createComposeConfig(composeContent);
            await this.repo.replaceServices(id, composeConfig);

            await this.repo.transitionStatus(
                id,
                "UPDATING",
                "RUNNING",
                "Image update succeeded",
            );
            await this.repo.clearConfigChanged(id);
        } catch (err: any) {
            await this.repo.transitionStatus(
                id,
                "UPDATING",
                "ERROR",
                err.message ?? String(err),
            );
            throw err;
        }

        // Detect if images were actually updated by checking pull output
        // Docker compose pull outputs:
        // - When pulling new image: "Pulling...", "Pull complete", "Downloaded newer image"
        // - When already up-to-date: "Image is up to date", "Already exists" for all layers
        // - Empty output usually means no images defined or all are up-to-date
        const output = pullOutput.toLowerCase();
        const hasDownloadActivity =
            output.includes("downloading") ||
            output.includes("extracting") ||
            output.includes("pull complete") ||
            output.includes("downloaded newer image");
        const noUpdates = !hasDownloadActivity && (
            output.includes("up to date") ||
            output.includes("already exists") ||
            output.trim().length === 0
        );
        return {noUpdates};
    }

    /**
     * Rewrites a single service's image tag in the compose file, deploys
     * it, and persists the resulting Service rows — a real version upgrade
     * rather than a pull-and-deploy whose effect disappears on restart
     * (UPD-04). Never invoked from a background path; the only caller is
     * the authenticated POST /api/stacks/:id/services/:serviceName/upgrade
     * route.
     */
    async upgradeServiceImage(
        id: string,
        serviceName: string,
        targetTag: string,
    ): Promise<{changed: boolean; previousTag: string | null; newTag: string}> {
        const stack = await this.repo.findByIdOrThrow(id);
        const originalContent = await this.fs.readCompose(id);

        let previousTag: string | null;
        try {
            previousTag = getServiceImageTag(originalContent, serviceName);
        } catch (err) {
            throw this.translateComposeEditError(err);
        }

        // guardTransition is a pure check (no side effects), so it always
        // runs before the idempotency short-circuit below — this is what
        // makes a second concurrent upgrade request fail with the same
        // status-guard rejection as updateImages(), even when its target
        // tag happens to match what a still-in-flight request already
        // wrote to disk.
        this.guardTransition(stack.status as StackStatus, "UPDATE");

        if ((previousTag ?? "latest") === targetTag) {
            // Idempotency guarantee: no write, no status transition.
            return {changed: false, previousTag, newTag: targetTag};
        }

        await this.repo.transitionStatus(
            id,
            stack.status as StackStatus,
            "UPDATING",
            `Upgrading ${serviceName} to ${targetTag}`,
        );

        let newContent: string;
        try {
            newContent = setServiceImageTag(originalContent, serviceName, targetTag);
        } catch (err) {
            await this.repo.transitionStatus(id, "UPDATING", "ERROR", (err as Error).message);
            throw this.translateComposeEditError(err);
        }

        await this.fs.writeCompose(id, newContent);

        try {
            await this.docker.composePull(id);
            await this.docker.up(id);
        } catch (err: any) {
            await this.repo.transitionStatus(
                id,
                "UPDATING",
                "ERROR",
                err.stderr ?? err.message,
            );
            throw err;
        }

        // Everything below must stay inside this try/catch: no action's
        // allowed-from list includes UPDATING and StatePoller unconditionally
        // skips transitional statuses, so any unhandled failure here would
        // leave the stack permanently stuck in UPDATING (see updateImages()).
        try {
            const composeConfig = createComposeConfig(newContent);
            await this.repo.replaceServices(id, composeConfig);
            await this.repo.transitionStatus(
                id,
                "UPDATING",
                "RUNNING",
                `Upgraded ${serviceName} to ${targetTag}`,
            );
            await this.repo.clearConfigChanged(id);
        } catch (err: any) {
            await this.repo.transitionStatus(
                id,
                "UPDATING",
                "ERROR",
                err.message ?? String(err),
            );
            throw err;
        }

        return {changed: true, previousTag, newTag: targetTag};
    }

    async getContainerStatuses(id: string) {
        await this.repo.findByIdOrThrow(id);
        return this.docker.ps(id);
    }

    async getComposeContent(id: string): Promise<string> {
        await this.repo.findByIdOrThrow(id);
        return this.fs.readCompose(id);
    }

    async getEnvContent(id: string): Promise<string> {
        await this.repo.findByIdOrThrow(id);
        return this.fs.readEnv(id);
    }

    private guardTransition(current: StackStatus, action: "DEPLOY" | "STOP" | "RESTART" | "DELETE" | "UPDATE") {
        try {
            assertTransition(current, action);
        } catch (err) {
            if (err instanceof TransitionError) {
                throw new BadRequestError(err.message);
            }
            throw err;
        }
    }

    // A service that doesn't belong to the addressed stack's compose file
    // is a 404 (not found); every other compose-edit failure (no image key,
    // a digest pin) is a 400 (the request can't be satisfied as written).
    private translateComposeEditError(err: unknown): Error {
        if (err instanceof ComposeEditError) {
            if (err.reason === "service-not-found") {
                return new NotFoundError(err.message);
            }
            return new BadRequestError(err.message);
        }
        return err instanceof Error ? err : new Error(String(err));
    }
}
