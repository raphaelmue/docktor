import {describe, expect, it, afterEach, vi} from "vitest";
import {getStacksDir, getStackPath, getComposePath, getEnvPath} from "../../../src/lib/stacks-dir.js";
import path from "node:path";

describe("stacks-dir", () => {
    afterEach(() => {
        delete process.env.DOCKTOR_STACKS_DIR;
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
});
