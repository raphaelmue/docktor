import {describe, expect, it} from "vitest";
import {createStackSchema, dockerTagSchema, stackIdSchema, updateStackSchema, upgradeServiceSchema} from "../../../src/validation/stacks.js";

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

describe("dockerTagSchema", () => {
    it("accepts a simple semver tag", () => {
        expect(dockerTagSchema.safeParse("1.26").success).toBe(true);
    });

    it("accepts letters, digits, underscore, period and hyphen", () => {
        expect(dockerTagSchema.safeParse("v1.2.3-alpine_3").success).toBe(true);
    });

    it("accepts a single character tag", () => {
        expect(dockerTagSchema.safeParse("a").success).toBe(true);
    });

    it("rejects an empty string", () => {
        expect(dockerTagSchema.safeParse("").success).toBe(false);
    });

    it("rejects a tag starting with a period or hyphen", () => {
        expect(dockerTagSchema.safeParse(".1.26").success).toBe(false);
        expect(dockerTagSchema.safeParse("-1.26").success).toBe(false);
    });

    it("rejects whitespace", () => {
        expect(dockerTagSchema.safeParse("1.26 latest").success).toBe(false);
    });

    it("rejects a slash — cannot smuggle a path segment", () => {
        expect(dockerTagSchema.safeParse("1.26/evil").success).toBe(false);
    });

    it("rejects YAML metacharacters that could break out of a scalar value", () => {
        expect(dockerTagSchema.safeParse('1.26"\nservices: {}').success).toBe(false);
        expect(dockerTagSchema.safeParse("1.26: evil").success).toBe(false);
    });

    it("rejects a tag over 128 characters", () => {
        expect(dockerTagSchema.safeParse("a".repeat(129)).success).toBe(false);
    });

    it("accepts a tag at exactly 128 characters", () => {
        expect(dockerTagSchema.safeParse("a".repeat(128)).success).toBe(true);
    });
});

describe("upgradeServiceSchema", () => {
    it("accepts a valid targetTag", () => {
        expect(upgradeServiceSchema.safeParse({targetTag: "1.26"}).success).toBe(true);
    });

    it("rejects a missing targetTag", () => {
        expect(upgradeServiceSchema.safeParse({}).success).toBe(false);
    });

    it("rejects an invalid targetTag", () => {
        expect(upgradeServiceSchema.safeParse({targetTag: "not a tag!"}).success).toBe(false);
    });
});
