import {afterEach, describe, expect, it, vi} from "vitest";
import {
    assertStacksDirMatchesHost,
    ensureStacksDir,
    getComposePath,
    getEnvPath,
    getStackPath,
    getStacksDir,
} from "../../../src/lib/stacks-dir.js";
import {mkdir, mkdtemp, rm, stat, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";

describe("stacks-dir", () => {
    const tempRoots: string[] = [];

    afterEach(async () => {
        delete process.env.DOCKTOR_STACKS_DIR;
        delete process.env.DOCKTOR_STACKS_HOST_DIR;
        vi.restoreAllMocks();
        await Promise.all(
            tempRoots.splice(0).map((root) => rm(root, {recursive: true, force: true})),
        );
    });

    describe("getStacksDir", () => {
        it("returns default ./stacks when env not set", () => {
            delete process.env.DOCKTOR_STACKS_DIR;
            const result = getStacksDir();
            expect(result).toBe(path.resolve("./stacks"));
        });

        it("uses DOCKTOR_STACKS_DIR env variable", () => {
            process.env.DOCKTOR_STACKS_DIR = "/custom/stacks";
            const result = getStacksDir();
            expect(result).toBe(path.resolve("/custom/stacks"));
        });
    });

    describe("getStackPath", () => {
        it("joins stacks dir with stack id", () => {
            process.env.DOCKTOR_STACKS_DIR = "/stacks";
            const result = getStackPath("my-app");
            expect(result).toBe(path.join(path.resolve("/stacks"), "my-app"));
        });

        it("throws when the stack id resolves outside the stacks directory", () => {
            process.env.DOCKTOR_STACKS_DIR = "/stacks";
            expect(() => getStackPath("../evil")).toThrow(
                /outside the managed stacks directory/,
            );
        });

        it("throws when the stack id is a bare parent-traversal segment", () => {
            process.env.DOCKTOR_STACKS_DIR = "/stacks";
            expect(() => getStackPath("..")).toThrow(
                /outside the managed stacks directory/,
            );
        });
    });

    describe("getComposePath", () => {
        it("appends docker-compose.yml to stack path", () => {
            process.env.DOCKTOR_STACKS_DIR = "/stacks";
            const result = getComposePath("my-app");
            expect(result).toBe(path.join(path.resolve("/stacks"), "my-app", "docker-compose.yml"));
        });
    });

    describe("getEnvPath", () => {
        it("appends .env to stack path", () => {
            process.env.DOCKTOR_STACKS_DIR = "/stacks";
            const result = getEnvPath("my-app");
            expect(result).toBe(path.join(path.resolve("/stacks"), "my-app", ".env"));
        });
    });

    describe("assertStacksDirMatchesHost", () => {
        it("passes when host and container paths match exactly", () => {
            process.env.DOCKTOR_STACKS_DIR = "/opt/docktor/stacks";
            process.env.DOCKTOR_STACKS_HOST_DIR = "/opt/docktor/stacks";
            expect(() => assertStacksDirMatchesHost()).not.toThrow();
        });

        it("passes when the host path has a trailing slash", () => {
            process.env.DOCKTOR_STACKS_DIR = "/opt/docktor/stacks";
            process.env.DOCKTOR_STACKS_HOST_DIR = "/opt/docktor/stacks/";
            expect(() => assertStacksDirMatchesHost()).not.toThrow();
        });

        it("passes when the host path is non-normalised but resolves to the same directory", () => {
            process.env.DOCKTOR_STACKS_DIR = "/opt/docktor/stacks";
            process.env.DOCKTOR_STACKS_HOST_DIR = "/opt/docktor/foo/../stacks";
            expect(() => assertStacksDirMatchesHost()).not.toThrow();
        });

        it("throws mentioning both the host and container paths when they differ", () => {
            process.env.DOCKTOR_STACKS_DIR = "/opt/docktor/stacks";
            process.env.DOCKTOR_STACKS_HOST_DIR = "/opt/docktor/stacks-old";

            let thrown: Error | undefined;
            try {
                assertStacksDirMatchesHost();
            } catch (err) {
                thrown = err as Error;
            }

            expect(thrown).toBeInstanceOf(Error);
            expect(thrown?.message).toContain(path.resolve("/opt/docktor/stacks-old"));
            expect(thrown?.message).toContain(path.resolve("/opt/docktor/stacks"));
        });

        it("warns and returns without throwing when DOCKTOR_STACKS_HOST_DIR is unset", () => {
            delete process.env.DOCKTOR_STACKS_HOST_DIR;
            process.env.DOCKTOR_STACKS_DIR = "/opt/docktor/stacks";
            const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

            expect(() => assertStacksDirMatchesHost()).not.toThrow();
            expect(warnSpy).toHaveBeenCalledTimes(1);
            expect(warnSpy.mock.calls[0]?.[0]).toContain("DOCKTOR_STACKS_HOST_DIR");
        });
    });

    describe("ensureStacksDir", () => {
        it("creates the directory when it is absent, including missing intermediate segments", async () => {
            const root = await mkdtemp(path.join(tmpdir(), "stacks-dir-test-"));
            tempRoots.push(root);
            const target = path.join(root, "nested", "two-levels", "stacks");
            process.env.DOCKTOR_STACKS_DIR = target;

            const result = await ensureStacksDir();

            expect(result).toBe(path.resolve(target));
            const stats = await stat(target);
            expect(stats.isDirectory()).toBe(true);
        });

        it("leaves an existing directory intact and is a no-op on a second consecutive call", async () => {
            const root = await mkdtemp(path.join(tmpdir(), "stacks-dir-test-"));
            tempRoots.push(root);
            const target = path.join(root, "stacks");
            await mkdir(target);
            await writeFile(path.join(target, "marker.txt"), "keep-me");
            process.env.DOCKTOR_STACKS_DIR = target;

            await expect(ensureStacksDir()).resolves.toBe(path.resolve(target));
            await expect(ensureStacksDir()).resolves.toBe(path.resolve(target));

            const stats = await stat(path.join(target, "marker.txt"));
            expect(stats.isFile()).toBe(true);
        });

        it("returns the same absolute path getStacksDir() resolves for the same env value", async () => {
            const root = await mkdtemp(path.join(tmpdir(), "stacks-dir-test-"));
            tempRoots.push(root);
            const target = path.join(root, "stacks");
            process.env.DOCKTOR_STACKS_DIR = target;

            const result = await ensureStacksDir();

            expect(result).toBe(getStacksDir());
        });

        it("rethrows an error naming the path when creation is impossible", async () => {
            const root = await mkdtemp(path.join(tmpdir(), "stacks-dir-test-"));
            tempRoots.push(root);
            const blockingFile = path.join(root, "not-a-directory");
            await writeFile(blockingFile, "i am a file, not a directory");
            const target = path.join(blockingFile, "stacks");
            process.env.DOCKTOR_STACKS_DIR = target;

            await expect(ensureStacksDir()).rejects.toThrow(
                new RegExp(target.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
            );
        });
    });
});
