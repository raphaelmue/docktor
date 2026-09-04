import {beforeEach, describe, expect, it, vi} from "vitest";

vi.mock("node-cron");

import * as nodeCron from "node-cron";
import {BackupScheduler} from "../../../src/jobs/backup-scheduler.js";

const mockSchedule = vi.mocked(nodeCron.schedule);

function createMockCronTask() {
    return {
        stop: vi.fn(),
        start: vi.fn(),
    };
}

function createMockBackupService() {
    return {
        initiateBackup: vi.fn().mockResolvedValue(undefined),
        runBackup: vi.fn().mockResolvedValue(undefined),
        getBackupRepoConfig: vi.fn().mockResolvedValue(null),
        abortBackup: vi.fn().mockResolvedValue(undefined),
    };
}

function createMockStackRepository() {
    return {
        findAllWithSchedule: vi.fn().mockResolvedValue([]),
        findByIdOrThrow: vi.fn(),
    };
}

function createMockSettingsService() {
    return {
        getSetting: vi.fn().mockResolvedValue(null),
    };
}

function createMockBackupRepository() {
    return {
        findByIdOrThrow: vi.fn(),
    };
}

describe("BackupScheduler", () => {
    let scheduler: BackupScheduler;
    let mockBackupService: ReturnType<typeof createMockBackupService>;
    let mockStackRepository: ReturnType<typeof createMockStackRepository>;
    let mockSettingsService: ReturnType<typeof createMockSettingsService>;
    let mockBackupRepository: ReturnType<typeof createMockBackupRepository>;

    beforeEach(() => {
        vi.clearAllMocks();
        mockBackupService = createMockBackupService();
        mockStackRepository = createMockStackRepository();
        mockSettingsService = createMockSettingsService();
        mockBackupRepository = createMockBackupRepository();

        scheduler = new BackupScheduler(
            mockBackupService as any,
            mockStackRepository as any,
            mockSettingsService as any,
            mockBackupRepository as any,
        );

        // Default: schedule() returns a mock task
        mockSchedule.mockReturnValue(createMockCronTask() as any);
    });

    describe("upsert()", () => {
        it("creates a cron task for the given stackId and schedule", () => {
            scheduler.upsert("stack-1", "0 2 * * *");

            expect(mockSchedule).toHaveBeenCalledWith(
                "0 2 * * *",
                expect.any(Function),
                expect.any(Object),
            );
        });

        it("stops existing task before creating new one for same stackId", () => {
            const existingTask = createMockCronTask();
            mockSchedule.mockReturnValueOnce(existingTask as any);

            scheduler.upsert("stack-1", "0 2 * * *");

            // Upsert again with different schedule
            mockSchedule.mockReturnValueOnce(createMockCronTask() as any);
            scheduler.upsert("stack-1", "0 3 * * *");

            expect(existingTask.stop).toHaveBeenCalled();
            // A new task should have been created
            expect(mockSchedule).toHaveBeenCalledTimes(2);
        });
    });

    describe("remove()", () => {
        it("stops and deletes the task for the given stackId", () => {
            const task = createMockCronTask();
            mockSchedule.mockReturnValue(task as any);

            scheduler.upsert("stack-1", "0 2 * * *");
            scheduler.remove("stack-1");

            expect(task.stop).toHaveBeenCalled();
        });

        it("is a no-op if stackId has no registered task", () => {
            // Should not throw
            expect(() => scheduler.remove("nonexistent-stack")).not.toThrow();
        });
    });

    describe("stop()", () => {
        it("stops all registered tasks and clears the map", () => {
            const task1 = createMockCronTask();
            const task2 = createMockCronTask();
            mockSchedule.mockReturnValueOnce(task1 as any).mockReturnValueOnce(task2 as any);

            scheduler.upsert("stack-1", "0 2 * * *");
            scheduler.upsert("stack-2", "0 3 * * *");

            scheduler.stop();

            expect(task1.stop).toHaveBeenCalled();
            expect(task2.stop).toHaveBeenCalled();

            // After stop, upsert should be able to re-register from a clean state
            mockSchedule.mockReturnValue(createMockCronTask() as any);
            scheduler.upsert("stack-1", "0 4 * * *");
            expect(mockSchedule).toHaveBeenCalledTimes(3);
        });
    });

    describe("loadAll()", () => {
        it("queries stacks with backup schedules and registers cron tasks", async () => {
            mockStackRepository.findAllWithSchedule.mockResolvedValue([
                {id: "stack-1", backupSchedule: "0 2 * * *"},
                {id: "stack-2", backupSchedule: "0 4 * * *"},
            ]);

            await scheduler.loadAll();

            expect(mockSchedule).toHaveBeenCalledTimes(2);
        });

        it("uses global default schedule for stacks without override", async () => {
            mockSettingsService.getSetting.mockResolvedValue("0 1 * * *");
            mockStackRepository.findAllWithSchedule.mockResolvedValue([
                {id: "stack-1", backupSchedule: null},
            ]);

            await scheduler.loadAll();

            expect(mockSchedule).toHaveBeenCalledWith(
                "0 1 * * *",
                expect.any(Function),
                expect.any(Object),
            );
        });

        it("skips stacks with no schedule and no global default", async () => {
            mockSettingsService.getSetting.mockResolvedValue(null);
            mockStackRepository.findAllWithSchedule.mockResolvedValue([
                {id: "stack-1", backupSchedule: null},
            ]);

            await scheduler.loadAll();

            expect(mockSchedule).not.toHaveBeenCalled();
        });
    });

    describe("runScheduledBackup()", () => {
        function fireCronCallback(): void {
            const lastCall = mockSchedule.mock.calls[mockSchedule.mock.calls.length - 1];
            const cronCallback = lastCall?.[1] as (() => void) | undefined;
            cronCallback?.();
        }

        const stackRecord = {
            id: "stack-1",
            status: "BACKING_UP",
            previousStatus: "RUNNING",
            backupPreHook: null,
            backupPostHook: null,
            backupSchedule: null,
            backupRetention: null,
        };

        const repoConfig = {repoType: "local" as const, password: "secret"};

        it("calls runBackup with three defined arguments when all three resolve", async () => {
            mockBackupService.initiateBackup.mockResolvedValue({id: "backup-1"});
            mockBackupRepository.findByIdOrThrow.mockResolvedValue({id: "backup-1", stackId: "stack-1", logLines: []});
            mockStackRepository.findByIdOrThrow.mockResolvedValue(stackRecord);
            mockBackupService.getBackupRepoConfig.mockResolvedValue(repoConfig);

            scheduler.upsert("stack-1", "0 2 * * *");
            fireCronCallback();

            await vi.waitFor(() => {
                expect(mockBackupService.runBackup).toHaveBeenCalled();
            });

            const [backupRecordArg, stackArg, repoConfigArg] = mockBackupService.runBackup.mock.calls[0]!;
            expect(backupRecordArg).toBeDefined();
            expect(stackArg).toBeDefined();
            expect(repoConfigArg).toBeDefined();
            expect(mockBackupService.abortBackup).not.toHaveBeenCalled();
        });

        it("calls abortBackup and does not call runBackup when getBackupRepoConfig() resolves null", async () => {
            mockBackupService.initiateBackup.mockResolvedValue({id: "backup-1"});
            mockBackupRepository.findByIdOrThrow.mockResolvedValue({id: "backup-1", stackId: "stack-1", logLines: []});
            mockStackRepository.findByIdOrThrow.mockResolvedValue(stackRecord);
            mockBackupService.getBackupRepoConfig.mockResolvedValue(null);

            scheduler.upsert("stack-1", "0 2 * * *");
            fireCronCallback();

            await vi.waitFor(() => {
                expect(mockBackupService.abortBackup).toHaveBeenCalled();
            });

            expect(mockBackupService.runBackup).not.toHaveBeenCalled();
            expect(mockBackupService.abortBackup).toHaveBeenCalledWith("backup-1", "stack-1", expect.any(String));
        });

        it("calls abortBackup and lets no rejection escape the cron callback when the backup-record lookup rejects", async () => {
            mockBackupService.initiateBackup.mockResolvedValue({id: "backup-1"});
            mockBackupRepository.findByIdOrThrow.mockRejectedValue(new Error("db unavailable"));
            mockStackRepository.findByIdOrThrow.mockResolvedValue(stackRecord);
            mockBackupService.getBackupRepoConfig.mockResolvedValue(repoConfig);

            scheduler.upsert("stack-1", "0 2 * * *");

            expect(() => fireCronCallback()).not.toThrow();

            await vi.waitFor(() => {
                expect(mockBackupService.abortBackup).toHaveBeenCalled();
            });

            expect(mockBackupService.abortBackup).toHaveBeenCalledWith(
                "backup-1",
                "stack-1",
                expect.stringContaining("db unavailable"),
            );
        });
    });
});
