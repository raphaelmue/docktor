import {describe, expect, it} from "vitest";
import {createStackSchema, stackIdSchema, updateStackSchema} from "../../../src/validation/stacks.js";

describe("stackIdSchema", () => {
    it("accepts valid slug", () => {
        expect(stackIdSchema.safeParse("my-app").success).toBe(true);
    });

    it("accepts single character", () => {
        expect(stackIdSchema.safeParse("a").success).toBe(true);
    });

    it("accepts alphanumeric without hyphens", () => {
        expect(stackIdSchema.safeParse("myapp123").success).toBe(true);
    });

    it("rejects empty string", () => {
        expect(stackIdSchema.safeParse("").success).toBe(false);
    });

    it("rejects leading hyphen", () => {
        expect(stackIdSchema.safeParse("-my-app").success).toBe(false);
    });

    it("rejects trailing hyphen", () => {
        expect(stackIdSchema.safeParse("my-app-").success).toBe(false);
    });

    it("rejects uppercase", () => {
        expect(stackIdSchema.safeParse("MyApp").success).toBe(false);
    });

    it("rejects strings longer than 63 characters", () => {
        const long = "a" + "-b".repeat(32);
        expect(stackIdSchema.safeParse(long).success).toBe(false);
    });
});

describe("createStackSchema", () => {
    it("accepts valid input", () => {
        const result = createStackSchema.safeParse({
            displayName: "My App",
            composeContent: "services:\n  web:\n    image: nginx\n",
        });
        expect(result.success).toBe(true);
    });

    it("accepts optional description and envContent", () => {
        const result = createStackSchema.safeParse({
            displayName: "My App",
            composeContent: "services:\n  web:\n    image: nginx\n",
            description: "A test stack",
            envContent: "FOO=bar",
        });
        expect(result.success).toBe(true);
    });

    it("rejects empty displayName", () => {
        const result = createStackSchema.safeParse({
            displayName: "",
            composeContent: "services:",
        });
        expect(result.success).toBe(false);
    });

    it("rejects missing composeContent", () => {
        const result = createStackSchema.safeParse({
            displayName: "My App",
        });
        expect(result.success).toBe(false);
    });

    it("rejects empty composeContent", () => {
        const result = createStackSchema.safeParse({
            displayName: "My App",
            composeContent: "",
        });
        expect(result.success).toBe(false);
    });

    it("rejects displayName over 100 characters", () => {
        const result = createStackSchema.safeParse({
            displayName: "a".repeat(101),
            composeContent: "services:",
        });
        expect(result.success).toBe(false);
    });

    it("rejects description over 500 characters", () => {
        const result = createStackSchema.safeParse({
            displayName: "My App",
            composeContent: "services:",
            description: "a".repeat(501),
        });
        expect(result.success).toBe(false);
    });
});

describe("updateStackSchema", () => {
    it("accepts partial updates", () => {
        expect(updateStackSchema.safeParse({displayName: "New Name"}).success).toBe(true);
        expect(updateStackSchema.safeParse({description: "Updated"}).success).toBe(true);
        expect(updateStackSchema.safeParse({composeContent: "services:"}).success).toBe(true);
    });

    it("accepts empty object", () => {
        expect(updateStackSchema.safeParse({}).success).toBe(true);
    });

    it("rejects empty displayName when provided", () => {
        expect(updateStackSchema.safeParse({displayName: ""}).success).toBe(false);
    });

    it("rejects empty composeContent when provided", () => {
        expect(updateStackSchema.safeParse({composeContent: ""}).success).toBe(false);
    });
});
