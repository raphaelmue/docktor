import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {
    BackupService,
    getBackupBroadcaster,
    ensureBackupBroadcaster,
    disposeBackupBroadcaster,
    ensureBackupLogBuffer,
    getBackupLogBuffer,
} from "../../../src/application/backup-service.js";
import {BadRequestError, NotFoundError} from "../../../src/lib/errors.js";
import {EventEmitter} from "node:events";
import path from "node:path";

const CONFIGURED_REPO_SETTINGS = {
    "backup.repoType": "local",
    "backup.repoPath": "/backups",
    "backup.password": "encrypted:abc",
};

function createMockBroadcaster() {
    return {
        publish: vi.fn(),
    };
}

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
    let mockBroadcaster: ReturnType<typeof createMockBroadcaster>;

    beforeEach(() => {
        vi.clearAllMocks();
        mockResticExecutor = createMockResticExecutor();
        mockBackupRepository = createMockBackupRepository();
        mockStackRepository = createMockStackRepository();
        mockSettingsService = createMockSettingsService();
        mockNotificationService = createMockNotificationService();
        mockStackFilesystem = createMockStackFilesystem();
        mockDockerExecutor = createMockDockerExecutor();
        mockBroadcaster = createMockBroadcaster();

        service = new BackupService(
            mockResticExecutor as any,
            mockBackupRepository as any,
            mockStackRepository as any,
            mockSettingsService as any,
            mockNotificationService as any,
            mockStackFilesystem as any,
            mockDockerExecutor as any,
            mockBroadcaster as any,
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

    afterEach(() => {
        // backupBroadcasters is module-level state shared across tests — a test
        // that registers an emitter (e.g. via initiateBackup or abortBackup)
        // without running a full runBackup()/runRestore() to completion must not
        // leak it into the next test.
        disposeBackupBroadcaster("backup-1");
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

        it("registers a broadcaster for the new backup before initiateBackup returns", async () => {
            mockSettingsService.getMany.mockResolvedValue({
                "backup.repoType": "local",
                "backup.repoPath": "/backups",
                "backup.password": "encrypted:abc",
            });

            await service.initiateBackup("stack-1");

            expect(getBackupBroadcaster("backup-1")).toBeInstanceOf(EventEmitter);
        });

        it("a listener attached between initiateBackup and runBackup still receives runBackup's done event (CR-02 regression)", async () => {
            mockSettingsService.getMany.mockResolvedValue({
                "backup.repoType": "local",
                "backup.repoPath": "/backups",
                "backup.password": "encrypted:abc",
            });

            await service.initiateBackup("stack-1");
            const emitter = getBackupBroadcaster("backup-1");
            const onDone = vi.fn();
            emitter?.on("done", onDone);

            const backupRecord = {id: "backup-1", stackId: "stack-1", trigger: "MANUAL" as const, logLines: []};
            const stack = {id: "stack-1", status: "BACKING_UP" as const, previousStatus: "RUNNING" as const, backupRetention: null};
            const repoConfig = {repoType: "local" as const, repoPath: "/backups", password: "plaintext-password"};

            await service.runBackup(backupRecord as any, stack as any, repoConfig);

            expect(onDone).toHaveBeenCalledWith("COMPLETED");
        });

        it("rejects with BadRequestError and creates no row / transitions no status when no backup repository is configured", async () => {
            mockSettingsService.getMany.mockResolvedValue({});

            await expect(service.initiateBackup("stack-1")).rejects.toBeInstanceOf(BadRequestError);

            expect(mockBackupRepository.create).not.toHaveBeenCalled();
            expect(mockStackRepository.update).not.toHaveBeenCalled();
        });

        it("still produces the NotFoundError from findByIdOrThrow for an unknown stack id, not the new BadRequestError", async () => {
            mockStackRepository.findByIdOrThrow.mockRejectedValue(new NotFoundError("Stack not found"));
            mockSettingsService.getMany.mockResolvedValue({});

            await expect(service.initiateBackup("unknown-stack")).rejects.toBeInstanceOf(NotFoundError);

            expect(mockBackupRepository.create).not.toHaveBeenCalled();
            expect(mockStackRepository.update).not.toHaveBeenCalled();
        });

        it("publishes stack_status with BACKING_UP when a repository is configured", async () => {
            mockSettingsService.getMany.mockResolvedValue(CONFIGURED_REPO_SETTINGS);

            await service.initiateBackup("stack-1");

            expect(mockBroadcaster.publish).toHaveBeenCalledWith({
                type: "stack_status",
                stackId: "stack-1",
                stackStatus: "BACKING_UP",
            });
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

        it("auto-initializes repo on the real restic 0.16.x error shape (exit 1, 'unable to open config file')", async () => {
            // This is what restic actually returns for a missing local repo — exit code 10
            // is documented but not what this restic version produces. Reproduced directly:
            // `restic backup` against a non-existent repo exits 1 with this exact message.
            const realRepoNotFoundError = Object.assign(
                new Error(
                    "restic exited with code 1: Fatal: unable to open config file: stat /stacks/memos/backups/config: no such file or directory\nIs there a repository at the following location?\n/stacks/memos/backups",
                ),
                {exitCode: 1},
            );
            mockResticExecutor.run
                .mockRejectedValueOnce(realRepoNotFoundError)
                .mockResolvedValue({exitCode: 0, stderr: ""});

            await service.runBackup(backupRecord as any, stack as any, repoConfig);

            expect(mockResticExecutor.run.mock.calls.length).toBeGreaterThanOrEqual(3);
            const backupResult = mockBackupRepository.update.mock.calls.find(
                (call: any[]) => call[1]?.status === "COMPLETED",
            );
            expect(backupResult).toBeDefined();
        });

        it("does not auto-init on a wrong-password error, even though it also exits 1", async () => {
            const wrongPasswordError = Object.assign(
                new Error("restic exited with code 1: Fatal: wrong password or no key found"),
                {exitCode: 1},
            );
            mockResticExecutor.run.mockRejectedValue(wrongPasswordError);

            await service.runBackup(backupRecord as any, stack as any, repoConfig);

            // Only the original failing call — no init, no retry
            expect(mockResticExecutor.run).toHaveBeenCalledTimes(1);
            expect(mockBackupRepository.update).toHaveBeenCalledWith(
                backupRecord.id,
                expect.objectContaining({status: "FAILED"}),
            );
        });

        it("emits done with COMPLETED status on success", async () => {
            const promise = service.runBackup(backupRecord as any, stack as any, repoConfig);
            const emitter = getBackupBroadcaster(backupRecord.id);
            const onDone = vi.fn();
            emitter?.on("done", onDone);

            await promise;

            expect(onDone).toHaveBeenCalledWith("COMPLETED");
        });

        it("emits done with FAILED status on restic error", async () => {
            mockResticExecutor.run.mockRejectedValue(new Error("restic: connection refused"));

            const promise = service.runBackup(backupRecord as any, stack as any, repoConfig);
            const emitter = getBackupBroadcaster(backupRecord.id);
            const onDone = vi.fn();
            emitter?.on("done", onDone);

            await promise;

            expect(onDone).toHaveBeenCalledWith("FAILED");
        });

        it("persists a [error] logLines entry containing the rejection message on failure", async () => {
            mockResticExecutor.run.mockRejectedValue(new Error("restic: connection refused"));

            await service.runBackup(backupRecord as any, stack as any, repoConfig);

            const failedUpdate = mockBackupRepository.update.mock.calls.find(
                (call: any[]) => call[1]?.status === "FAILED",
            );
            expect(failedUpdate).toBeDefined();
            const persistedLines = failedUpdate?.[1]?.logLines as string[];
            expect(persistedLines[persistedLines.length - 1]).toMatch(/^\[error\] /);
            expect(persistedLines[persistedLines.length - 1]).toContain("restic: connection refused");
        });

        it("persists a non-empty logLines array when restic rejects before any onLine call", async () => {
            mockResticExecutor.run.mockRejectedValue(new Error("restic binary not found"));

            await service.runBackup(backupRecord as any, stack as any, repoConfig);

            const failedUpdate = mockBackupRepository.update.mock.calls.find(
                (call: any[]) => call[1]?.status === "FAILED",
            );
            expect(failedUpdate?.[1]?.logLines.length).toBeGreaterThan(0);
        });

        it("emits the [error] line on the line event before the stream closes", async () => {
            mockResticExecutor.run.mockRejectedValue(new Error("restic: connection refused"));

            const promise = service.runBackup(backupRecord as any, stack as any, repoConfig);
            const emitter = getBackupBroadcaster(backupRecord.id);
            const onLine = vi.fn();
            emitter?.on("line", onLine);

            await promise;

            expect(onLine).toHaveBeenCalledWith(expect.stringContaining("[error] restic: connection refused"));
        });

        it("persists logLines with no [error] entry on success", async () => {
            await service.runBackup(backupRecord as any, stack as any, repoConfig);

            const completedUpdate = mockBackupRepository.update.mock.calls.find(
                (call: any[]) => call[1]?.status === "COMPLETED",
            );
            const persistedLines = completedUpdate?.[1]?.logLines as string[];
            expect(persistedLines.some((line) => line.startsWith("[error] "))).toBe(false);
        });

        it("removes the broadcaster once runBackup resolves", async () => {
            await service.runBackup(backupRecord as any, stack as any, repoConfig);

            expect(getBackupBroadcaster(backupRecord.id)).toBeUndefined();
        });

        it("publishes stack_status with the stack's restored previous status on success", async () => {
            await service.runBackup(backupRecord as any, stack as any, repoConfig);

            expect(mockBroadcaster.publish).toHaveBeenCalledWith({
                type: "stack_status",
                stackId: "stack-1",
                stackStatus: "RUNNING",
            });
        });

        it("publishes stack_status with ERROR on failure", async () => {
            mockResticExecutor.run.mockRejectedValue(new Error("restic: connection refused"));

            await service.runBackup(backupRecord as any, stack as any, repoConfig);

            expect(mockBroadcaster.publish).toHaveBeenCalledWith({
                type: "stack_status",
                stackId: "stack-1",
                stackStatus: "ERROR",
            });
        });
    });

    describe("log buffer (WR-01 — live SSE replay)", () => {
        it("getBackupLogBuffer returns undefined for a backup id no run has started", () => {
            expect(getBackupLogBuffer("no-run-started-for-this-id")).toBeUndefined();
        });

        it("ensureBackupLogBuffer returns the same array instance on repeated calls for one id", () => {
            const first = ensureBackupLogBuffer("backup-1");
            const second = ensureBackupLogBuffer("backup-1");

            expect(first).toBe(second);
        });

        it("while runBackup is mid-run, getBackupLogBuffer(backupRecord.id) contains every line already handed to the executor's line callback, in arrival order", async () => {
            const backupRecord = {id: "backup-1", stackId: "stack-1", trigger: "MANUAL", logLines: []};
            const stack = {id: "stack-1", status: "BACKING_UP", previousStatus: "RUNNING", backupRetention: null};
            const repoConfig = {repoType: "local" as const, repoPath: "/backups", password: "plaintext-password"};

            let assertedInsideCallback = false;
            mockResticExecutor.run.mockImplementation(
                async (_args: string[], _env: object, onLine?: (line: string) => void) => {
                    onLine?.("line one");
                    onLine?.("line two");
                    // Assert from inside the mocked executor's callback — the point
                    // at which lines have been emitted but the run has not finished —
                    // so mid-run visibility is real, not inferred from the terminal state.
                    expect(getBackupLogBuffer(backupRecord.id)).toEqual(["line one", "line two"]);
                    assertedInsideCallback = true;
                    return {exitCode: 0, stderr: ""};
                },
            );

            await service.runBackup(backupRecord as any, stack as any, repoConfig);

            expect(assertedInsideCallback).toBe(true);
        });

        it("getBackupLogBuffer(backupRecord.id) is undefined after runBackup reaches a terminal state", async () => {
            const backupRecord = {id: "backup-1", stackId: "stack-1", trigger: "MANUAL", logLines: []};
            const stack = {id: "stack-1", status: "BACKING_UP", previousStatus: "RUNNING", backupRetention: null};
            const repoConfig = {repoType: "local" as const, repoPath: "/backups", password: "plaintext-password"};

            await service.runBackup(backupRecord as any, stack as any, repoConfig);

            expect(getBackupLogBuffer(backupRecord.id)).toBeUndefined();
        });

        it("while runRestoreProcess is mid-run, getBackupLogBuffer(backup.id) contains every line already handed to the executor's line callback, in arrival order (restore parity)", async () => {
            const snapshotId = "abc123def456";
            const backupRecord = {id: "backup-1", stackId: "stack-1", trigger: "RESTORE", logLines: []};
            const stack = {id: "stack-1", displayName: "My App", status: "RESTORING", previousStatus: "RUNNING", hostPath: null};

            let assertedInsideCallback = false;
            mockResticExecutor.run.mockImplementation(
                async (_args: string[], _env: object, onLine?: (line: string) => void) => {
                    onLine?.("restore line one");
                    onLine?.("restore line two");
                    expect(getBackupLogBuffer("backup-1")).toEqual(["restore line one", "restore line two"]);
                    assertedInsideCallback = true;
                    return {exitCode: 0, stderr: ""};
                },
            );

            await service.runRestoreProcess(backupRecord as any, stack as any, snapshotId);

            expect(assertedInsideCallback).toBe(true);
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

    describe("initiateRestore()", () => {
        const snapshotId = "abc123def456";

        beforeEach(() => {
            // initiateRestore now guards on a configured repository (Task 1) —
            // configure one by default so the pre-existing happy-path tests in
            // this describe block are unaffected by the new guard.
            mockSettingsService.getMany.mockResolvedValue(CONFIGURED_REPO_SETTINGS);
        });

        it("creates Backup record with trigger RESTORE and status IN_PROGRESS", async () => {
            await service.initiateRestore("stack-1", snapshotId);

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
            await service.initiateRestore("stack-1", snapshotId);

            expect(mockStackRepository.update).toHaveBeenCalledWith(
                "stack-1",
                expect.objectContaining({status: "RESTORING"}),
            );
        });

        it("registers a broadcaster for the new backup before initiateRestore returns (mirrors initiateBackup, BCK-09)", async () => {
            await service.initiateRestore("stack-1", snapshotId);

            expect(getBackupBroadcaster("backup-1")).toBeInstanceOf(EventEmitter);
        });

        it("rejects with BadRequestError and creates no row / transitions no status when no backup repository is configured", async () => {
            mockSettingsService.getMany.mockResolvedValue({});

            await expect(service.initiateRestore("stack-1", snapshotId)).rejects.toBeInstanceOf(BadRequestError);

            expect(mockBackupRepository.create).not.toHaveBeenCalled();
            expect(mockStackRepository.update).not.toHaveBeenCalled();
        });

        it("publishes stack_status with RESTORING when a repository is configured", async () => {
            await service.initiateRestore("stack-1", snapshotId);

            expect(mockBroadcaster.publish).toHaveBeenCalledWith({
                type: "stack_status",
                stackId: "stack-1",
                stackStatus: "RESTORING",
            });
        });
    });

    describe("runRestoreProcess()", () => {
        const snapshotId = "abc123def456";
        const backupRecord = {
            id: "backup-1",
            stackId: "stack-1",
            trigger: "RESTORE",
            resticSnapshotId: snapshotId,
            logLines: [],
        };
        const stack = {
            id: "stack-1",
            displayName: "My App",
            status: "RESTORING",
            previousStatus: "RUNNING",
            hostPath: null,
        };

        it("stops the stack before restoring", async () => {
            await service.runRestoreProcess(backupRecord as any, stack as any, snapshotId);

            // Should call docker.stop before restore
            expect(mockDockerExecutor.stop).toHaveBeenCalledWith("stack-1");
        });

        it("calls resticExecutor.run with restore args and --target .", async () => {
            await service.runRestoreProcess(backupRecord as any, stack as any, snapshotId);

            expect(mockResticExecutor.run).toHaveBeenCalledWith(
                expect.arrayContaining(["restore", snapshotId, "--target", "."]),
                expect.any(Object),
                expect.any(Function),
                ".", // cwd parameter
            );
        });

        it("redeploys stack after successful restore", async () => {
            await service.runRestoreProcess(backupRecord as any, stack as any, snapshotId);

            // Should call docker.up after restore
            expect(mockDockerExecutor.up).toHaveBeenCalledWith("stack-1");
            expect(mockStackRepository.update).toHaveBeenCalledWith(
                "stack-1",
                expect.objectContaining({status: "RUNNING"}),
            );
        });

        it("clears configChanged flag after successful restore", async () => {
            await service.runRestoreProcess(backupRecord as any, stack as any, snapshotId);

            // Should call clearConfigChanged to remove "Configuration has changed" warning
            expect(mockStackRepository.clearConfigChanged).toHaveBeenCalledWith("stack-1");
        });

        it("syncs database with restored compose file", async () => {
            await service.runRestoreProcess(backupRecord as any, stack as any, snapshotId);

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

            await service.runRestoreProcess(backupRecord as any, stack as any, snapshotId);

            expect(mockStackRepository.update).toHaveBeenCalledWith(
                "stack-1",
                expect.objectContaining({status: "ERROR"}),
            );
        });

        it("stores log lines and error message on failure", async () => {
            mockResticExecutor.run.mockRejectedValue(new Error("restore: corrupted data"));

            await service.runRestoreProcess(backupRecord as any, stack as any, snapshotId);

            expect(mockBackupRepository.update).toHaveBeenCalledWith(
                expect.any(String),
                expect.objectContaining({
                    status: "FAILED",
                    errorMessage: expect.stringContaining("restore"),
                }),
            );
        });

        it("emits done with COMPLETED status on success", async () => {
            // ensureBackupBroadcaster runs synchronously before the first await
            // inside runRestoreProcess, so the emitter is already registered by
            // the time this call returns control to the caller.
            const promise = service.runRestoreProcess(backupRecord as any, stack as any, snapshotId);
            const emitter = getBackupBroadcaster("backup-1");
            const onDone = vi.fn();
            emitter?.on("done", onDone);

            await promise;

            expect(onDone).toHaveBeenCalledWith("COMPLETED");
        });

        it("emits done with FAILED status on restore failure", async () => {
            mockResticExecutor.run.mockRejectedValue(new Error("restore failed"));

            const promise = service.runRestoreProcess(backupRecord as any, stack as any, snapshotId);
            const emitter = getBackupBroadcaster("backup-1");
            const onDone = vi.fn();
            emitter?.on("done", onDone);

            await promise;

            expect(onDone).toHaveBeenCalledWith("FAILED");
        });

        it("persists a [error] logLines entry containing the rejection message on failure", async () => {
            mockResticExecutor.run.mockRejectedValue(new Error("restore: corrupted data"));

            await service.runRestoreProcess(backupRecord as any, stack as any, snapshotId);

            const failedUpdate = mockBackupRepository.update.mock.calls.find(
                (call: any[]) => call[1]?.status === "FAILED",
            );
            const persistedLines = failedUpdate?.[1]?.logLines as string[];
            expect(persistedLines[persistedLines.length - 1]).toMatch(/^\[error\] /);
            expect(persistedLines[persistedLines.length - 1]).toContain("restore: corrupted data");
        });

        it("persists a non-empty logLines array when restore rejects before any onLine call", async () => {
            mockResticExecutor.run.mockRejectedValue(new Error("restore binary not found"));

            await service.runRestoreProcess(backupRecord as any, stack as any, snapshotId);

            const failedUpdate = mockBackupRepository.update.mock.calls.find(
                (call: any[]) => call[1]?.status === "FAILED",
            );
            expect(failedUpdate?.[1]?.logLines.length).toBeGreaterThan(0);
        });

        it("registers its emitter through ensureBackupBroadcaster and removes it through disposeBackupBroadcaster, same as runBackup (BCK-09)", async () => {
            await service.runRestoreProcess(backupRecord as any, stack as any, snapshotId);

            // By the time runRestoreProcess resolves, its broadcaster has already
            // gone through the same register/dispose pair runBackup uses — verified
            // by the absence of a leftover entry (disposeBackupBroadcaster ran) and
            // by the "emits done" cases above (ensureBackupBroadcaster ran, since
            // those attach a listener to the emitter it returns).
            expect(getBackupBroadcaster("backup-1")).toBeUndefined();
        });

        it("publishes stack_status with RUNNING on successful restore", async () => {
            await service.runRestoreProcess(backupRecord as any, stack as any, snapshotId);

            expect(mockBroadcaster.publish).toHaveBeenCalledWith({
                type: "stack_status",
                stackId: "stack-1",
                stackStatus: "RUNNING",
            });
        });

        it("publishes stack_status with ERROR on restore failure", async () => {
            mockResticExecutor.run.mockRejectedValue(new Error("restore failed"));

            await service.runRestoreProcess(backupRecord as any, stack as any, snapshotId);

            expect(mockBroadcaster.publish).toHaveBeenCalledWith({
                type: "stack_status",
                stackId: "stack-1",
                stackStatus: "ERROR",
            });
        });
    });

    describe("abortBackup()", () => {
        it("sets an IN_PROGRESS row to FAILED with completedAt, errorMessage, and a single [error] logLines entry", async () => {
            mockBackupRepository.findById.mockResolvedValue({id: "backup-1", status: "IN_PROGRESS"});

            await service.abortBackup("backup-1", "stack-1", "No backup repository is configured.");

            expect(mockBackupRepository.update).toHaveBeenCalledWith(
                "backup-1",
                expect.objectContaining({
                    status: "FAILED",
                    completedAt: expect.any(Date),
                    errorMessage: "No backup repository is configured.",
                    logLines: ["[error] No backup repository is configured."],
                }),
            );
        });

        it("transitions the stack to ERROR", async () => {
            mockBackupRepository.findById.mockResolvedValue({id: "backup-1", status: "IN_PROGRESS"});

            await service.abortBackup("backup-1", "stack-1", "boom");

            expect(mockStackRepository.update).toHaveBeenCalledWith(
                "stack-1",
                expect.objectContaining({status: "ERROR"}),
            );
        });

        it("calls notificationService.notify with type backup_failure and the stack id", async () => {
            mockBackupRepository.findById.mockResolvedValue({id: "backup-1", status: "IN_PROGRESS"});

            await service.abortBackup("backup-1", "stack-1", "boom");

            expect(mockNotificationService.notify).toHaveBeenCalledWith(
                expect.objectContaining({type: "backup_failure", stackId: "stack-1"}),
            );
        });

        it("is a no-op on a row that is already COMPLETED", async () => {
            mockBackupRepository.findById.mockResolvedValue({id: "backup-1", status: "COMPLETED"});

            await service.abortBackup("backup-1", "stack-1", "boom");

            expect(mockBackupRepository.update).not.toHaveBeenCalled();
            expect(mockStackRepository.update).not.toHaveBeenCalled();
            expect(mockNotificationService.notify).not.toHaveBeenCalled();
        });

        it("is a no-op on a row that is already FAILED", async () => {
            mockBackupRepository.findById.mockResolvedValue({id: "backup-1", status: "FAILED"});

            await service.abortBackup("backup-1", "stack-1", "boom");

            expect(mockBackupRepository.update).not.toHaveBeenCalled();
            expect(mockStackRepository.update).not.toHaveBeenCalled();
            expect(mockNotificationService.notify).not.toHaveBeenCalled();
        });

        it("is a no-op and does not throw on an unknown backup id", async () => {
            mockBackupRepository.findById.mockResolvedValue(null);

            await expect(service.abortBackup("unknown-id", "stack-1", "boom")).resolves.toBeUndefined();

            expect(mockBackupRepository.update).not.toHaveBeenCalled();
            expect(mockStackRepository.update).not.toHaveBeenCalled();
            expect(mockNotificationService.notify).not.toHaveBeenCalled();
        });

        it("on a still-IN_PROGRESS row, emits done with FAILED on the registered emitter, then removes it", async () => {
            mockBackupRepository.findById.mockResolvedValue({id: "backup-1", status: "IN_PROGRESS"});
            const emitter = ensureBackupBroadcaster("backup-1");
            const onDone = vi.fn();
            emitter.on("done", onDone);

            await service.abortBackup("backup-1", "stack-1", "boom");

            expect(onDone).toHaveBeenCalledWith("FAILED");
            expect(getBackupBroadcaster("backup-1")).toBeUndefined();
        });

        it("emits done even when the notification send rejects", async () => {
            mockBackupRepository.findById.mockResolvedValue({id: "backup-1", status: "IN_PROGRESS"});
            mockNotificationService.notify.mockRejectedValueOnce(new Error("smtp down"));
            const emitter = ensureBackupBroadcaster("backup-1");
            const onDone = vi.fn();
            emitter.on("done", onDone);

            await expect(service.abortBackup("backup-1", "stack-1", "boom")).rejects.toThrow("smtp down");

            expect(onDone).toHaveBeenCalledWith("FAILED");
            expect(getBackupBroadcaster("backup-1")).toBeUndefined();
        });

        it("on a row that is already COMPLETED or FAILED, emits nothing and leaves the registered emitter in place", async () => {
            mockBackupRepository.findById.mockResolvedValue({id: "backup-1", status: "COMPLETED"});
            const emitter = ensureBackupBroadcaster("backup-1");
            const onDone = vi.fn();
            emitter.on("done", onDone);

            await service.abortBackup("backup-1", "stack-1", "boom");

            expect(onDone).not.toHaveBeenCalled();
            expect(getBackupBroadcaster("backup-1")).toBe(emitter);
        });

        it("publishes stack_status with ERROR", async () => {
            mockBackupRepository.findById.mockResolvedValue({id: "backup-1", status: "IN_PROGRESS"});

            await service.abortBackup("backup-1", "stack-1", "boom");

            expect(mockBroadcaster.publish).toHaveBeenCalledWith({
                type: "stack_status",
                stackId: "stack-1",
                stackStatus: "ERROR",
            });
        });

        it("swallows a throwing broadcaster publish — the status write and the terminal done frame still complete", async () => {
            mockBackupRepository.findById.mockResolvedValue({id: "backup-1", status: "IN_PROGRESS"});
            mockBroadcaster.publish.mockImplementation(() => {
                throw new Error("subscriber exploded");
            });
            const emitter = ensureBackupBroadcaster("backup-1");
            const onDone = vi.fn();
            emitter.on("done", onDone);

            await service.abortBackup("backup-1", "stack-1", "boom");

            expect(mockStackRepository.update).toHaveBeenCalledWith(
                "stack-1",
                expect.objectContaining({status: "ERROR"}),
            );
            expect(onDone).toHaveBeenCalledWith("FAILED");
            expect(getBackupBroadcaster("backup-1")).toBeUndefined();
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
