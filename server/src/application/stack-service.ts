import type {CreateStackInput, UpdateStackInput} from "@docktor/shared";
import {slugify} from "../lib/slugify.js";
import {BadRequestError, ConflictError} from "../lib/errors.js";
import {createComposeConfig} from "../domain/compose-config.js";
import {assertTransition, TransitionError,} from "../domain/stack-status-machine.js";
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
            await this.repo.replaceServices(id, composeConfig);
            await this.repo.setConfigChanged(
                id,
                composeConfig.hash !== stack.lastKnownHash,
            );
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

        const composeContent = await this.fs.readCompose(id);
        const composeConfig = createComposeConfig(composeContent);

        await this.repo.recordDeployment({
            stackId: id,
            composeHash: composeConfig.hash,
            success,
            errorMessage,
        });

        if (success) {
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

        await this.repo.transitionStatus(
            id,
            "UPDATING",
            "RUNNING",
            "Image update succeeded",
        );
        await this.repo.clearConfigChanged(id);

        // "up to date" appears in stdout when no new layers were pulled
        // docker compose pull prints "Image is up to date" or "Already exists" for unchanged images
        const noUpdates = pullOutput.toLowerCase().includes("up to date") ||
            pullOutput.trim().length === 0;
        return {noUpdates};
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
}
