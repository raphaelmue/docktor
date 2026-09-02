import {beforeEach, describe, expect, it, vi} from "vitest";
import {StackService} from "../../../src/application/stack-service.js";
import {BadRequestError, ConflictError, NotFoundError} from "../../../src/lib/errors.js";

function createMockRepo() {
    return {
        findByIdOrThrow: vi.fn(),
        findByIdWithRelations: vi.fn(),
        findAll: vi.fn(),
        exists: vi.fn(),
        create: vi.fn(),
        replaceServices: vi.fn(),
        setConfigChanged: vi.fn(),
        updateMetadata: vi.fn(),
        transitionStatus: vi.fn(),
        recordDeployment: vi.fn(),
        clearConfigChanged: vi.fn(),
        updateStackHash: vi.fn(),
        delete: vi.fn(),
    };
}

function createMockFs() {
    return {
        createDirectory: vi.fn().mockResolvedValue("/stacks/test-stack"),
        writeCompose: vi.fn(),
        readCompose: vi.fn(),
        writeEnv: vi.fn(),
        readEnv: vi.fn(),
        removeEnv: vi.fn(),
        removeDirectory: vi.fn(),
    };
}

function createMockDocker() {
    return {
        up: vi.fn(),
        stop: vi.fn(),
        restart: vi.fn(),
        down: vi.fn(),
        ps: vi.fn(),
        composePull: vi.fn(),
        imageDigest: vi.fn(),
    };
}

function createMockStackEvents() {
    return {
        findRecentByStack: vi.fn(),
    };
}

function createMockBroadcaster() {
    return {
        publish: vi.fn(),
    };
}

