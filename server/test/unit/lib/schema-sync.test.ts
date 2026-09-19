import {describe, expect, it, vi} from "vitest";
import {syncDatabaseSchema} from "../../../src/lib/schema-sync.js";
import type {AcquireLockFn, LockAcquisitionResult, QueryFn, RunCliFn} from "../../../src/lib/schema-sync.js";

/**
 * Builds a query() double that answers the two information_schema probes
 * `needsBaseline()`/`hasApplicationTables()` issue, keyed off a distinctive
 * substring in the SQL text rather than call order — mirrors how the real
 * queries are written (see schema-sync.ts) without coupling the test to
 * their exact wording.
 */
function makeQuery(options: {hasHistory: boolean; hasApplicationTables: boolean}): QueryFn {
    return vi.fn(async (sql: string) => {
        if (sql.includes("has_history")) {
            return {rows: [{has_history: options.hasHistory}]};
        }
        if (sql.includes("has_application_tables")) {
            return {rows: [{has_application_tables: options.hasApplicationTables}]};
        }
        return {rows: []};
    });
}

function acquiredLock(
    release: () => Promise<void> = vi.fn(),
    query: QueryFn = makeQuery({hasHistory: true, hasApplicationTables: true}),
): AcquireLockFn {
    return vi.fn(async (): Promise<LockAcquisitionResult> => ({status: "acquired", release, query}));
}

