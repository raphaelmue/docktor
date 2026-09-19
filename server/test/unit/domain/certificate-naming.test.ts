import {describe, expect, it} from "vitest";
import {certFileBaseName} from "../../../src/domain/certificate-naming.js";
import {BadRequestError} from "../../../src/lib/errors.js";

describe("certFileBaseName", () => {
    it("strips a leading wildcard label — parent-domain naming (nginx-proxy convention)", () => {
        expect(certFileBaseName("*.example.com")).toBe("example.com");
    });

    it("returns a non-wildcard subdomain unchanged", () => {
        expect(certFileBaseName("cloud.example.com")).toBe("cloud.example.com");
    });

    it("returns a bare domain unchanged", () => {
        expect(certFileBaseName("example.com")).toBe("example.com");
    });

    it.each([
        ["a forward slash", "example.com/etc"],
        ["a backslash", "example.com\\etc"],
        ["a dot-dot segment", "..example.com"],
        ["a leading separator", "/example.com"],
        ["a null byte", "example.com\0"],
    ])("throws BadRequestError for a value containing %s — defense in depth behind the shared regex", (_desc, value) => {
        expect(() => certFileBaseName(value)).toThrow(BadRequestError);
    });
});