describe("StackService", () => {
    let service: StackService;
    let repo: ReturnType<typeof createMockRepo>;
    let fs: ReturnType<typeof createMockFs>;
    let docker: ReturnType<typeof createMockDocker>;
    let events: ReturnType<typeof createMockStackEvents>;
    let broadcaster: ReturnType<typeof createMockBroadcaster>;

    beforeEach(() => {
        repo = createMockRepo();
        fs = createMockFs();
        docker = createMockDocker();
        events = createMockStackEvents();
        broadcaster = createMockBroadcaster();
        service = new StackService(repo as any, fs as any, docker as any, events as any, broadcaster as any);
    });

    describe("createStack", () => {
        it("creates a stack successfully", async () => {
            repo.exists.mockResolvedValue(false);
            repo.create.mockResolvedValue({id: "my-app", displayName: "My App"});

            const result = await service.createStack({
                displayName: "My App",
                composeContent: "services:\n  web:\n    image: nginx\n",
            });

            expect(repo.exists).toHaveBeenCalledWith("my-app");
            expect(fs.createDirectory).toHaveBeenCalledWith("my-app");
            expect(fs.writeCompose).toHaveBeenCalledWith(
                "my-app",
                "services:\n  web:\n    image: nginx\n",
            );
            expect(repo.create).toHaveBeenCalled();
            expect(result).toEqual({id: "my-app", displayName: "My App"});
        });

        it("throws ConflictError when stack already exists", async () => {
            repo.exists.mockResolvedValue(true);

            await expect(
                service.createStack({
                    displayName: "My App",
                    composeContent: "services:\n  web:\n    image: nginx\n",
                }),
            ).rejects.toThrow(ConflictError);
        });

        it("throws BadRequestError when display name produces empty slug", async () => {
            await expect(
                service.createStack({
                    displayName: "!!!",
                    composeContent: "services:\n  web:\n    image: nginx\n",
                }),
            ).rejects.toThrow(BadRequestError);
        });

        it("writes env file when envContent is provided", async () => {
            repo.exists.mockResolvedValue(false);
            repo.create.mockResolvedValue({id: "my-app"});

            await service.createStack({
                displayName: "My App",
                composeContent: "services:\n  web:\n    image: nginx\n",
                envContent: "FOO=bar",
            });

            expect(fs.writeEnv).toHaveBeenCalledWith("my-app", "FOO=bar");
        });
    });

    describe("getStackEvents", () => {
        it("resolves the rows the event repository returns for that stack", async () => {
            repo.findByIdOrThrow.mockResolvedValue({id: "my-app", status: "RUNNING"});
            const rows = [
                {id: "evt-1", type: "config_changed", message: null, payload: "{}", createdAt: new Date()},
            ];
            events.findRecentByStack.mockResolvedValue(rows);

            const result = await service.getStackEvents("my-app");

            expect(result).toEqual(rows);
        });

        it("asks the event repository for that stack id and no other", async () => {
            repo.findByIdOrThrow.mockResolvedValue({id: "my-app", status: "RUNNING"});
            events.findRecentByStack.mockResolvedValue([]);

            await service.getStackEvents("my-app");

            expect(events.findRecentByStack).toHaveBeenCalledWith("my-app", undefined);
        });

        it("rejects with NotFoundError when the stack does not exist, and does not touch the event repository", async () => {
            repo.findByIdOrThrow.mockRejectedValue(new NotFoundError('Stack "my-app" not found'));

            await expect(service.getStackEvents("my-app")).rejects.toThrow(NotFoundError);

            expect(events.findRecentByStack).not.toHaveBeenCalled();
        });

        it("passes an explicit limit through to the repository", async () => {
            repo.findByIdOrThrow.mockResolvedValue({id: "my-app", status: "RUNNING"});
            events.findRecentByStack.mockResolvedValue([]);

            await service.getStackEvents("my-app", 5);

            expect(events.findRecentByStack).toHaveBeenCalledWith("my-app", 5);
        });

        it("passes the repository's own default through rather than inventing a different one when no limit is given", async () => {
            repo.findByIdOrThrow.mockResolvedValue({id: "my-app", status: "RUNNING"});
            events.findRecentByStack.mockResolvedValue([]);

            await service.getStackEvents("my-app");

            expect(events.findRecentByStack).toHaveBeenCalledWith("my-app", undefined);
        });
    });

    describe("deleteStack", () => {
        it("deletes a stack in STOPPED status", async () => {
            repo.findByIdOrThrow.mockResolvedValue({
                id: "my-app",
                status: "STOPPED",
            });

            await service.deleteStack("my-app");

            expect(docker.down).toHaveBeenCalledWith("my-app");
            expect(fs.removeDirectory).toHaveBeenCalledWith("my-app");
            expect(repo.delete).toHaveBeenCalledWith("my-app");
        });

        it("continues deletion even if docker down fails", async () => {
            repo.findByIdOrThrow.mockResolvedValue({
                id: "my-app",
                status: "STOPPED",
            });
            docker.down.mockRejectedValue(new Error("Docker error"));

            await service.deleteStack("my-app");

            expect(docker.down).toHaveBeenCalledWith("my-app");
            expect(fs.removeDirectory).toHaveBeenCalledWith("my-app");
            expect(repo.delete).toHaveBeenCalledWith("my-app");
        });

        it("throws BadRequestError for invalid status transition", async () => {
            repo.findByIdOrThrow.mockResolvedValue({
                id: "my-app",
                status: "RUNNING",
            });

            await expect(service.deleteStack("my-app")).rejects.toThrow(
                BadRequestError,
            );
        });
    });

    describe("deployStack", () => {
        it("deploys successfully", async () => {
            repo.findByIdOrThrow.mockResolvedValue({
                id: "my-app",
                status: "DRAFT",
            });
            docker.up.mockResolvedValue(undefined);
            fs.readCompose.mockResolvedValue("services:\n  web:\n    image: nginx\n");

            const result = await service.deployStack("my-app");

            expect(result.success).toBe(true);
            expect(repo.transitionStatus).toHaveBeenCalledWith(
                "my-app",
                "DRAFT",
                "DEPLOYING",
                "Deployment started",
            );
            expect(docker.up).toHaveBeenCalledWith("my-app");
            expect(repo.recordDeployment).toHaveBeenCalledWith(
                expect.objectContaining({
                    stackId: "my-app",
                    success: true,
                }),
            );
            expect(repo.clearConfigChanged).toHaveBeenCalledWith("my-app");
        });

        it("records error deployment when docker fails", async () => {
            repo.findByIdOrThrow.mockResolvedValue({
                id: "my-app",
                status: "DRAFT",
            });
            docker.up.mockRejectedValue(new Error("Container failed"));
            fs.readCompose.mockResolvedValue("services:\n  web:\n    image: nginx\n");

            const result = await service.deployStack("my-app");

            expect(result.success).toBe(false);
            expect(result.errorMessage).toBe("Container failed");
            expect(repo.recordDeployment).toHaveBeenCalledWith(
                expect.objectContaining({
                    stackId: "my-app",
                    success: false,
                    errorMessage: "Container failed",
                }),
            );
            expect(repo.transitionStatus).toHaveBeenLastCalledWith(
                "my-app",
                "DEPLOYING",
                "ERROR",
                expect.stringContaining("Container failed"),
            );
        });

        it("transitions to ERROR instead of leaving the stack stuck in DEPLOYING when the post-deploy sync fails", async () => {
            repo.findByIdOrThrow.mockResolvedValue({
                id: "my-app",
                status: "DRAFT",
            });
            docker.up.mockResolvedValue(undefined);
            fs.readCompose.mockResolvedValue("services:\n  web:\n    image: nginx\n");
            repo.recordDeployment.mockRejectedValue(new Error("DB unavailable"));

            const result = await service.deployStack("my-app");

            expect(result.success).toBe(false);
            expect(result.errorMessage).toBe("DB unavailable");
            expect(repo.transitionStatus).toHaveBeenLastCalledWith(
                "my-app",
                "DEPLOYING",
                "ERROR",
                expect.stringContaining("DB unavailable"),
            );
        });

        it("publishes stack_status DEPLOYING then RUNNING on a successful deploy", async () => {
            repo.findByIdOrThrow.mockResolvedValue({id: "my-app", status: "DRAFT"});
            docker.up.mockResolvedValue(undefined);
            fs.readCompose.mockResolvedValue("services:\n  web:\n    image: nginx\n");

            await service.deployStack("my-app");

            expect(broadcaster.publish).toHaveBeenCalledWith({
                type: "stack_status",
                stackId: "my-app",
                stackStatus: "DEPLOYING",
            });
            expect(broadcaster.publish).toHaveBeenLastCalledWith({
                type: "stack_status",
                stackId: "my-app",
                stackStatus: "RUNNING",
            });
        });

        it("publishes stack_status DEPLOYING then ERROR when the docker call fails", async () => {
            repo.findByIdOrThrow.mockResolvedValue({id: "my-app", status: "DRAFT"});
            docker.up.mockRejectedValue(new Error("Container failed"));
            fs.readCompose.mockResolvedValue("services:\n  web:\n    image: nginx\n");

            await service.deployStack("my-app");

            expect(broadcaster.publish).toHaveBeenCalledWith({
                type: "stack_status",
                stackId: "my-app",
                stackStatus: "DEPLOYING",
            });
            expect(broadcaster.publish).toHaveBeenLastCalledWith({
                type: "stack_status",
                stackId: "my-app",
                stackStatus: "ERROR",
            });
        });

        it("does not let a throwing broadcaster subscriber strand a successful deploy", async () => {
            repo.findByIdOrThrow.mockResolvedValue({id: "my-app", status: "DRAFT"});
            docker.up.mockResolvedValue(undefined);
            fs.readCompose.mockResolvedValue("services:\n  web:\n    image: nginx\n");
            broadcaster.publish.mockImplementation(() => {
                throw new Error("subscriber exploded");
            });
            const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

            const result = await service.deployStack("my-app");

            expect(result.success).toBe(true);
            expect(repo.transitionStatus).toHaveBeenLastCalledWith(
                "my-app",
                "DEPLOYING",
                "RUNNING",
                "Deployment succeeded",
            );
            consoleErrorSpy.mockRestore();
        });
    });

    describe("stopStack", () => {
        it("publishes stack_status STOPPED on a successful stop", async () => {
            repo.findByIdOrThrow.mockResolvedValue({id: "my-app", status: "RUNNING"});
            docker.stop.mockResolvedValue(undefined);

            await service.stopStack("my-app");

            expect(repo.transitionStatus).toHaveBeenCalledWith(
                "my-app",
                "RUNNING",
                "STOPPED",
                "Stack stopped",
            );
            expect(broadcaster.publish).toHaveBeenCalledWith({
                type: "stack_status",
                stackId: "my-app",
                stackStatus: "STOPPED",
            });
        });

        it("publishes stack_status STOPPED then ERROR when the docker stop call fails", async () => {
            repo.findByIdOrThrow.mockResolvedValue({id: "my-app", status: "RUNNING"});
            docker.stop.mockRejectedValue(new Error("stop failed"));

            await expect(service.stopStack("my-app")).rejects.toThrow("stop failed");

            expect(broadcaster.publish).toHaveBeenCalledWith({
                type: "stack_status",
                stackId: "my-app",
                stackStatus: "STOPPED",
            });
            expect(broadcaster.publish).toHaveBeenLastCalledWith({
                type: "stack_status",
                stackId: "my-app",
                stackStatus: "ERROR",
            });
        });
    });

    describe("restartStack", () => {
        it("publishes stack_status even when from-status equals to-status", async () => {
            repo.findByIdOrThrow.mockResolvedValue({id: "my-app", status: "RUNNING"});
            docker.restart.mockResolvedValue(undefined);

            await service.restartStack("my-app");

            expect(repo.transitionStatus).toHaveBeenCalledWith(
                "my-app",
                "RUNNING",
                "RUNNING",
                "Stack restarted",
            );
            expect(broadcaster.publish).toHaveBeenCalledWith({
                type: "stack_status",
                stackId: "my-app",
                stackStatus: "RUNNING",
            });
            expect(repo.clearConfigChanged).toHaveBeenCalledWith("my-app");
        });
    });

    describe("updateImages", () => {
        function mockDockerAndFsForSuccess() {
            docker.composePull.mockResolvedValue("Pull complete");
            docker.up.mockResolvedValue(undefined);
            fs.readCompose.mockResolvedValue("services:\n  web:\n    image: nginx\n");
        }

        beforeEach(() => {
            repo.findByIdOrThrow.mockResolvedValue({id: "my-app", status: "RUNNING"});
        });

        it("updates successfully and transitions back to RUNNING", async () => {
            mockDockerAndFsForSuccess();

            const result = await service.updateImages("my-app");

            expect(result.noUpdates).toBe(false);
            expect(repo.transitionStatus).toHaveBeenLastCalledWith(
                "my-app",
                "UPDATING",
                "RUNNING",
                "Image update succeeded",
            );
        });

        it("transitions to ERROR instead of leaving the stack stuck in UPDATING when the post-pull sync fails", async () => {
            mockDockerAndFsForSuccess();
            repo.replaceServices.mockRejectedValue(new Error("DB unavailable"));

            await expect(service.updateImages("my-app")).rejects.toThrow("DB unavailable");

            expect(repo.transitionStatus).toHaveBeenLastCalledWith(
                "my-app",
                "UPDATING",
                "ERROR",
                "DB unavailable",
            );
        });

        it("reports noUpdates: true when every service's local image digest is unchanged before and after the pull", async () => {
            mockDockerAndFsForSuccess();
            docker.imageDigest.mockResolvedValue("sha256:aaa");

            const result = await service.updateImages("my-app");

            expect(result.noUpdates).toBe(true);
            expect(docker.imageDigest).toHaveBeenCalledWith("nginx:latest");
        });

        it("reports noUpdates: false when a service's local image digest changed across the pull", async () => {
            mockDockerAndFsForSuccess();
            docker.imageDigest
                .mockResolvedValueOnce("sha256:aaa") // before composePull
                .mockResolvedValueOnce("sha256:bbb"); // after composePull + up

            const result = await service.updateImages("my-app");

            expect(result.noUpdates).toBe(false);
        });

        it("does not reject out of digest collection, and still ends in ERROR (not stuck in UPDATING) when the compose file cannot be read", async () => {
            docker.composePull.mockResolvedValue("Pulled");
            docker.up.mockResolvedValue(undefined);
            fs.readCompose.mockRejectedValue(new Error("ENOENT: no such file"));

            await expect(service.updateImages("my-app")).rejects.toThrow("ENOENT");

            // Reaching the UPDATING transition proves collectImageRefs()
            // swallowed the compose-read failure instead of rejecting
            // before the transition happened.
            expect(repo.transitionStatus).toHaveBeenCalledWith(
                "my-app",
                "RUNNING",
                "UPDATING",
                "Image update started",
            );
            // The final status is ERROR (a non-transitional status), not
            // left stuck in UPDATING — via the existing post-pull guard,
            // not a new unhandled throw.
            expect(repo.transitionStatus).toHaveBeenLastCalledWith(
                "my-app",
                "UPDATING",
                "ERROR",
                "ENOENT: no such file",
            );
        });

        it("resolves noUpdates: false and never calls imageDigest for a build-only service with no image", async () => {
            docker.composePull.mockResolvedValue("Pulled");
            docker.up.mockResolvedValue(undefined);
            fs.readCompose.mockResolvedValue("services:\n  web:\n    build: .\n");

            const result = await service.updateImages("my-app");

            expect(result.noUpdates).toBe(false);
            expect(docker.imageDigest).not.toHaveBeenCalled();
            expect(docker.composePull).toHaveBeenCalledWith("my-app");
            expect(repo.replaceServices).toHaveBeenCalled();
        });

        it("resolves noUpdates: false when imageDigest resolves null on both calls for every service", async () => {
            mockDockerAndFsForSuccess();
            docker.imageDigest.mockResolvedValue(null);

            const result = await service.updateImages("my-app");

            expect(result.noUpdates).toBe(false);
        });

        it("transitions UPDATING to ERROR and propagates the error when composePull rejects, unchanged from before", async () => {
            fs.readCompose.mockResolvedValue("services:\n  web:\n    image: nginx\n");
            docker.composePull.mockRejectedValue(new Error("pull failed"));

            await expect(service.updateImages("my-app")).rejects.toThrow("pull failed");

            expect(repo.transitionStatus).toHaveBeenLastCalledWith(
                "my-app",
                "UPDATING",
                "ERROR",
                "pull failed",
            );
        });

        it("publishes stack_status UPDATING then RUNNING on a successful update", async () => {
            mockDockerAndFsForSuccess();

            await service.updateImages("my-app");

            expect(broadcaster.publish).toHaveBeenCalledWith({
                type: "stack_status",
                stackId: "my-app",
                stackStatus: "UPDATING",
            });
            expect(broadcaster.publish).toHaveBeenLastCalledWith({
                type: "stack_status",
                stackId: "my-app",
                stackStatus: "RUNNING",
            });
        });

        it("publishes stack_status UPDATING then ERROR when the post-pull sync fails", async () => {
            mockDockerAndFsForSuccess();
            repo.replaceServices.mockRejectedValue(new Error("DB unavailable"));

            await expect(service.updateImages("my-app")).rejects.toThrow("DB unavailable");

            expect(broadcaster.publish).toHaveBeenCalledWith({
                type: "stack_status",
                stackId: "my-app",
                stackStatus: "UPDATING",
            });
            expect(broadcaster.publish).toHaveBeenLastCalledWith({
                type: "stack_status",
                stackId: "my-app",
                stackStatus: "ERROR",
            });
        });
    });

    describe("upgradeServiceImage", () => {
        const ORIGINAL_COMPOSE = "services:\n  web:\n    image: nginx:1.25\n";

        beforeEach(() => {
            repo.findByIdOrThrow.mockResolvedValue({id: "my-app", status: "RUNNING"});
            fs.readCompose.mockResolvedValue(ORIGINAL_COMPOSE);
            docker.composePull.mockResolvedValue("Pull complete");
            docker.up.mockResolvedValue(undefined);
        });

        it("rewrites the compose file, deploys, and returns the new tag", async () => {
            const result = await service.upgradeServiceImage("my-app", "web", "1.26");

            expect(result).toEqual({changed: true, previousTag: "1.25", newTag: "1.26"});
            expect(fs.writeCompose).toHaveBeenCalledWith(
                "my-app",
                "services:\n  web:\n    image: nginx:1.26\n",
            );
            expect(repo.transitionStatus).toHaveBeenNthCalledWith(
                1,
                "my-app",
                "RUNNING",
                "UPDATING",
                "Upgrading web to 1.26",
            );
            expect(repo.transitionStatus).toHaveBeenLastCalledWith(
                "my-app",
                "UPDATING",
                "RUNNING",
                "Upgraded web to 1.26",
            );
            expect(repo.replaceServices).toHaveBeenCalled();
            expect(repo.clearConfigChanged).toHaveBeenCalledWith("my-app");
        });

        it("is a no-op when the target tag equals the tag already in the compose file", async () => {
            const result = await service.upgradeServiceImage("my-app", "web", "1.25");

            expect(result).toEqual({changed: false, previousTag: "1.25", newTag: "1.25"});
            expect(fs.writeCompose).not.toHaveBeenCalled();
            expect(repo.transitionStatus).not.toHaveBeenCalled();
            expect(docker.composePull).not.toHaveBeenCalled();
        });

        it("throws NotFoundError for a service absent from the compose file, without writing", async () => {
            await expect(
                service.upgradeServiceImage("my-app", "missing", "1.26"),
            ).rejects.toThrow(NotFoundError);

            expect(fs.writeCompose).not.toHaveBeenCalled();
            expect(repo.transitionStatus).not.toHaveBeenCalled();
        });

        it("throws BadRequestError for a digest-pinned image, without writing", async () => {
            fs.readCompose.mockResolvedValue(
                "services:\n  web:\n    image: nginx@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\n",
            );

            await expect(
                service.upgradeServiceImage("my-app", "web", "1.26"),
            ).rejects.toThrow(BadRequestError);

            expect(fs.writeCompose).not.toHaveBeenCalled();
            expect(repo.transitionStatus).not.toHaveBeenCalled();
        });

        it("rejects a second upgrade while the stack is already UPDATING, leaving the in-flight upgrade unaffected", async () => {
            repo.findByIdOrThrow.mockResolvedValue({id: "my-app", status: "UPDATING"});

            await expect(
                service.upgradeServiceImage("my-app", "web", "1.26"),
            ).rejects.toThrow(BadRequestError);

            expect(fs.writeCompose).not.toHaveBeenCalled();
        });

        it("restores the original compose content and transitions to ERROR when composePull fails", async () => {
            docker.composePull.mockRejectedValue(new Error("pull failed"));

            await expect(
                service.upgradeServiceImage("my-app", "web", "1.26"),
            ).rejects.toThrow("pull failed");

            expect(fs.writeCompose).toHaveBeenNthCalledWith(
                1,
                "my-app",
                "services:\n  web:\n    image: nginx:1.26\n",
            );
            expect(fs.writeCompose).toHaveBeenLastCalledWith("my-app", ORIGINAL_COMPOSE);
            expect(repo.transitionStatus).toHaveBeenLastCalledWith(
                "my-app",
                "UPDATING",
                "ERROR",
                "pull failed",
            );
            expect(docker.up).not.toHaveBeenCalled();
        });

        it("restores the original compose content and transitions to ERROR when up fails after a successful pull", async () => {
            docker.up.mockRejectedValue(new Error("recreate failed"));

            await expect(
                service.upgradeServiceImage("my-app", "web", "1.26"),
            ).rejects.toThrow("recreate failed");

            expect(fs.writeCompose).toHaveBeenLastCalledWith("my-app", ORIGINAL_COMPOSE);
            expect(repo.transitionStatus).toHaveBeenLastCalledWith(
                "my-app",
                "UPDATING",
                "ERROR",
                "recreate failed",
            );
        });

        it("surfaces the deploy error, not the restore error, when the restore write itself fails", async () => {
            const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
            docker.composePull.mockRejectedValue(new Error("pull failed"));
            fs.writeCompose
                .mockResolvedValueOnce(undefined) // the initial rewrite
                .mockRejectedValueOnce(new Error("disk full")); // the restore attempt

            await expect(
                service.upgradeServiceImage("my-app", "web", "1.26"),
            ).rejects.toThrow("pull failed");

            expect(repo.transitionStatus).toHaveBeenLastCalledWith(
                "my-app",
                "UPDATING",
                "ERROR",
                "pull failed",
            );
            expect(consoleErrorSpy).toHaveBeenCalled();
            consoleErrorSpy.mockRestore();
        });

        it("does not restore or touch the compose file again when the deploy succeeds", async () => {
            await service.upgradeServiceImage("my-app", "web", "1.26");

            expect(fs.writeCompose).toHaveBeenCalledTimes(1);
            expect(fs.writeCompose).toHaveBeenCalledWith(
                "my-app",
                "services:\n  web:\n    image: nginx:1.26\n",
            );
        });

        it("publishes stack_status UPDATING then RUNNING on a successful upgrade", async () => {
            await service.upgradeServiceImage("my-app", "web", "1.26");

            expect(broadcaster.publish).toHaveBeenCalledWith({
                type: "stack_status",
                stackId: "my-app",
                stackStatus: "UPDATING",
            });
            expect(broadcaster.publish).toHaveBeenLastCalledWith({
                type: "stack_status",
                stackId: "my-app",
                stackStatus: "RUNNING",
            });
        });

        it("publishes no event on the idempotent no-op path", async () => {
            await service.upgradeServiceImage("my-app", "web", "1.25");

            expect(broadcaster.publish).not.toHaveBeenCalled();
        });

        it("publishes stack_status UPDATING then ERROR when composePull fails", async () => {
            docker.composePull.mockRejectedValue(new Error("pull failed"));

            await expect(
                service.upgradeServiceImage("my-app", "web", "1.26"),
            ).rejects.toThrow("pull failed");

            expect(broadcaster.publish).toHaveBeenCalledWith({
                type: "stack_status",
                stackId: "my-app",
                stackStatus: "UPDATING",
            });
            expect(broadcaster.publish).toHaveBeenLastCalledWith({
                type: "stack_status",
                stackId: "my-app",
                stackStatus: "ERROR",
            });
        });
    });

    describe("updateStack", () => {
        beforeEach(() => {
            repo.findByIdOrThrow.mockResolvedValue({id: "my-app", lastKnownHash: "hash-1"});
            repo.findByIdWithRelations.mockResolvedValue({id: "my-app"});
        });

        it("flags configChanged and publishes config_changed when envContent is written", async () => {
            await service.updateStack("my-app", {envContent: "FOO=bar"});

            expect(fs.writeEnv).toHaveBeenCalledWith("my-app", "FOO=bar");
            expect(repo.setConfigChanged).toHaveBeenCalledWith("my-app", true);
            expect(broadcaster.publish).toHaveBeenCalledWith(
                expect.objectContaining({type: "config_changed", stackId: "my-app"}),
            );
        });

        it("removes the env file and still flags configChanged and publishes when envContent is empty", async () => {
            await service.updateStack("my-app", {envContent: ""});

            expect(fs.removeEnv).toHaveBeenCalledWith("my-app");
            expect(repo.setConfigChanged).toHaveBeenCalledWith("my-app", true);
            expect(broadcaster.publish).toHaveBeenCalledWith(
                expect.objectContaining({type: "config_changed", stackId: "my-app"}),
            );
        });

        it("publishes config_changed with the new hash when the compose hash differs from lastKnownHash", async () => {
            await service.updateStack("my-app", {
                composeContent: "services:\n  web:\n    image: nginx\n",
            });

            expect(repo.setConfigChanged).toHaveBeenCalledWith("my-app", true);
            expect(repo.updateStackHash).toHaveBeenCalled();
            expect(broadcaster.publish).toHaveBeenCalledWith(
                expect.objectContaining({type: "config_changed", stackId: "my-app"}),
            );
        });

        it("does not publish and clears configChanged when the compose hash equals lastKnownHash", async () => {
            const {createComposeConfig} = await import("../../../src/domain/compose-config.js");
            const composeContent = "services:\n  web:\n    image: nginx\n";
            const composeConfig = createComposeConfig(composeContent);
            repo.findByIdOrThrow.mockResolvedValue({id: "my-app", lastKnownHash: composeConfig.hash});

            await service.updateStack("my-app", {composeContent});

            expect(repo.setConfigChanged).toHaveBeenCalledWith("my-app", false);
            expect(repo.updateStackHash).not.toHaveBeenCalled();
            expect(broadcaster.publish).not.toHaveBeenCalled();
        });

        it("touches neither configChanged nor the broadcaster for a metadata-only update", async () => {
            await service.updateStack("my-app", {displayName: "New Name"});

            expect(repo.setConfigChanged).not.toHaveBeenCalled();
            expect(broadcaster.publish).not.toHaveBeenCalled();
        });
    });
});
