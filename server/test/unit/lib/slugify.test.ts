import {describe, expect, it} from "vitest";
import {slugify} from "../../../src/lib/slugify.js";

describe("slugify", () => {
    it("converts to lowercase", () => {
        expect(slugify("Hello World")).toBe("hello-world");
    });

    it("replaces spaces with hyphens", () => {
        expect(slugify("my stack name")).toBe("my-stack-name");
    });

    it("replaces underscores with hyphens", () => {
        expect(slugify("my_stack_name")).toBe("my-stack-name");
    });

    it("removes special characters", () => {
        expect(slugify("my app! @#$ v2")).toBe("my-app-v2");
    });

    it("collapses multiple hyphens", () => {
        expect(slugify("my---app")).toBe("my-app");
    });

    it("trims leading and trailing hyphens", () => {
        expect(slugify("--my-app--")).toBe("my-app");
        expect(slugify("!!!hello!!!")).toBe("hello");
    });

    it("truncates to 63 characters", () => {
        const long = "a".repeat(100);
        expect(slugify(long)).toHaveLength(63);
    });

    it("returns empty string for all-special-character input", () => {
        expect(slugify("!!!")).toBe("");
    });

    it("handles mixed spaces and underscores", () => {
        expect(slugify("my stack_name here")).toBe("my-stack-name-here");
    });

    it("handles already valid slugs", () => {
        expect(slugify("my-app")).toBe("my-app");
    });

    it("handles single character input", () => {
        expect(slugify("a")).toBe("a");
    });

    it("handles empty string", () => {
        expect(slugify("")).toBe("");
    });
});