describe("syncDatabaseSchema", () => {
    describe("opt-out guard", () => {
        it("returns skipped and spawns no child process when DOCKTOR_DB_AUTO_MIGRATE is exactly \"false\"", async () => {
            const prevMigrate = process.env.DOCKTOR_DB_AUTO_MIGRATE;
            const prevPush = process.env.DOCKTOR_DB_AUTO_PUSH;
            process.env.DOCKTOR_DB_AUTO_MIGRATE = "false";
            delete process.env.DOCKTOR_DB_AUTO_PUSH;
            try {
                const runCli = vi.fn<RunCliFn>();
                const acquireLock = vi.fn<AcquireLockFn>();

                const result = await syncDatabaseSchema({runCli, acquireLock});

                expect(result.outcome).toBe("skipped");
                expect(runCli).not.toHaveBeenCalled();
                expect(acquireLock).not.toHaveBeenCalled();
            } finally {
                if (prevMigrate === undefined) delete process.env.DOCKTOR_DB_AUTO_MIGRATE;
                else process.env.DOCKTOR_DB_AUTO_MIGRATE = prevMigrate;
                if (prevPush === undefined) delete process.env.DOCKTOR_DB_AUTO_PUSH;
                else process.env.DOCKTOR_DB_AUTO_PUSH = prevPush;
            }
        });

        it("honours the deprecated DOCKTOR_DB_AUTO_PUSH=false alias when DOCKTOR_DB_AUTO_MIGRATE is unset, spawning nothing", async () => {
            const prevMigrate = process.env.DOCKTOR_DB_AUTO_MIGRATE;
            const prevPush = process.env.DOCKTOR_DB_AUTO_PUSH;
            delete process.env.DOCKTOR_DB_AUTO_MIGRATE;
            process.env.DOCKTOR_DB_AUTO_PUSH = "false";
            try {
                const runCli = vi.fn<RunCliFn>();
                const acquireLock = vi.fn<AcquireLockFn>();
                const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

                const result = await syncDatabaseSchema({runCli, acquireLock});

                expect(result.outcome).toBe("skipped");
                expect(runCli).not.toHaveBeenCalled();
                expect(acquireLock).not.toHaveBeenCalled();
                const loggedText = warnSpy.mock.calls.map((call) => call.join(" ")).join("\n");
                expect(loggedText).toContain("DOCKTOR_DB_AUTO_MIGRATE");
                expect(loggedText).toContain("DOCKTOR_DB_AUTO_PUSH");

                warnSpy.mockRestore();
            } finally {
                if (prevMigrate === undefined) delete process.env.DOCKTOR_DB_AUTO_MIGRATE;
                else process.env.DOCKTOR_DB_AUTO_MIGRATE = prevMigrate;
                if (prevPush === undefined) delete process.env.DOCKTOR_DB_AUTO_PUSH;
                else process.env.DOCKTOR_DB_AUTO_PUSH = prevPush;
            }
        });

        it("does NOT skip when DOCKTOR_DB_AUTO_MIGRATE=true overrides a deprecated DOCKTOR_DB_AUTO_PUSH=false", async () => {
            const prevMigrate = process.env.DOCKTOR_DB_AUTO_MIGRATE;
            const prevPush = process.env.DOCKTOR_DB_AUTO_PUSH;
            process.env.DOCKTOR_DB_AUTO_MIGRATE = "true";
            process.env.DOCKTOR_DB_AUTO_PUSH = "false";
            try {
                const release = vi.fn(async () => {});
                const acquireLock = acquiredLock(release, makeQuery({hasHistory: true, hasApplicationTables: true}));
                const runCli = vi.fn<RunCliFn>(async () => ({code: 0, stdout: "No pending migrations to apply.", stderr: ""}));

                const result = await syncDatabaseSchema({runCli, acquireLock});

                expect(result.outcome).not.toBe("skipped");
                expect(acquireLock).toHaveBeenCalled();
                expect(runCli).toHaveBeenCalled();
            } finally {
                if (prevMigrate === undefined) delete process.env.DOCKTOR_DB_AUTO_MIGRATE;
                else process.env.DOCKTOR_DB_AUTO_MIGRATE = prevMigrate;
                if (prevPush === undefined) delete process.env.DOCKTOR_DB_AUTO_PUSH;
                else process.env.DOCKTOR_DB_AUTO_PUSH = prevPush;
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

    describe("baseline detection (D-05)", () => {
        it("applies cold with no resolve invocation on a genuinely fresh database (no history, no application tables)", async () => {
            const release = vi.fn(async () => {});
            const query = makeQuery({hasHistory: false, hasApplicationTables: false});
            const acquireLock = acquiredLock(release, query);
            const calls: string[][] = [];
            const runCli = vi.fn<RunCliFn>(async (argv) => {
                calls.push(argv);
                return {code: 0, stdout: "Applied 1 migration.", stderr: ""};
            });

            const result = await syncDatabaseSchema({runCli, acquireLock});

            expect(result.outcome).toBe("applied");
            expect(runCli).toHaveBeenCalledTimes(1);
            expect(calls[0]).toContain("deploy");
            expect(calls.some((argv) => argv.includes("resolve"))).toBe(false);
        });

        it("baselines before applying when no migration history exists but an application table is present", async () => {
            const release = vi.fn(async () => {});
            const query = makeQuery({hasHistory: false, hasApplicationTables: true});
            const acquireLock = acquiredLock(release, query);
            const calls: string[][] = [];
            const runCli = vi.fn<RunCliFn>(async (argv) => {
                calls.push(argv);
                if (argv.includes("resolve")) {
                    return {code: 0, stdout: "Migration 0_init marked as applied.", stderr: ""};
                }
                if (argv.includes("diff")) {
                    return {code: 0, stdout: "", stderr: ""};
                }
                return {code: 0, stdout: "Applied 1 migration.", stderr: ""};
            });

            const result = await syncDatabaseSchema({runCli, acquireLock});

            expect(result.outcome).toBe("applied");
            const resolveIndex = calls.findIndex((argv) => argv.includes("resolve"));
            const deployIndex = calls.findIndex((argv) => argv.includes("deploy"));
            expect(resolveIndex).toBeGreaterThanOrEqual(0);
            expect(deployIndex).toBeGreaterThan(resolveIndex);
            expect(calls[resolveIndex]).toContain("0_init");
            expect(calls[resolveIndex]).toContain("--applied");
            expect(result.detail).toContain("baselined");
            expect(result.detail).toContain("0_init");
        });

        it("does not baseline when a migration-history table already exists", async () => {
            const release = vi.fn(async () => {});
            const query = makeQuery({hasHistory: true, hasApplicationTables: true});
            const acquireLock = acquiredLock(release, query);
            const calls: string[][] = [];
            const runCli = vi.fn<RunCliFn>(async (argv) => {
                calls.push(argv);
                return {code: 0, stdout: "No pending migrations to apply.", stderr: ""};
            });

            const result = await syncDatabaseSchema({runCli, acquireLock});

            expect(result.outcome).toBe("already-current");
            expect(runCli).toHaveBeenCalledTimes(1);
            expect(calls.some((argv) => argv.includes("resolve"))).toBe(false);
        });
    });

    describe("drift probe (D-05 risk control)", () => {
        it("runs a drift probe after a baseline, logs a named console.error on divergence, and still resolves rather than throwing", async () => {
            const release = vi.fn(async () => {});
            const query = makeQuery({hasHistory: false, hasApplicationTables: true});
            const acquireLock = acquiredLock(release, query);
            const calls: string[][] = [];
            const runCli = vi.fn<RunCliFn>(async (argv) => {
                calls.push(argv);
                if (argv.includes("resolve")) {
                    return {code: 0, stdout: "Migration 0_init marked as applied.", stderr: ""};
                }
                if (argv.includes("diff")) {
                    return {code: 2, stdout: "diff detected", stderr: ""};
                }
                return {code: 0, stdout: "No pending migrations to apply.", stderr: ""};
            });
            const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

            const result = await syncDatabaseSchema({runCli, acquireLock});

            expect(calls.some((argv) => argv.includes("diff"))).toBe(true);
            const loggedText = errorSpy.mock.calls.map((call) => call.join(" ")).join("\n");
            expect(loggedText).toContain("[schema-sync]");
            expect(loggedText.toLowerCase()).toContain("diverge");
            expect(result.outcome).not.toBeUndefined();

            errorSpy.mockRestore();
        });

        it("does not run a drift probe when no baseline occurred", async () => {
            const release = vi.fn(async () => {});
            const query = makeQuery({hasHistory: true, hasApplicationTables: true});
            const acquireLock = acquiredLock(release, query);
            const calls: string[][] = [];
            const runCli = vi.fn<RunCliFn>(async (argv) => {
                calls.push(argv);
                return {code: 0, stdout: "No pending migrations to apply.", stderr: ""};
            });

            await syncDatabaseSchema({runCli, acquireLock});

            expect(calls.some((argv) => argv.includes("diff"))).toBe(false);
        });
    });

    describe("apply path", () => {
        it("spawns the Prisma CLI and returns applied when the schema is absent", async () => {
            const release = vi.fn(async () => {});
            const acquireLock = acquiredLock(release);
            const runCli = vi.fn<RunCliFn>(async () => ({
                code: 0,
                stdout: "Applied 1 migration.",
                stderr: "",
            }));

            const result = await syncDatabaseSchema({runCli, acquireLock});

            expect(result.outcome).toBe("applied");
            expect(runCli).toHaveBeenCalledTimes(1);
            expect(release).toHaveBeenCalledTimes(1);
        });

        it("returns already-current derived from the CLI's own no-pending-migrations output", async () => {
            const release = vi.fn(async () => {});
            const acquireLock = acquiredLock(release);
            const runCli = vi.fn<RunCliFn>(async () => ({
                code: 0,
                stdout: "No pending migrations to apply.",
                stderr: "",
            }));

            const result = await syncDatabaseSchema({runCli, acquireLock});

            expect(result.outcome).toBe("already-current");
            expect(release).toHaveBeenCalledTimes(1);
        });

        it("classifies the plural no-op wording the same way as the singular form", async () => {
            const release = vi.fn(async () => {});
            const acquireLock = acquiredLock(release);
            const runCli = vi.fn<RunCliFn>(async () => ({
                code: 0,
                stdout: "No pending migrations found.",
                stderr: "",
            }));

            const result = await syncDatabaseSchema({runCli, acquireLock});

            expect(result.outcome).toBe("already-current");
        });
    });

    describe("CLI failure path", () => {
        it("returns failed carrying the child's stderr and does not throw when the CLI exits non-zero", async () => {
            const release = vi.fn(async () => {});
            const acquireLock = acquiredLock(release);
            const runCli = vi.fn<RunCliFn>(async () => ({
                code: 1,
                stdout: "",
                stderr: "Error: migration failed to apply",
            }));

            const result = await syncDatabaseSchema({runCli, acquireLock});

            expect(result.outcome).toBe("failed");
            expect(result.detail).toContain("migration failed");
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
        it("passes an argv containing migrate/deploy and --config, and never a push, data-loss, or reset flag", async () => {
            const release = vi.fn(async () => {});
            const acquireLock = acquiredLock(release);
            let capturedArgv: string[] = [];
            const runCli = vi.fn<RunCliFn>(async (argv) => {
                capturedArgv = argv;
                return {code: 0, stdout: "No pending migrations to apply.", stderr: ""};
            });

            await syncDatabaseSchema({runCli, acquireLock});

            expect(capturedArgv).toContain("migrate");
            expect(capturedArgv).toContain("deploy");
            expect(capturedArgv.some((arg) => arg.startsWith("--config="))).toBe(true);
            expect(capturedArgv).not.toContain("push");
            expect(capturedArgv).not.toContain("--accept-data-loss");
            expect(capturedArgv).not.toContain("--force-reset");
            expect(capturedArgv.some((arg) => arg.includes("accept-data-loss"))).toBe(false);
            expect(capturedArgv.some((arg) => arg.includes("force-reset"))).toBe(false);
            expect(capturedArgv.some((arg) => arg.includes("reset"))).toBe(false);
        });

        it("never passes --skip-generate — this Prisma version's `migrate deploy` has no such flag", async () => {
            const release = vi.fn(async () => {});
            const acquireLock = acquiredLock(release);
            let capturedArgv: string[] = [];
            const runCli = vi.fn<RunCliFn>(async (argv) => {
                capturedArgv = argv;
                return {code: 0, stdout: "No pending migrations to apply.", stderr: ""};
            });

            await syncDatabaseSchema({runCli, acquireLock});

            expect(capturedArgv).not.toContain("--skip-generate");
        });
    });
});
