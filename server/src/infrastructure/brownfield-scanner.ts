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
    private readonly COMPOSE_FILE_PATTERNS = [
        "**/docker-compose.yml",
        "**/docker-compose.yaml",
        "**/compose.yaml",
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

                foundFiles.push(...files);
            } catch (err: any) {
                if (err.code === "EACCES" || err.code === "EPERM" || err.code === "ENOENT") {
                    skippedCount++;
                    console.warn(`[BrownfieldScanner] Skipped directory: ${dir} (${err.code})`);
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
            } catch (err: any) {
                // Skip files that can't be read or parsed
                console.warn(`[BrownfieldScanner] Could not analyze ${filePath}: ${err.message}`);
            }
        }

        return {stacks, skippedDirectories: skippedCount};
    }
}

export const brownfieldScanner = new BrownfieldScanner();
