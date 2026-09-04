import fg from "fast-glob";
import fs from "node:fs/promises";
import path from "node:path";
import {
    ComposeAnalyzer,
    composeAnalyzer,
    type AnalysisResult,
    type CompatibilityLevel,
} from "./compose-analyzer.js";

export interface DiscoveredStack {
    path: string;
    directory: string;
    compatibility: CompatibilityLevel;
    serviceCount: number;
    namedVolumes: string[];
    absolutePaths: string[];
    inlineEnvVars: boolean;
    unsupportedFeatures: string[];
}

export interface ScanResult {
    stacks: DiscoveredStack[];
    skippedDirectories: number;
}

export class BrownfieldScanner {
    // WR-10: "compose.yml" (no docker- prefix) is a valid Compose file name
    // too — Docker Compose's own resolution order is compose.yaml ->
    // compose.yml -> docker-compose.yaml -> docker-compose.yml.
    private readonly COMPOSE_FILE_PATTERNS = [
        "**/docker-compose.yml",
        "**/docker-compose.yaml",
        "**/compose.yaml",
        "**/compose.yml",
    ];

    private readonly SYSTEM_DIR_EXCLUDES = [
        "**/proc/**",
        "**/sys/**",
        "**/dev/**",
        "**/node_modules/**",
        "**/.git/**",
    ];

    private readonly SYSTEM_DIRS = ["/proc", "/sys", "/dev"];

    constructor(private readonly analyzer: ComposeAnalyzer = composeAnalyzer) {}

    async scan(directories: string[]): Promise<ScanResult> {
        const foundFiles: string[] = [];
        let skippedCount = 0;

        // Filter out system directories
        const filteredDirs = directories.filter((dir) => {
            const normalized = path.normalize(dir);
            if (this.SYSTEM_DIRS.includes(normalized)) {
                console.warn(`[BrownfieldScanner] Skipping system directory: ${dir}`);
                skippedCount++;
                return false;
            }
            return true;
        });

        for (const dir of filteredDirs) {
            try {
                // Check read permission before scanning
                await fs.access(dir, fs.constants.R_OK);

                const files = await fg(this.COMPOSE_FILE_PATTERNS, {
                    cwd: dir,
                    absolute: true,
                    ignore: this.SYSTEM_DIR_EXCLUDES,
                    onlyFiles: true,
                    suppressErrors: true, // Don't throw on permission errors mid-scan
                });

                // G-05.1-4: fast-glob's `absolute: true` output is
                // unconditionally "unixified" (backslashes -> forward
                // slashes) on every platform by design — glob
                // patterns/results are POSIX-delimited by convention, not
                // configurable. Node's win32 path.dirname() does not
                // renormalize separator style; it only slices at the last
                // separator it finds, so it would otherwise pass that
                // forward-slash spelling straight through to `directory`
                // (and `path`, assigned verbatim below) even on a native
                // Windows host. Normalizing once here — before both fields
                // are derived, and before the Set-based dedup below — is
                // what keeps `path` and `directory` consistent with the
                // host OS from a single call site, and it also canonicalizes
                // the spelling so two overlapping scan roots that surface
                // different spellings of one file collapse to one stack.
                foundFiles.push(...files.map((f) => path.normalize(f)));
            } catch (err: unknown) {
                // Safe: fs.access/fast-glob only ever throw NodeJS.ErrnoException
                // (a standard Error subtype with a `code` field) on this path.
                const code = err instanceof Error ? (err as NodeJS.ErrnoException).code : undefined;
                if (code === "EACCES" || code === "EPERM" || code === "ENOENT") {
                    skippedCount++;
                    console.warn(`[BrownfieldScanner] Skipped directory: ${dir} (${code})`);
                } else {
                    throw err; // Re-throw unexpected errors
                }
            }
        }

        // Deduplicate (same file might be found from overlapping directory scans)
        const uniqueFiles = Array.from(new Set(foundFiles));

        // Parse each compose file and assess compatibility
        const stacks: DiscoveredStack[] = [];
        for (const filePath of uniqueFiles) {
            try {
                const content = await fs.readFile(filePath, "utf-8");
                const analysis = this.analyzer.analyzeCompatibility(content);

                stacks.push({
                    path: filePath,
                    directory: path.dirname(filePath),
                    compatibility: analysis.compatibility,
                    serviceCount: analysis.serviceCount,
                    namedVolumes: analysis.namedVolumes,
                    absolutePaths: analysis.bindMounts
                        .filter((m) => m.type === "absolute")
                        .map((m) => m.path),
                    inlineEnvVars: analysis.inlineEnvVars.length > 0,
                    unsupportedFeatures: analysis.unsupportedFeatures,
                });
            } catch (err: unknown) {
                // Skip files that can't be read or parsed
                const message = err instanceof Error ? err.message : String(err);
                console.warn(`[BrownfieldScanner] Could not analyze ${filePath}: ${message}`);
            }
        }

        return {stacks, skippedDirectories: skippedCount};
    }
}

export const brownfieldScanner = new BrownfieldScanner();
