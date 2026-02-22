import {describe, expect, it} from "vitest";
import {loginSchema, signupSchema} from "../../../src/validation/auth.js";

describe("loginSchema", () => {
    it("accepts valid credentials", () => {
        const result = loginSchema.safeParse({
            email: "user@example.com",
            password: "secret",
        });
        expect(result.success).toBe(true);
    });

    it("rejects invalid email", () => {
        const result = loginSchema.safeParse({
            email: "not-an-email",
            password: "secret",
        });
        expect(result.success).toBe(false);
    });

    it("rejects empty email", () => {
        const result = loginSchema.safeParse({
            email: "",
            password: "secret",
        });
        expect(result.success).toBe(false);
    });

    it("rejects empty password", () => {
        const result = loginSchema.safeParse({
            email: "user@example.com",
            password: "",
        });
        expect(result.success).toBe(false);
    });

    it("rejects missing fields", () => {
        const result = loginSchema.safeParse({});
        expect(result.success).toBe(false);
    });
});

describe("signupSchema", () => {
    it("accepts valid signup data", () => {
        const result = signupSchema.safeParse({
            name: "John",
            email: "john@example.com",
            password: "12345678",
        });
        expect(result.success).toBe(true);
    });

    it("rejects empty name", () => {
        const result = signupSchema.safeParse({
            name: "",
            email: "john@example.com",
            password: "12345678",
        });
        expect(result.success).toBe(false);
    });

    it("rejects short password", () => {
        const result = signupSchema.safeParse({
            name: "John",
            email: "john@example.com",
            password: "short",
        });
        expect(result.success).toBe(false);
    });

    it("accepts exactly 8 character password", () => {
        const result = signupSchema.safeParse({
            name: "John",
            email: "john@example.com",
            password: "12345678",
        });
        expect(result.success).toBe(true);
    });

    it("rejects invalid email", () => {
        const result = signupSchema.safeParse({
            name: "John",
            email: "invalid",
            password: "12345678",
        });
        expect(result.success).toBe(false);
    });
});
