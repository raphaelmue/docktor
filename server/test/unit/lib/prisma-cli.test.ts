import {execFile} from "node:child_process";
import {existsSync} from "node:fs";
import {createRequire} from "node:module";
import path from "node:path";
import {promisify} from "node:util";
import os from "node:os";
import {describe, expect, it} from "vitest";
import {resolvePrismaCliEntrypoint} from "../../../src/lib/prisma-cli.js";

const execFileAsync = promisify(execFile);
const moduleRequire = createRequire(import.meta.url);

describe("resolvePrismaCliEntrypoint", () => {
    it("returns an absolute path to a file that exists on disk", () => {
        const result = resolvePrismaCliEntrypoint();

        expect(path.isAbsolute(result)).toBe(true);
        expect(existsSync(result)).toBe(true);
    });

    it("matches the installed prisma package's own declared bin target", () => {
        const prismaPackageJsonPath = moduleRequire.resolve("prisma/package.json");
        const prismaPackageJson = moduleRequire(prismaPackageJsonPath) as {
            bin?: Record<string, string> | string;
        };
        const binTarget = typeof prismaPackageJson.bin === "string" ? prismaPackageJson.bin : prismaPackageJson.bin?.prisma;
        expect(binTarget).toBeDefined();

        const expected = path.resolve(path.dirname(prismaPackageJsonPath), binTarget!);
        const result = resolvePrismaCliEntrypoint();

        expect(result).toBe(expected);
    });

    it(
        "can be executed directly via process.execPath and prints a prisma version",
        async () => {
            const entrypoint = resolvePrismaCliEntrypoint();

            const {stdout} = await execFileAsync(process.execPath, [entrypoint, "--version"]);

            const firstLine = stdout.split("\n")[0]?.trim() ?? "";
            expect(firstLine.split(/\s+/)[0]?.toLowerCase()).toBe("prisma");
        },
        30_000,
    );

    it("resolves independently of process.cwd()", () => {
        const before = resolvePrismaCliEntrypoint();
        const originalCwd = process.cwd();

        try {
            process.chdir(os.tmpdir());
            const after = resolvePrismaCliEntrypoint();
            expect(after).toBe(before);
        } finally {
            process.chdir(originalCwd);
        }
    });
});
