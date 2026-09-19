import {readFileSync} from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {describe, expect, it} from "vitest";
import {
    certCoversDomainPattern,
    certificateExpiry,
    parseCertificate,
    validateCertKeyPair,
} from "../../../src/domain/certificate-validation.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = path.resolve(__dirname, "../../fixtures/certs");

const leafCert = readFileSync(path.join(FIXTURES_DIR, "leaf.crt"), "utf-8");
const leafKey = readFileSync(path.join(FIXTURES_DIR, "leaf.key"), "utf-8");
const unrelatedKey = readFileSync(path.join(FIXTURES_DIR, "unrelated.key"), "utf-8");

// Every non-trivial line of fixture PEM content — used to assert rejection
// reasons never leak a substring of the key/certificate material (T-09-30).
const secretLines = [...leafCert.split("\n"), ...leafKey.split("\n"), ...unrelatedKey.split("\n")].filter(
    (line) => line.trim().length > 20,
);

describe("validateCertKeyPair", () => {
    it("validates a matching certificate and key pair", () => {
        const result = validateCertKeyPair(leafCert, leafKey);
        expect(result.valid).toBe(true);
    });

    it("rejects a certificate paired with a different key, naming the mismatch", () => {
        const result = validateCertKeyPair(leafCert, unrelatedKey);
        expect(result.valid).toBe(false);
        if (!result.valid) {
            expect(result.reason).toMatch(/private key.*(match|belong)/i);
        }
    });

    it("rejects text that is not a certificate, naming the failure", () => {
        const result = validateCertKeyPair("this is not a certificate", leafKey);
        expect(result.valid).toBe(false);
        if (!result.valid) {
            expect(result.reason).toMatch(/certificate/i);
        }
    });

    it("rejects text that is not a private key, naming the failure", () => {
        const result = validateCertKeyPair(leafCert, "this is not a private key");
        expect(result.valid).toBe(false);
        if (!result.valid) {
            expect(result.reason).toMatch(/key/i);
        }
    });

    it("never includes any substring of the key or certificate material in a rejection reason", () => {
        const results = [
            validateCertKeyPair(leafCert, unrelatedKey),
            validateCertKeyPair("this is not a certificate", leafKey),
            validateCertKeyPair(leafCert, "this is not a private key"),
        ];

        for (const result of results) {
            expect(result.valid).toBe(false);
            if (!result.valid) {
                expect(result.reason).not.toContain("BEGIN");
                for (const line of secretLines) {
                    expect(result.reason).not.toContain(line);
                }
            }
        }
    });
});

describe("certCoversDomainPattern", () => {
    it("reports coverage when the SAN includes the declared wildcard pattern", () => {
        const parsed = parseCertificate(leafCert);
        expect(parsed.ok).toBe(true);
        if (parsed.ok) {
            expect(certCoversDomainPattern(parsed.cert, "*.example.com")).toBe(true);
        }
    });

    it("reports no coverage when the SAN does not include the declared pattern", () => {
        const parsed = parseCertificate(leafCert);
        expect(parsed.ok).toBe(true);
        if (parsed.ok) {
            expect(certCoversDomainPattern(parsed.cert, "*.not-covered.test")).toBe(false);
        }
    });

    it("reports coverage for a concrete domain present in the SAN via host-matching semantics", () => {
        const parsed = parseCertificate(leafCert);
        expect(parsed.ok).toBe(true);
        if (parsed.ok) {
            expect(certCoversDomainPattern(parsed.cert, "example.com")).toBe(true);
        }
    });
});

describe("certificateExpiry", () => {
    it("returns a Date equal to the fixture certificate's not-after value", () => {
        const parsed = parseCertificate(leafCert);
        expect(parsed.ok).toBe(true);
        if (parsed.ok) {
            const expiry = certificateExpiry(parsed.cert);
            expect(expiry).toBeInstanceOf(Date);
            expect(expiry.getTime()).toBe(parsed.cert.validToDate.getTime());
        }
    });
});

describe("parseCertificate", () => {
    it("returns a typed failure (never throws) for malformed content", () => {
        expect(() => parseCertificate("not a certificate")).not.toThrow();
        const result = parseCertificate("not a certificate");
        expect(result.ok).toBe(false);
    });
});
