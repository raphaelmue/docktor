import {describe, it, expect, vi, beforeEach} from "vitest";
import {BrownfieldScanner} from "../../../src/infrastructure/brownfield-scanner.js";
import type {ComposeAnalyzer} from "../../../src/infrastructure/compose-analyzer.js";

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
    } as unknown as ComposeAnalyzer;
}

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
    });
});
