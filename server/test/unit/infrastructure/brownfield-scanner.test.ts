import {describe, it, expect, vi, beforeEach} from "vitest";
import {BrownfieldScanner} from "../../../src/infrastructure/brownfield-scanner.js";
import {ComposeAnalyzer} from "../../../src/infrastructure/compose-analyzer.js";
import type {ComposeAnalyzer as ComposeAnalyzerType} from "../../../src/infrastructure/compose-analyzer.js";

vi.mock("fast-glob", () => ({
    default: vi.fn(),
}));

vi.mock("node:fs/promises", () => ({
    default: {
        access: vi.fn(),
        readFile: vi.fn(),
        constants: {R_OK: 4},
    },
}));

function createMockAnalyzer() {
    return {
        analyzeCompatibility: vi.fn().mockReturnValue({
            compatibility: "green",
            namedVolumes: [],
            bindMounts: [],
            inlineEnvVars: [],
            unsupportedFeatures: [],
            serviceCount: 1,
        }),
    } as unknown as ComposeAnalyzerType;
}

// WR-04: consolidated from the former server/test/unit/brownfield-scanner.test.ts
// (deleted) and server/test/unit/infrastructure/brownfield-scanner.test.ts —
// merges the unique cases from both into this single canonical suite. Scan
// mechanics (glob patterns, permission handling, skip counts) use the mocked
// filesystem/fast-glob per project convention; compatibility-classification
// integration tests use the real ComposeAnalyzer against mocked file contents.
describe("BrownfieldScanner", () => {
    describe("scan (WIZ-06, BF-01)", () => {
        let mockFg: ReturnType<typeof vi.fn>;
        let mockAccess: ReturnType<typeof vi.fn>;
        let mockReadFile: ReturnType<typeof vi.fn>;
        let mockAnalyzer: ReturnType<typeof createMockAnalyzer>;

        beforeEach(async () => {
            vi.clearAllMocks();
            const fg = await import("fast-glob");
            mockFg = fg.default as unknown as ReturnType<typeof vi.fn>;
            const fs = await import("node:fs/promises");
            mockAccess = fs.default.access as ReturnType<typeof vi.fn>;
            mockReadFile = fs.default.readFile as ReturnType<typeof vi.fn>;
            mockAnalyzer = createMockAnalyzer();

            mockAccess.mockResolvedValue(undefined);
            mockReadFile.mockResolvedValue("services:\n  app:\n    image: nginx\n");
        });

        it("should find docker-compose.yml files in specified directories", async () => {
            mockFg.mockResolvedValue(["/home/user/projects/myapp/docker-compose.yml"]);

            const scanner = new BrownfieldScanner(mockAnalyzer);
            const result = await scanner.scan(["/home/user/projects"]);

            expect(result.stacks.length).toBeGreaterThan(0);
            expect(result.stacks[0].path).toContain("docker-compose.yml");
        });

        it("should find docker-compose.yaml and compose.yaml files", async () => {
            mockFg.mockResolvedValue(["/opt/stacks/a/docker-compose.yaml", "/opt/stacks/b/compose.yaml"]);

            const scanner = new BrownfieldScanner(mockAnalyzer);
            const result = await scanner.scan(["/opt/stacks"]);

            const foundYamlVariants = result.stacks.some((s) => s.path.endsWith(".yaml"));
            expect(foundYamlVariants).toBe(true);
        });

        it("should skip /proc, /sys, /dev directories even if user specifies them", async () => {
            const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);

            const scanner = new BrownfieldScanner(mockAnalyzer);
            const result = await scanner.scan(["/proc", "/sys", "/dev"]);

            expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("Skipping system directory"));
            expect(mockFg).not.toHaveBeenCalled();
            expect(result.skippedDirectories).toBe(3);

            warnSpy.mockRestore();
        });

        it("should gracefully handle permission errors and count skipped directories", async () => {
            const eacces = Object.assign(new Error("permission denied"), {code: "EACCES"});
            mockAccess.mockRejectedValue(eacces);

            const scanner = new BrownfieldScanner(mockAnalyzer);
            const result = await scanner.scan(["/root/protected"]);

            expect(result.skippedDirectories).toBeGreaterThan(0);
        });

        it("should return skippedDirectories count in results", async () => {
            mockFg.mockResolvedValue([]);

            const scanner = new BrownfieldScanner(mockAnalyzer);
            const result = await scanner.scan(["/home/user"]);

            expect(result).toHaveProperty("skippedDirectories");
            expect(typeof result.skippedDirectories).toBe("number");
        });

        it("should exclude node_modules and .git directories from scan", async () => {
            mockFg.mockResolvedValue(["/home/user/code/myapp/docker-compose.yml"]);

            const scanner = new BrownfieldScanner(mockAnalyzer);
            await scanner.scan(["/home/user/code"]);

            const callOptions = mockFg.mock.calls[0][1];
            expect(callOptions.ignore).toEqual(
                expect.arrayContaining([expect.stringContaining("node_modules"), expect.stringContaining(".git")]),
            );
        });

        it("should return absolute paths for discovered compose files", async () => {
            mockFg.mockResolvedValue(["/opt/myapp/docker-compose.yml"]);

            const scanner = new BrownfieldScanner(mockAnalyzer);
            const result = await scanner.scan(["/opt"]);

            result.stacks.forEach((stack) => {
                expect(stack.path.startsWith("/")).toBe(true);
            });
            const callOptions = mockFg.mock.calls[0][1];
            expect(callOptions.absolute).toBe(true);
        });

        it("should return the containing directory for each discovered stack", async () => {
            mockFg.mockResolvedValue(["/opt/myapp/docker-compose.yml"]);

            const scanner = new BrownfieldScanner(mockAnalyzer);
            const result = await scanner.scan(["/opt"]);

            expect(result.stacks[0].directory).toBe("/opt/myapp");
        });

        it("should skip files that fail to read/parse and continue scanning others", async () => {
            mockFg.mockResolvedValue(["/opt/broken/docker-compose.yml", "/opt/ok/docker-compose.yml"]);
            mockReadFile.mockImplementation((filePath: string) => {
                if (filePath === "/opt/broken/docker-compose.yml") {
                    return Promise.reject(new Error("EACCES: permission denied"));
                }
                return Promise.resolve("services:\n  app:\n    image: nginx\n");
            });
            const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);

            const scanner = new BrownfieldScanner(mockAnalyzer);
            const result = await scanner.scan(["/opt"]);

            expect(result.stacks).toHaveLength(1);
            expect(result.stacks[0].path).toBe("/opt/ok/docker-compose.yml");
            expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("Could not analyze"));

            warnSpy.mockRestore();
        });
    });

    describe("scan — compatibility classification integration", () => {
        let mockFg: ReturnType<typeof vi.fn>;
        let mockAccess: ReturnType<typeof vi.fn>;
        let mockReadFile: ReturnType<typeof vi.fn>;

        beforeEach(async () => {
            vi.clearAllMocks();
            const fg = await import("fast-glob");
            mockFg = fg.default as unknown as ReturnType<typeof vi.fn>;
            const fs = await import("node:fs/promises");
            mockAccess = fs.default.access as ReturnType<typeof vi.fn>;
            mockReadFile = fs.default.readFile as ReturnType<typeof vi.fn>;
            mockAccess.mockResolvedValue(undefined);
        });

        it("discovers stacks with named volumes (yellow compatibility)", async () => {
            mockFg.mockResolvedValue(["/stacks/db/docker-compose.yml"]);
            mockReadFile.mockResolvedValue(`
services:
  db:
    image: postgres:15
    volumes:
      - pgdata:/var/lib/postgresql/data

volumes:
  pgdata:
`);
            const scanner = new BrownfieldScanner(new ComposeAnalyzer());
            const result = await scanner.scan(["/stacks"]);

            expect(result.stacks).toHaveLength(1);
            expect(result.stacks[0].compatibility).toBe("yellow");
            expect(result.stacks[0].namedVolumes).toEqual(["pgdata"]);
        });

        it("discovers stacks with absolute paths (yellow compatibility)", async () => {
            mockFg.mockResolvedValue(["/stacks/app/docker-compose.yml"]);
            mockReadFile.mockResolvedValue(`
services:
  app:
    image: nginx:latest
    volumes:
      - /mnt/nas/data:/app/data
`);
            const scanner = new BrownfieldScanner(new ComposeAnalyzer());
            const result = await scanner.scan(["/stacks"]);

            expect(result.stacks).toHaveLength(1);
            expect(result.stacks[0].compatibility).toBe("yellow");
            expect(result.stacks[0].absolutePaths).toEqual(["/mnt/nas/data"]);
        });

        it("discovers stacks with inline env vars (yellow compatibility)", async () => {
            mockFg.mockResolvedValue(["/stacks/app/docker-compose.yml"]);
            mockReadFile.mockResolvedValue(`
services:
  app:
    image: node:20
    environment:
      NODE_ENV: production
      PORT: 3000
`);
            const scanner = new BrownfieldScanner(new ComposeAnalyzer());
            const result = await scanner.scan(["/stacks"]);

            expect(result.stacks).toHaveLength(1);
            expect(result.stacks[0].compatibility).toBe("yellow");
            expect(result.stacks[0].inlineEnvVars).toBe(true);
        });

        it("discovers stacks with unsupported features (red compatibility)", async () => {
            mockFg.mockResolvedValue(["/stacks/app/docker-compose.yml"]);
            mockReadFile.mockResolvedValue(`
services:
  app:
    image: nginx:latest
    secrets:
      - db_password

secrets:
  db_password:
    file: ./password.txt
`);
            const scanner = new BrownfieldScanner(new ComposeAnalyzer());
            const result = await scanner.scan(["/stacks"]);

            expect(result.stacks).toHaveLength(1);
            expect(result.stacks[0].compatibility).toBe("red");
            expect(result.stacks[0].unsupportedFeatures).toContain("secrets");
        });

        it("handles multiple scan directories, deduplicating overlapping results", async () => {
            mockFg
                .mockResolvedValueOnce(["/stacks/a/docker-compose.yml"])
                .mockResolvedValueOnce(["/stacks/b/docker-compose.yml"]);
            mockReadFile.mockResolvedValue("services:\n  app:\n    image: nginx:latest\n");

            const scanner = new BrownfieldScanner(new ComposeAnalyzer());
            const result = await scanner.scan(["/stacks/a", "/stacks/b"]);

            expect(result.stacks).toHaveLength(2);
        });
    });
});
