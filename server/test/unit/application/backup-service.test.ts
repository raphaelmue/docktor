import {beforeEach, describe, expect, it, vi} from "vitest";
import {BackupService} from "../../../src/application/backup-service.js";
import path from "node:path";

// Mock node:fs/promises
vi.mock("node:fs/promises", () => ({
    readFile: vi.fn().mockResolvedValue("services:\n  web:\n    image: nginx:latest\n"),
}));

function createMockResticExecutor() {
    return {
        run: vi.fn().mockResolvedValue({exitCode: 0, stderr: ""}),
        buildBackupArgs: vi.fn().mockReturnValue(["backup", "/path"]),
        buildForgetArgs: vi.fn().mockReturnValue(["forget", "--prune"]),
        snapshots: vi.fn().mockResolvedValue([]),
    };
}

function createMockBackupRepository() {
    return {
        create: vi.fn().mockResolvedValue({id: "backup-1", logLines: []}),
        update: vi.fn().mockResolvedValue(undefined),
        findById: vi.fn(),
        findByStackId: vi.fn().mockResolvedValue([]),
    };
}

function createMockStackRepository() {
    return {
        findById: vi.fn(),
        findByIdOrThrow: vi.fn(),
        update: vi.fn().mockResolvedValue(undefined),
        clearConfigChanged: vi.fn().mockResolvedValue(undefined),
        updateStackHash: vi.fn().mockResolvedValue(undefined),
        replaceServices: vi.fn().mockResolvedValue(undefined),
    };
}

function createMockSettingsService() {
    return {
        getSetting: vi.fn(),
        getMany: vi.fn(),
        upsertSetting: vi.fn(),
    };
}

function createMockNotificationService() {
    return {
        notify: vi.fn().mockResolvedValue(undefined),
    };
}

function createMockStackFilesystem() {
    return {
        getStackDirectory: vi.fn().mockReturnValue("/stacks/myapp"),
        readComposeFile: vi.fn().mockResolvedValue("services:\n  web:\n    image: nginx"),
    };
}

function createMockDockerExecutor() {
    return {
        up: vi.fn().mockResolvedValue(undefined),
        stop: vi.fn().mockResolvedValue(undefined),
        restart: vi.fn().mockResolvedValue(undefined),
    };
}

