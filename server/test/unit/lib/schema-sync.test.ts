import {describe, expect, it, vi} from "vitest";
import {syncDatabaseSchema} from "../../../src/lib/schema-sync.js";
import type {AcquireLockFn, LockAcquisitionResult, RunCliFn} from "../../../src/lib/schema-sync.js";

function acquiredLock(release: () => Promise<void> = vi.fn()): AcquireLockFn {
    return vi.fn(async (): Promise<LockAcquisitionResult> => ({status: "acquired", release}));
}

describe("syncDatabaseSchema", () => {
    describe("opt-out guard", () => {
        it("returns skipped and spawns no child process when DOCKTOR_DB_AUTO_PUSH is exactly \"false\"", async () => {
            const prevValue = process.env.DOCKTOR_DB_AUTO_PUSH;
            process.env.DOCKTOR_DB_AUTO_PUSH = "false";
            try {
                const runCli = vi.fn<RunCliFn>();
                const acquireLock = vi.fn<AcquireLockFn>();

                const result = await syncDatabaseSchema({runCli, acquireLock});

                expect(result.outcome).toBe("skipped");
                expect(runCli).not.toHaveBeenCalled();
                expect(acquireLock).not.toHaveBeenCalled();
            } finally {
                if (prevValue === undefined) delete process.env.DOCKTOR_DB_AUTO_PUSH;
                else process.env.DOCKTOR_DB_AUTO_PUSH = prevValue;
            }
        });
    });

    describe("reachability guard", () => {
        it("returns unreachable, logs the host/port, and does not throw when the database is unreachable for the whole retry budget", async () => {
            const runCli = vi.fn<RunCliFn>();
            const acquireLock = vi.fn<AcquireLockFn>(async (): Promise<LockAcquisitionResult> => ({
                status: "unreachable",
                host: "db.internal",
                port: "5432",
            }));
            const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

            const result = await syncDatabaseSchema({runCli, acquireLock});

            expect(result.outcome).toBe("unreachable");
            expect(runCli).not.toHaveBeenCalled();
            expect(errorSpy).toHaveBeenCalled();
            const loggedText = errorSpy.mock.calls.map((call) => call.join(" ")).join("\n");
            expect(loggedText).toContain("db.internal");
            expect(loggedText).toContain("5432");

            errorSpy.mockRestore();
        });
    });

    describe("concurrency guard", () => {
        it("returns lock-not-acquired and spawns no child process when the advisory lock is already held", async () => {
            const runCli = vi.fn<RunCliFn>();
            const acquireLock = vi.fn<AcquireLockFn>(async (): Promise<LockAcquisitionResult> => ({
                status: "not-acquired",
            }));

            const result = await syncDatabaseSchema({runCli, acquireLock});

            expect(result.outcome).toBe("lock-not-acquired");
            expect(runCli).not.toHaveBeenCalled();
        });
    });

    describe("apply path", () => {
        it("spawns the Prisma CLI and returns applied when the schema is absent", async () => {
            const release = vi.fn(async () => {});
            const acquireLock = acquiredLock(release);
            const runCli = vi.fn<RunCliFn>(async () => ({
                code: 0,
                stdout: "Your database is now in sync with your Prisma schema.",
                stderr: "",
            }));

            const result = await syncDatabaseSchema({runCli, acquireLock});

            expect(result.outcome).toBe("applied");
            expect(runCli).toHaveBeenCalledTimes(1);
            expect(release).toHaveBeenCalledTimes(1);
        });

        it("returns already-current derived from the CLI's own already-in-sync output", async () => {
            const release = vi.fn(async () => {});
            const acquireLock = acquiredLock(release);
            const runCli = vi.fn<RunCliFn>(async () => ({
                code: 0,
                stdout: "The database is already in sync with the Prisma schema.",
                stderr: "",
            }));

            const result = await syncDatabaseSchema({runCli, acquireLock});

            expect(result.outcome).toBe("already-current");
            expect(release).toHaveBeenCalledTimes(1);
        });
    });

    describe("CLI failure path", () => {
        it("returns failed carrying the child's stderr and does not throw when the CLI exits non-zero", async () => {
            const release = vi.fn(async () => {});
            const acquireLock = acquiredLock(release);
            const runCli = vi.fn<RunCliFn>(async () => ({
                code: 1,
                stdout: "",
                stderr: "Error: the migration would cause data loss",
            }));

            const result = await syncDatabaseSchema({runCli, acquireLock});

            expect(result.outcome).toBe("failed");
            expect(result.detail).toContain("data loss");
            expect(release).toHaveBeenCalledTimes(1);
        });
    });

    describe("lock release guarantee", () => {
        it("releases the lock even when the injected runner rejects", async () => {
            const release = vi.fn(async () => {});
            const acquireLock = acquiredLock(release);
            const runCli = vi.fn<RunCliFn>(async () => {
                throw new Error("spawn failed");
            });

            const result = await syncDatabaseSchema({runCli, acquireLock});

            expect(result.outcome).toBe("failed");
            expect(release).toHaveBeenCalledTimes(1);
        });
    });

    describe("argv safety", () => {
        it("passes an argv containing the push subcommand and --config, and never a data-loss or reset flag", async () => {
            const release = vi.fn(async () => {});
            const acquireLock = acquiredLock(release);
            let capturedArgv: string[] = [];
            const runCli = vi.fn<RunCliFn>(async (argv) => {
                capturedArgv = argv;
                return {code: 0, stdout: "in sync", stderr: ""};
            });

            await syncDatabaseSchema({runCli, acquireLock});

            expect(capturedArgv).toContain("db");
            expect(capturedArgv).toContain("push");
            expect(capturedArgv.some((arg) => arg.startsWith("--config="))).toBe(true);
            expect(capturedArgv).not.toContain("--accept-data-loss");
            expect(capturedArgv).not.toContain("--force-reset");
            expect(capturedArgv.some((arg) => arg.includes("accept-data-loss"))).toBe(false);
            expect(capturedArgv.some((arg) => arg.includes("force-reset"))).toBe(false);
            expect(capturedArgv.some((arg) => arg.includes("reset"))).toBe(false);
        });

        it("never passes --skip-generate — this Prisma version's `db push` rejects it outright as an unknown option, which previously made every push fail", async () => {
            const release = vi.fn(async () => {});
            const acquireLock = acquiredLock(release);
            let capturedArgv: string[] = [];
            const runCli = vi.fn<RunCliFn>(async (argv) => {
                capturedArgv = argv;
                return {code: 0, stdout: "in sync", stderr: ""};
            });

            await syncDatabaseSchema({runCli, acquireLock});

            expect(capturedArgv).not.toContain("--skip-generate");
        });
    });
});
