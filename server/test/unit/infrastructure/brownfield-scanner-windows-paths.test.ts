import {describe, it, expect, vi, beforeEach} from "vitest";

// G-05.1-4: fast-glob's `absolute: true` output is unconditionally
// "unixified" (backslashes -> forward slashes) on every platform, including
// Windows — that is fast-glob's documented, intentional design. Node's
// win32 `path.dirname()` does not renormalize separator style; it only
// slices at the last separator it finds, so it faithfully preserves
// whatever style it is handed. This file mocks `node:path` to the win32
// implementation for the whole module graph to reproduce that exact
// Windows-only failure on a Linux CI runner.
//
// This mock cannot coexist with brownfield-scanner.test.ts's POSIX
// expectations (vitest hoists vi.mock to file scope), so it lives in its
// own file. compose-analyzer.ts does not import node:path, so the mock's
// blast radius is the scanner module alone.
vi.mock("node:path", async () => {
    const actual = await vi.importActual<typeof import("node:path")>("node:path");
    return {
        default: actual.win32,
        ...actual.win32,
    };
});

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
    };
}

describe("BrownfieldScanner — Windows path separators (G-05.1-4)", () => {
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

    it("returns a backslash-separated directory even though fast-glob unixifies its absolute output", async () => {
        // fast-glob's EntryTransformer always emits forward slashes for
        // absolute paths, even when scanning a native Windows root.
        mockFg.mockResolvedValue(["C:/Users/D/AppData/Local/Temp/docktor-x/docker-compose.yml"]);

        const {BrownfieldScanner} = await import("../../../src/infrastructure/brownfield-scanner.js");
        const scanner = new BrownfieldScanner(
            mockAnalyzer as unknown as ConstructorParameters<typeof BrownfieldScanner>[0],
        );
        const result = await scanner.scan(["C:\\Users\\D\\AppData\\Local\\Temp\\docktor-x"]);

        expect(result.stacks).toHaveLength(1);
        expect(result.stacks[0].directory).toBe("C:\\Users\\D\\AppData\\Local\\Temp\\docktor-x");
    });

    it("returns a backslash-separated path for the compose file itself", async () => {
        mockFg.mockResolvedValue(["C:/Users/D/AppData/Local/Temp/docktor-x/docker-compose.yml"]);

        const {BrownfieldScanner} = await import("../../../src/infrastructure/brownfield-scanner.js");
        const scanner = new BrownfieldScanner(
            mockAnalyzer as unknown as ConstructorParameters<typeof BrownfieldScanner>[0],
        );
        const result = await scanner.scan(["C:\\Users\\D\\AppData\\Local\\Temp\\docktor-x"]);

        expect(result.stacks).toHaveLength(1);
        expect(result.stacks[0].path).toBe("C:\\Users\\D\\AppData\\Local\\Temp\\docktor-x\\docker-compose.yml");
    });

    it("never returns a forward slash in path or directory", async () => {
        mockFg.mockResolvedValue(["C:/Users/D/AppData/Local/Temp/docktor-x/docker-compose.yml"]);

        const {BrownfieldScanner} = await import("../../../src/infrastructure/brownfield-scanner.js");
        const scanner = new BrownfieldScanner(
            mockAnalyzer as unknown as ConstructorParameters<typeof BrownfieldScanner>[0],
        );
        const result = await scanner.scan(["C:\\Users\\D\\AppData\\Local\\Temp\\docktor-x"]);

        expect(result.stacks[0].path).not.toContain("/");
        expect(result.stacks[0].directory).not.toContain("/");
    });

    it("deduplicates two differently-spelled paths to the same file into exactly one stack", async () => {
        // Two overlapping scan roots surface the same underlying compose
        // file, but fast-glob's per-call unixify plus un-renormalized
        // dirname could previously yield two distinct spellings of it.
        // Normalizing at the boundary (before dedup) collapses them.
        mockFg
            .mockResolvedValueOnce(["C:/Users/D/Stacks/app/docker-compose.yml"])
            .mockResolvedValueOnce(["C:/Users/D/Stacks/app/docker-compose.yml"]);

        const {BrownfieldScanner} = await import("../../../src/infrastructure/brownfield-scanner.js");
        const scanner = new BrownfieldScanner(
            mockAnalyzer as unknown as ConstructorParameters<typeof BrownfieldScanner>[0],
        );
        const result = await scanner.scan(["C:\\Users\\D\\Stacks", "C:\\Users\\D\\Stacks\\app"]);

        expect(result.stacks).toHaveLength(1);
    });
});
