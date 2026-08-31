import {describe, it, expect, vi, beforeEach, afterEach} from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {EventEmitter} from "node:events";
import {spawn} from "node:child_process";
import type {ChildProcess} from "node:child_process";
import {MigrationService} from "../../../src/application/migration-service.js";
import {slugify} from "../../../src/lib/slugify.js";
import type {DockerExecutor} from "../../../src/infrastructure/docker-executor.js";
import type {VolumeMigrator} from "../../../src/infrastructure/volume-migrator.js";
import type {ComposeRewriter} from "../../../src/infrastructure/compose-rewriter.js";
import type {StackFilesystem} from "../../../src/infrastructure/stack-filesystem.js";
import type {StackRepository} from "../../../src/repositories/stack-repository.js";

// DockerExecutor (imported transitively via MigrationService's default
// constructor parameter) calls promisify(execFile) at module scope, so a
// spawn-only mock breaks module load; preserve the rest of the real module
// and only replace spawn, which is the sole child_process API migrate()'s
// injected-around helpers (stopContainersAtPath/startContainersAtPath) use.
vi.mock("node:child_process", async (importOriginal) => {
    const actual = await importOriginal<typeof import("node:child_process")>();
    return {...actual, spawn: vi.fn()};
});

const COMPOSE = "services:\n  web:\n    image: nginx:latest\n";

function createMockDocker() {
    return {up: vi.fn()};
}

function createMockMigrator() {
    return {copyVolumeToBindMount: vi.fn(), copyDirectory: vi.fn()};
}

function createMockRewriter() {
    return {rewrite: vi.fn().mockReturnValue({rewrittenCompose: COMPOSE, extractedEnv: ""})};
}

function createMockStackFs(newStackPath: string) {
    return {
        createDirectory: vi.fn().mockResolvedValue(newStackPath),
        removeDirectory: vi.fn().mockResolvedValue(undefined),
    };
}

function createMockStackRepo() {
    return {
        exists: vi.fn().mockResolvedValue(false),
        create: vi.fn().mockResolvedValue(undefined),
        delete: vi.fn().mockResolvedValue(undefined),
    };
}

describe("MigrationService.migrate (BF-05 rollback)", () => {
    const displayName = "Rollback Fixture";
    const stackId = slugify(displayName);

    let originalDir: string;
    let newStackPath: string;
    let mockDocker: ReturnType<typeof createMockDocker>;
    let mockMigrator: ReturnType<typeof createMockMigrator>;
    let mockRewriter: ReturnType<typeof createMockRewriter>;
    let mockStackFs: ReturnType<typeof createMockStackFs>;
    let mockStackRepo: ReturnType<typeof createMockStackRepo>;

    beforeEach(async () => {
        vi.mocked(spawn).mockReset();
        // Test double: both stopContainersAtPath and startContainersAtPath only
        // ever attach "close" and "error" handlers, so a plain EventEmitter
        // that emits a successful "close" satisfies the whole surface they use.
        vi.mocked(spawn).mockImplementation((() => {
            const emitter = new EventEmitter();
            setImmediate(() => emitter.emit("close", 0));
            return emitter as unknown as ChildProcess;
        }) as unknown as typeof spawn);

        originalDir = await fs.mkdtemp(path.join(os.tmpdir(), "docktor-rollback-original-"));
        await fs.writeFile(path.join(originalDir, "docker-compose.yml"), COMPOSE, "utf-8");
        await fs.mkdir(path.join(originalDir, "data"), {recursive: true});
        await fs.writeFile(path.join(originalDir, "data", "keep.txt"), "keep me", "utf-8");

        newStackPath = await fs.mkdtemp(path.join(os.tmpdir(), "docktor-rollback-newstack-"));

        mockDocker = createMockDocker();
        mockMigrator = createMockMigrator();
        mockRewriter = createMockRewriter();
        mockStackFs = createMockStackFs(newStackPath);
        mockStackRepo = createMockStackRepo();
    });

    afterEach(async () => {
        await fs.rm(originalDir, {recursive: true, force: true});
        await fs.rm(newStackPath, {recursive: true, force: true});
    });

    async function assertNoBackupLeftover(): Promise<void> {
        const leftovers = (await fs.readdir(os.tmpdir())).filter((name) =>
            name.startsWith(`docktor-migration-backup-${stackId}-`),
        );
        expect(leftovers).toEqual([]);
    }

    function buildService(): MigrationService {
        // Test double: these five collaborators are exactly the constructor
        // parameters migrate() invokes; the casts expose only the members it
        // calls (up/copyVolumeToBindMount/copyDirectory/rewrite/createDirectory/
        // removeDirectory/exists/create/delete).
        return new MigrationService(
            mockDocker as unknown as DockerExecutor,
            mockMigrator as unknown as VolumeMigrator,
            mockRewriter as unknown as ComposeRewriter,
            mockStackFs as unknown as StackFilesystem,
            mockStackRepo as unknown as StackRepository,
        );
    }

    it("BF-05: rolls back and restores the original stack when docker.up fails", async () => {
        mockDocker.up.mockRejectedValue(new Error("docker compose up failed"));
        const service = buildService();

        const result = await service.migrate({
            composePath: path.join(originalDir, "docker-compose.yml"),
            displayName,
            volumeSelections: [],
            namedVolumeSelections: new Map(),
        });

        expect(result.success).toBe(false);
        expect(result.error).toContain("docker compose up failed");
        expect(result.error).toContain("Rollback complete");
        expect(result.originalPath).toBe(originalDir);

        expect(mockStackFs.removeDirectory).toHaveBeenCalledWith(stackId);
        expect(mockStackRepo.delete).toHaveBeenCalledWith(stackId);

        const restoredCompose = await fs.readFile(path.join(originalDir, "docker-compose.yml"), "utf-8");
        const restoredData = await fs.readFile(path.join(originalDir, "data", "keep.txt"), "utf-8");
        expect(restoredCompose).toBe(COMPOSE);
        expect(restoredData).toBe("keep me");

        expect(vi.mocked(spawn)).toHaveBeenCalledWith("docker", ["compose", "up", "-d"], {cwd: originalDir});

        await assertNoBackupLeftover();
    });

    it("BF-05: cleans up the backup snapshot on a successful migration", async () => {
        mockDocker.up.mockResolvedValue(undefined);
        const service = buildService();

        const result = await service.migrate({
            composePath: path.join(originalDir, "docker-compose.yml"),
            displayName,
            volumeSelections: [],
            namedVolumeSelections: new Map(),
        });

        expect(result).toEqual({success: true, stackId, originalPath: originalDir});
        expect(mockStackFs.removeDirectory).not.toHaveBeenCalled();
        expect(mockStackRepo.delete).not.toHaveBeenCalled();

        await assertNoBackupLeftover();
    });
});
