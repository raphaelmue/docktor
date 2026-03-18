import {beforeEach, describe, expect, it, vi} from "vitest";

vi.mock("node:child_process");

import {spawn} from "node:child_process";
import {ResticExecutor} from "../../../src/infrastructure/restic-executor.js";

const mockSpawn = vi.mocked(spawn);

// Helper: create a mock child process that emits stdout data then closes
function createMockProcess(stdoutLines: string[], exitCode = 0, stderrOutput = "") {
    const stdoutEmitter = {on: vi.fn()} as any;
    const stderrEmitter = {on: vi.fn()} as any;
    const process = {
        stdout: stdoutEmitter,
        stderr: stderrEmitter,
        on: vi.fn(),
    } as any;

    process.stdout.on.mockImplementation((event: string, cb: (data: Buffer) => void) => {
        if (event === "data") {
            for (const line of stdoutLines) {
                cb(Buffer.from(line + "\n"));
            }
        }
    });

    process.stderr.on.mockImplementation((event: string, cb: (data: Buffer) => void) => {
        if (event === "data" && stderrOutput) {
            cb(Buffer.from(stderrOutput));
        }
    });

    process.on.mockImplementation((event: string, cb: (code: number) => void) => {
        if (event === "close") {
            cb(exitCode);
        }
    });

    return process;
}

describe("ResticExecutor", () => {
    let executor: ResticExecutor;

    beforeEach(() => {
        vi.clearAllMocks();
        executor = new ResticExecutor();
    });

    describe("run()", () => {
        it("spawns restic binary with provided args and env", async () => {
            const mockProc = createMockProcess(["output line"]);
            mockSpawn.mockReturnValue(mockProc);

            await executor.run(["backup", "/path/to/stack"], {RESTIC_REPOSITORY: "/repo"});

            expect(mockSpawn).toHaveBeenCalledWith(
                expect.stringContaining("restic"),
                ["backup", "/path/to/stack"],
                expect.objectContaining({env: expect.objectContaining({RESTIC_REPOSITORY: "/repo"})}),
            );
        });

        it("emits lines from stdout via onLine callback", async () => {
            const mockProc = createMockProcess(["line one", "line two"]);
            mockSpawn.mockReturnValue(mockProc);

            const lines: string[] = [];
            await executor.run(["backup"], {}, (line) => lines.push(line));

            expect(lines).toContain("line one");
            expect(lines).toContain("line two");
        });

        it("resolves with exit code and stderr on close", async () => {
            const mockProc = createMockProcess([], 0, "some stderr");
            mockSpawn.mockReturnValue(mockProc);

            const result = await executor.run(["backup"], {});

            expect(result).toMatchObject({
                exitCode: 0,
                stderr: "some stderr",
            });
        });

        it("rejects on spawn error event", async () => {
            const mockProc = {
                stdout: {on: vi.fn()},
                stderr: {on: vi.fn()},
                on: vi.fn(),
            } as any;

            mockProc.on.mockImplementation((event: string, cb: (err: Error) => void) => {
                if (event === "error") {
                    cb(new Error("spawn ENOENT"));
                }
            });

            mockSpawn.mockReturnValue(mockProc);

            await expect(executor.run(["backup"], {})).rejects.toThrow("spawn ENOENT");
        });

        it("flushes partial line buffer on close", async () => {
            // If last chunk has no trailing newline, it should still be emitted
            const mockProc = {
                stdout: {on: vi.fn()},
                stderr: {on: vi.fn()},
                on: vi.fn(),
            } as any;

            mockProc.stdout.on.mockImplementation((event: string, cb: (data: Buffer) => void) => {
                if (event === "data") {
                    cb(Buffer.from("partial line without newline"));
                }
            });

            mockProc.stderr.on.mockImplementation(vi.fn());

            mockProc.on.mockImplementation((event: string, cb: (code: number) => void) => {
                if (event === "close") {
                    cb(0);
                }
            });

            mockSpawn.mockReturnValue(mockProc);

            const lines: string[] = [];
            await executor.run(["backup"], {}, (line) => lines.push(line));

            expect(lines).toContain("partial line without newline");
        });
    });

    describe("backup args", () => {
        it("includes stack path as first positional arg", () => {
            const args = executor.buildBackupArgs("/stacks/myapp", "stack-abc");

            expect(args[0]).toBe("/stacks/myapp");
        });

        it("includes --exclude <stackPath>/logs", () => {
            const args = executor.buildBackupArgs("/stacks/myapp", "stack-abc");

            expect(args).toContain("--exclude");
            expect(args).toContain("/stacks/myapp/logs");
        });

        it("includes --tag <stackId>", () => {
            const args = executor.buildBackupArgs("/stacks/myapp", "stack-abc");

            expect(args).toContain("--tag");
            expect(args).toContain("stack-abc");
        });

        it("includes --json flag", () => {
            const args = executor.buildBackupArgs("/stacks/myapp", "stack-abc");

            expect(args).toContain("--json");
        });
    });

    describe("forget args", () => {
        it("builds --keep-daily N --keep-weekly N --keep-monthly N --prune flags", () => {
            const args = executor.buildForgetArgs("stack-abc", {keepDaily: 7, keepWeekly: 4, keepMonthly: 12});

            expect(args).toContain("--keep-daily");
            expect(args).toContain("7");
            expect(args).toContain("--keep-weekly");
            expect(args).toContain("4");
            expect(args).toContain("--keep-monthly");
            expect(args).toContain("12");
            expect(args).toContain("--prune");
        });

        it("includes --tag <stackId>", () => {
            const args = executor.buildForgetArgs("stack-abc", {keepDaily: 7, keepWeekly: 4, keepMonthly: 12});

            expect(args).toContain("--tag");
            expect(args).toContain("stack-abc");
        });
    });

    describe("snapshots()", () => {
        it("parses JSON output into ResticSnapshot array", async () => {
            const snapshots = [
                {id: "abc123", time: "2024-01-01T00:00:00Z", hostname: "host", tags: ["stack-1"]},
            ];
            const mockProc = createMockProcess([JSON.stringify(snapshots)]);
            mockSpawn.mockReturnValue(mockProc);

            const result = await executor.snapshots({RESTIC_REPOSITORY: "/repo"}, "stack-1");

            expect(result).toEqual(snapshots);
        });

        it("returns empty array when exit code is 10 (repo not found)", async () => {
            const mockProc = createMockProcess([], 10, "Fatal: unable to open repo");
            mockSpawn.mockReturnValue(mockProc);

            const result = await executor.snapshots({RESTIC_REPOSITORY: "/repo"}, "stack-1");

            expect(result).toEqual([]);
        });

        it("throws when exit code is non-zero and not 10", async () => {
            const mockProc = createMockProcess([], 1, "Fatal: something went wrong");
            mockSpawn.mockReturnValue(mockProc);

            await expect(executor.snapshots({RESTIC_REPOSITORY: "/repo"}, "stack-1")).rejects.toThrow();
        });
    });
});
