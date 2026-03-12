import {beforeEach, describe, expect, it, vi} from "vitest";
import {StackService} from "../../../src/application/stack-service.js";
import {BadRequestError, ConflictError} from "../../../src/lib/errors.js";

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
    };
}

describe("StackService", () => {
    let service: StackService;
    let repo: ReturnType<typeof createMockRepo>;
    let fs: ReturnType<typeof createMockFs>;
    let docker: ReturnType<typeof createMockDocker>;

    beforeEach(() => {
        repo = createMockRepo();
        fs = createMockFs();
        docker = createMockDocker();
        service = new StackService(repo as any, fs as any, docker as any);
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
    });
});