describe("BackupService", () => {
    let service: BackupService;
    let mockResticExecutor: ReturnType<typeof createMockResticExecutor>;
    let mockBackupRepository: ReturnType<typeof createMockBackupRepository>;
    let mockStackRepository: ReturnType<typeof createMockStackRepository>;
    let mockSettingsService: ReturnType<typeof createMockSettingsService>;
    let mockNotificationService: ReturnType<typeof createMockNotificationService>;
    let mockStackFilesystem: ReturnType<typeof createMockStackFilesystem>;
    let mockDockerExecutor: ReturnType<typeof createMockDockerExecutor>;

    beforeEach(() => {
        vi.clearAllMocks();
        mockResticExecutor = createMockResticExecutor();
        mockBackupRepository = createMockBackupRepository();
        mockStackRepository = createMockStackRepository();
        mockSettingsService = createMockSettingsService();
        mockNotificationService = createMockNotificationService();
        mockStackFilesystem = createMockStackFilesystem();
        mockDockerExecutor = createMockDockerExecutor();

        service = new BackupService(
            mockResticExecutor as any,
            mockBackupRepository as any,
            mockStackRepository as any,
            mockSettingsService as any,
            mockNotificationService as any,
            mockStackFilesystem as any,
            mockDockerExecutor as any,
        );

        // Default: stack exists and is running
        mockStackRepository.findByIdOrThrow.mockResolvedValue({
            id: "stack-1",
            slug: "myapp",
            displayName: "My App",
            status: "RUNNING",
            previousStatus: null,
            backupSchedule: null,
            backupRetention: null,
            backupPreHook: null,
            backupPostHook: null,
        });
    });

    describe("initiateBackup()", () => {
        it("creates Backup record with status IN_PROGRESS and trigger MANUAL", async () => {
            mockSettingsService.getMany.mockResolvedValue({
                "backup.repoType": "local",
                "backup.repoPath": "/backups",
                "backup.password": "encrypted:abc",
            });

            await service.initiateBackup("stack-1");

            expect(mockBackupRepository.create).toHaveBeenCalledWith(
                expect.objectContaining({
                    stackId: "stack-1",
                    status: "IN_PROGRESS",
                    trigger: "MANUAL",
                }),
            );
        });

        it("transitions stack to BACKING_UP via assertTransition", async () => {
            mockSettingsService.getMany.mockResolvedValue({
                "backup.repoType": "local",
                "backup.repoPath": "/backups",
                "backup.password": "encrypted:abc",
            });

            await service.initiateBackup("stack-1");

            expect(mockStackRepository.update).toHaveBeenCalledWith(
                "stack-1",
                expect.objectContaining({status: "BACKING_UP"}),
            );
        });

        it("stores previousStatus before transition", async () => {
            mockStackRepository.findByIdOrThrow.mockResolvedValue({
                id: "stack-1",
                status: "RUNNING",
                previousStatus: null,
            });
            mockSettingsService.getMany.mockResolvedValue({
                "backup.repoType": "local",
                "backup.repoPath": "/backups",
                "backup.password": "encrypted:abc",
            });

            await service.initiateBackup("stack-1");

            expect(mockStackRepository.update).toHaveBeenCalledWith(
                "stack-1",
                expect.objectContaining({previousStatus: "RUNNING"}),
            );
        });
    });

    describe("runBackup()", () => {
        const backupRecord = {
            id: "backup-1",
            stackId: "stack-1",
            trigger: "MANUAL",
            logLines: [],
        };

        const stack = {
            id: "stack-1",
            status: "BACKING_UP",
            previousStatus: "RUNNING",
            backupRetention: null,
        };

        const repoConfig = {
            repoType: "local" as const,
            repoPath: "/backups",
            password: "plaintext-password",
        };

        it("calls resticExecutor.run with correct backup args", async () => {
            await service.runBackup(backupRecord as any, stack as any, repoConfig);

            expect(mockResticExecutor.run).toHaveBeenCalled();
        });

        it("runs restic forget after successful backup for scheduled backups", async () => {
            const scheduledRecord = {
                id: "backup-1",
                stackId: "stack-1",
                trigger: "SCHEDULED",
                logLines: [],
            };

            await service.runBackup(scheduledRecord as any, stack as any, repoConfig);

            // Should call run twice: once for backup, once for forget
            expect(mockResticExecutor.run).toHaveBeenCalledTimes(2);
        });

        it("skips forget/prune for manual backups", async () => {
            const manualBackupRecord = {
                id: "backup-manual",
                stackId: "stack-1",
                trigger: "MANUAL",
                logLines: [],
            };

            await service.runBackup(manualBackupRecord as any, stack as any, repoConfig);

            // Should call run only once: backup only, no forget
            expect(mockResticExecutor.run).toHaveBeenCalledTimes(1);
            expect(mockResticExecutor.buildForgetArgs).not.toHaveBeenCalled();
        });

        it("runs forget/prune for scheduled backups", async () => {
            const scheduledBackupRecord = {
                id: "backup-scheduled",
                stackId: "stack-1",
                trigger: "SCHEDULED",
                logLines: [],
            };

            await service.runBackup(scheduledBackupRecord as any, stack as any, repoConfig);

            // Should call run twice: backup + forget
            expect(mockResticExecutor.run).toHaveBeenCalledTimes(2);
            expect(mockResticExecutor.buildForgetArgs).toHaveBeenCalled();
        });

        it("updates Backup status to COMPLETED on success", async () => {
            await service.runBackup(backupRecord as any, stack as any, repoConfig);

            expect(mockBackupRepository.update).toHaveBeenCalledWith(
                "backup-1",
                expect.objectContaining({status: "COMPLETED"}),
            );
        });

        it("restores stack to previousStatus on success", async () => {
            await service.runBackup(backupRecord as any, stack as any, repoConfig);

            expect(mockStackRepository.update).toHaveBeenCalledWith(
                "stack-1",
                expect.objectContaining({status: "RUNNING"}),
            );
        });

        it("updates Backup status to FAILED on restic error", async () => {
            mockResticExecutor.run.mockRejectedValue(new Error("restic: connection refused"));

            await service.runBackup(backupRecord as any, stack as any, repoConfig);

            expect(mockBackupRepository.update).toHaveBeenCalledWith(
                "backup-1",
                expect.objectContaining({status: "FAILED"}),
            );
        });

        it("transitions stack to ERROR on failure", async () => {
            mockResticExecutor.run.mockRejectedValue(new Error("restic: connection refused"));

            await service.runBackup(backupRecord as any, stack as any, repoConfig);

            expect(mockStackRepository.update).toHaveBeenCalledWith(
                "stack-1",
                expect.objectContaining({status: "ERROR"}),
            );
        });

        it("calls notificationService.notify with type backup_failure on failure", async () => {
            mockResticExecutor.run.mockRejectedValue(new Error("restic failed"));

            await service.runBackup(backupRecord as any, stack as any, repoConfig);

            expect(mockNotificationService.notify).toHaveBeenCalledWith(
                expect.objectContaining({type: "backup_failure"}),
            );
        });

        it("stores accumulated log lines in Backup record", async () => {
            // Simulate run producing log output via onLine callback
            mockResticExecutor.run.mockImplementation(async (_args: string[], _env: object, onLine?: (line: string) => void) => {
                onLine?.("snapshot abc123 saved");
                return {exitCode: 0, stderr: ""};
            });

            await service.runBackup(backupRecord as any, stack as any, repoConfig);

            expect(mockBackupRepository.update).toHaveBeenCalledWith(
                "backup-1",
                expect.objectContaining({
                    logLines: expect.arrayContaining(["snapshot abc123 saved"]),
                }),
            );
        });

        it("auto-initializes repo if restic init needed (exit 10 on backup)", async () => {
            // First run call (backup) exits with code 10 — repo not found
            // Service should run `restic init`, then retry backup
            const noRepoError = Object.assign(new Error("exit code 10"), {exitCode: 10});
            mockResticExecutor.run
                .mockRejectedValueOnce(noRepoError)
                .mockResolvedValue({exitCode: 0, stderr: ""});

            await service.runBackup(backupRecord as any, stack as any, repoConfig);

            // run should be called at least 3 times: backup (fail) → init → backup (ok) → forget
            expect(mockResticExecutor.run.mock.calls.length).toBeGreaterThanOrEqual(3);
        });
    });

    describe("getBackupRepoConfig()", () => {
        it("reads backup.* settings from SettingsService", async () => {
            mockSettingsService.getMany.mockResolvedValue({
                "backup.repoType": "local",
                "backup.repoPath": "/backups",
                "backup.password": "encrypted:xyz",
            });

            await (service as any).getBackupRepoConfig();

            expect(mockSettingsService.getMany).toHaveBeenCalledWith(
                expect.arrayContaining(["backup.repoType", "backup.password"]),
            );
        });

        it("decrypts password field using decrypt()", async () => {
            mockSettingsService.getMany.mockResolvedValue({
                "backup.repoType": "local",
                "backup.repoPath": "/backups",
                "backup.password": "encrypted:abc123",
            });

            const config = await (service as any).getBackupRepoConfig();

            // Password should be decrypted, not raw
            expect(config?.password).not.toBe("encrypted:abc123");
        });

        it("returns null if repoType not configured", async () => {
            mockSettingsService.getMany.mockResolvedValue({});

            const config = await (service as any).getBackupRepoConfig();

            expect(config).toBeNull();
        });
    });

    describe("detectAbsolutePathVolumes()", () => {
        it("returns empty array when all volumes are relative or under stack path", () => {
            const composeContent = `
services:
  web:
    image: nginx
    volumes:
      - ./data:/var/www/html
      - /stacks/myapp/volumes/db:/var/lib/postgresql/data
`;
            const warnings = (service as any).detectAbsolutePathVolumes(composeContent, "/stacks/myapp");

            expect(warnings).toEqual([]);
        });

        it("returns warning strings for absolute paths outside stack directory", () => {
            const composeContent = `
services:
  web:
    image: nginx
    volumes:
      - /etc/nginx/conf.d:/etc/nginx/conf.d
`;
            const warnings = (service as any).detectAbsolutePathVolumes(composeContent, "/stacks/myapp");

            expect(warnings.length).toBeGreaterThan(0);
            expect(warnings[0]).toContain("/etc/nginx/conf.d");
        });

        it("handles both short syntax and long syntax volume definitions", () => {
            const composeContent = `
services:
  db:
    image: postgres
    volumes:
      - type: bind
        source: /external/data
        target: /var/lib/postgresql/data
`;
            const warnings = (service as any).detectAbsolutePathVolumes(composeContent, "/stacks/myapp");

            expect(warnings.length).toBeGreaterThan(0);
        });
    });

    describe("runRestore()", () => {
        const snapshotId = "abc123def456";

        it("creates Backup record with trigger RESTORE and status IN_PROGRESS", async () => {
            await service.runRestore("stack-1", snapshotId);

            expect(mockBackupRepository.create).toHaveBeenCalledWith(
                expect.objectContaining({
                    stackId: "stack-1",
                    trigger: "RESTORE",
                    status: "IN_PROGRESS",
                    resticSnapshotId: snapshotId,
                }),
            );
        });

        it("transitions stack to RESTORING", async () => {
            await service.runRestore("stack-1", snapshotId);

            expect(mockStackRepository.update).toHaveBeenCalledWith(
                "stack-1",
                expect.objectContaining({status: "RESTORING"}),
            );
        });

        it("stops the stack before restoring", async () => {
            await service.runRestore("stack-1", snapshotId);

            // Should call docker.stop before restore
            expect(mockDockerExecutor.stop).toHaveBeenCalledWith("stack-1");
        });

        it("calls resticExecutor.run with restore args and --target .", async () => {
            await service.runRestore("stack-1", snapshotId);

            expect(mockResticExecutor.run).toHaveBeenCalledWith(
                expect.arrayContaining(["restore", snapshotId, "--target", "."]),
                expect.any(Object),
                expect.any(Function),
                ".", // cwd parameter
            );
        });

        it("redeploys stack after successful restore", async () => {
            await service.runRestore("stack-1", snapshotId);

            // Should call docker.up after restore
            expect(mockDockerExecutor.up).toHaveBeenCalledWith("stack-1");
            expect(mockStackRepository.update).toHaveBeenCalledWith(
                "stack-1",
                expect.objectContaining({status: "RUNNING"}),
            );
        });

        it("clears configChanged flag after successful restore", async () => {
            await service.runRestore("stack-1", snapshotId);

            // Should call clearConfigChanged to remove "Configuration has changed" warning
            expect(mockStackRepository.clearConfigChanged).toHaveBeenCalledWith("stack-1");
        });

        it("syncs database with restored compose file", async () => {
            await service.runRestore("stack-1", snapshotId);

            // Should update hash and services to match restored compose
            expect(mockStackRepository.updateStackHash).toHaveBeenCalledWith(
                expect.objectContaining({stackId: "stack-1", hash: expect.any(String)}),
            );
            expect(mockStackRepository.replaceServices).toHaveBeenCalledWith(
                "stack-1",
                expect.objectContaining({hash: expect.any(String), services: expect.any(Array)}),
            );
        });

        it("transitions stack to ERROR on restore failure", async () => {
            mockResticExecutor.run.mockRejectedValue(new Error("restore failed"));

            await service.runRestore("stack-1", snapshotId);

            expect(mockStackRepository.update).toHaveBeenCalledWith(
                "stack-1",
                expect.objectContaining({status: "ERROR"}),
            );
        });

        it("stores log lines and error message on failure", async () => {
            mockResticExecutor.run.mockRejectedValue(new Error("restore: corrupted data"));

            await service.runRestore("stack-1", snapshotId);

            expect(mockBackupRepository.update).toHaveBeenCalledWith(
                expect.any(String),
                expect.objectContaining({
                    status: "FAILED",
                    errorMessage: expect.stringContaining("restore"),
                }),
            );
        });
    });

    describe("runPreHook() / runPostHook()", () => {
        it("executes shell command via spawn and collects output", async () => {
            const output = await (service as any).runHook("echo hello", "/stacks/myapp");

            expect(output).toBeDefined();
        });

        it("skips if hook is null or empty", async () => {
            const resultNull = await (service as any).runHook(null, "/stacks/myapp");
            const resultEmpty = await (service as any).runHook("", "/stacks/myapp");

            expect(resultNull).toBeUndefined();
            expect(resultEmpty).toBeUndefined();
        });
    });

    describe("buildEnv path construction", () => {
        it("handles Windows absolute paths correctly", () => {
            const repoConfig = {repoType: "local" as const, password: "test"};
            const windowsPath = "C:\\Users\\D070307\\workspace\\docktor\\server\\dev-data\\stacks\\memos";

            const env = (service as any).buildEnv(repoConfig, windowsPath);

            // Should resolve to stack-local backups directory without doubling drive letter
            const expected = path.resolve(windowsPath, "backups");
            expect(env.RESTIC_REPOSITORY).toBe(expected);
            expect(env.RESTIC_REPOSITORY).not.toContain("C:\\C\\");
        });

        it("handles Unix absolute paths correctly", () => {
            const repoConfig = {repoType: "local" as const, password: "test"};
            const unixPath = "/opt/docktor/stacks/myapp";

            const env = (service as any).buildEnv(repoConfig, unixPath);

            // path.resolve on Windows converts Unix paths to Windows format
            const expected = path.resolve(unixPath, "backups");
            expect(env.RESTIC_REPOSITORY).toBe(expected);
        });
    });
});
