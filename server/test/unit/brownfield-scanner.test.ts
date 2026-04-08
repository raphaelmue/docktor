import {describe, it, expect, beforeEach, afterEach, vi} from "vitest";
import {BrownfieldScanner} from "../../src/infrastructure/brownfield-scanner.js";
import {ComposeAnalyzer} from "../../src/infrastructure/compose-analyzer.js";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

describe("BrownfieldScanner", () => {
    let testDir: string;
    let scanner: BrownfieldScanner;

    beforeEach(async () => {
        // Create temporary test directory
        testDir = path.join(os.tmpdir(), `brownfield-test-${Date.now()}`);
        await fs.mkdir(testDir, {recursive: true});
        scanner = new BrownfieldScanner();
    });

    afterEach(async () => {
        // Cleanup test directory
        await fs.rm(testDir, {recursive: true, force: true});
    });

    describe("scan", () => {
        it("finds docker-compose.yml files", async () => {
            const stackDir = path.join(testDir, "stack1");
            await fs.mkdir(stackDir, {recursive: true});
            await fs.writeFile(
                path.join(stackDir, "docker-compose.yml"),
                `
services:
  app:
    image: nginx:latest
    volumes:
      - ./data:/app/data
`
            );

            const result = await scanner.scan([testDir]);
            expect(result.stacks).toHaveLength(1);
            expect(result.stacks[0].path).toContain("docker-compose.yml");
            expect(result.stacks[0].compatibility).toBe("green");
            expect(result.stacks[0].serviceCount).toBe(1);
            expect(result.skippedDirectories).toBe(0);
        });

        it("finds docker-compose.yaml and compose.yaml files", async () => {
            const stack1 = path.join(testDir, "stack1");
            const stack2 = path.join(testDir, "stack2");
            await fs.mkdir(stack1, {recursive: true});
            await fs.mkdir(stack2, {recursive: true});

            await fs.writeFile(
                path.join(stack1, "docker-compose.yaml"),
                `services:\n  app:\n    image: nginx:latest`
            );
            await fs.writeFile(
                path.join(stack2, "compose.yaml"),
                `services:\n  db:\n    image: postgres:15`
            );

            const result = await scanner.scan([testDir]);
            expect(result.stacks).toHaveLength(2);
            expect(result.stacks.some(s => s.path.endsWith("docker-compose.yaml"))).toBe(true);
            expect(result.stacks.some(s => s.path.endsWith("compose.yaml"))).toBe(true);
        });

        it("excludes system directories (/proc, /sys, /dev)", async () => {
            const result = await scanner.scan(["/proc", "/sys", "/dev"]);
            expect(result.stacks).toEqual([]);
            expect(result.skippedDirectories).toBe(3);
        });

        it("gracefully handles permission denied errors", async () => {
            // Create directory with no read permissions
            const restrictedDir = path.join(testDir, "restricted");
            await fs.mkdir(restrictedDir, {recursive: true});

            // On Windows, permission manipulation is complex; mock fs.access instead
            const originalAccess = fs.access;
            vi.spyOn(fs, "access").mockImplementation(async (dirPath: any) => {
                if (dirPath === restrictedDir) {
                    const err: any = new Error("EACCES: permission denied");
                    err.code = "EACCES";
                    throw err;
                }
                return originalAccess(dirPath, fs.constants.R_OK);
            });

            const result = await scanner.scan([restrictedDir, testDir]);
            expect(result.skippedDirectories).toBeGreaterThanOrEqual(1);

            vi.restoreAllMocks();
        });

        it("discovers stacks with named volumes (yellow compatibility)", async () => {
            const stackDir = path.join(testDir, "stack-volumes");
            await fs.mkdir(stackDir, {recursive: true});
            await fs.writeFile(
                path.join(stackDir, "docker-compose.yml"),
                `
services:
  db:
    image: postgres:15
    volumes:
      - pgdata:/var/lib/postgresql/data

volumes:
  pgdata:
`
            );

            const result = await scanner.scan([testDir]);
            expect(result.stacks).toHaveLength(1);
            expect(result.stacks[0].compatibility).toBe("yellow");
            expect(result.stacks[0].namedVolumes).toEqual(["pgdata"]);
        });

        it("discovers stacks with absolute paths (yellow compatibility)", async () => {
            const stackDir = path.join(testDir, "stack-absolute");
            await fs.mkdir(stackDir, {recursive: true});
            await fs.writeFile(
                path.join(stackDir, "docker-compose.yml"),
                `
services:
  app:
    image: nginx:latest
    volumes:
      - /mnt/nas/data:/app/data
`
            );

            const result = await scanner.scan([testDir]);
            expect(result.stacks).toHaveLength(1);
            expect(result.stacks[0].compatibility).toBe("yellow");
            expect(result.stacks[0].absolutePaths).toEqual(["/mnt/nas/data"]);
        });

        it("discovers stacks with inline env vars (yellow compatibility)", async () => {
            const stackDir = path.join(testDir, "stack-env");
            await fs.mkdir(stackDir, {recursive: true});
            await fs.writeFile(
                path.join(stackDir, "docker-compose.yml"),
                `
services:
  app:
    image: node:20
    environment:
      NODE_ENV: production
      PORT: 3000
`
            );

            const result = await scanner.scan([testDir]);
            expect(result.stacks).toHaveLength(1);
            expect(result.stacks[0].compatibility).toBe("yellow");
            expect(result.stacks[0].inlineEnvVars).toBe(true);
        });

        it("discovers stacks with unsupported features (red compatibility)", async () => {
            const stackDir = path.join(testDir, "stack-unsupported");
            await fs.mkdir(stackDir, {recursive: true});
            await fs.writeFile(
                path.join(stackDir, "docker-compose.yml"),
                `
services:
  app:
    image: nginx:latest
    secrets:
      - db_password

secrets:
  db_password:
    file: ./password.txt
`
            );

            const result = await scanner.scan([testDir]);
            expect(result.stacks).toHaveLength(1);
            expect(result.stacks[0].compatibility).toBe("red");
            expect(result.stacks[0].unsupportedFeatures).toContain("secrets");
        });

        it("returns directory path for each discovered stack", async () => {
            const stackDir = path.join(testDir, "mystack");
            await fs.mkdir(stackDir, {recursive: true});
            await fs.writeFile(
                path.join(stackDir, "docker-compose.yml"),
                `services:\n  app:\n    image: nginx:latest`
            );

            const result = await scanner.scan([testDir]);
            expect(path.normalize(result.stacks[0].directory)).toBe(path.normalize(stackDir));
        });

        it("excludes node_modules and .git directories", async () => {
            const nodeModules = path.join(testDir, "node_modules", "package");
            const gitDir = path.join(testDir, ".git", "hooks");
            await fs.mkdir(nodeModules, {recursive: true});
            await fs.mkdir(gitDir, {recursive: true});

            await fs.writeFile(
                path.join(nodeModules, "docker-compose.yml"),
                `services:\n  app:\n    image: node:20`
            );
            await fs.writeFile(
                path.join(gitDir, "docker-compose.yml"),
                `services:\n  app:\n    image: nginx:latest`
            );

            const result = await scanner.scan([testDir]);
            expect(result.stacks).toEqual([]);
        });

        it("handles multiple scan directories", async () => {
            const dir1 = path.join(testDir, "dir1");
            const dir2 = path.join(testDir, "dir2");
            await fs.mkdir(dir1, {recursive: true});
            await fs.mkdir(dir2, {recursive: true});

            await fs.writeFile(
                path.join(dir1, "docker-compose.yml"),
                `services:\n  app:\n    image: nginx:latest`
            );
            await fs.writeFile(
                path.join(dir2, "docker-compose.yml"),
                `services:\n  db:\n    image: postgres:15`
            );

            const result = await scanner.scan([dir1, dir2]);
            expect(result.stacks).toHaveLength(2);
        });
    });
});
