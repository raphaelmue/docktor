import {describe, expect, it} from "vitest";
import {
    assignDomainSchema,
    CERTIFICATE_EXPIRY_WARNING_DAYS,
    certSourceSchema,
    certStatusSchema,
    createCertificateSchema,
    domainPatternRegex,
    hostnamePattern,
} from "../../../src/validation/proxy.js";

describe("domainPatternRegex", () => {
    it("accepts a plain hostname", () => {
        expect(domainPatternRegex.test("example.com")).toBe(true);
    });

    it("accepts a multi-label hostname", () => {
        expect(domainPatternRegex.test("cloud.example.com")).toBe(true);
    });

    it("accepts a leading wildcard pattern", () => {
        expect(domainPatternRegex.test("*.example.com")).toBe(true);
    });

    it("rejects a bare asterisk", () => {
        expect(domainPatternRegex.test("*")).toBe(false);
    });

    it("rejects a dangling wildcard with no domain", () => {
        expect(domainPatternRegex.test("*.")).toBe(false);
    });

    it("rejects a single-label pattern with no dot after the wildcard label", () => {
        expect(domainPatternRegex.test("*.com")).toBe(false);
    });

    it("rejects a wildcard that is not in the leading position", () => {
        expect(domainPatternRegex.test("sub.*.example.com")).toBe(false);
    });

    it("rejects a double-wildcard leading label", () => {
        expect(domainPatternRegex.test("**.example.com")).toBe(false);
    });

    it("rejects a label starting with a hyphen", () => {
        expect(domainPatternRegex.test("-bad.example.com")).toBe(false);
    });

    it("rejects a path-traversal-shaped value", () => {
        expect(domainPatternRegex.test("example.com/../etc")).toBe(false);
    });
});

describe("assignDomainSchema — wildcard rejection on the routing field", () => {
    it("still rejects a wildcard domain — the routing hostname is never a wildcard", () => {
        const result = assignDomainSchema.safeParse({
            domain: "*.example.com",
            internalPort: 80,
        });
        expect(result.success).toBe(false);
    });
});

describe("createCertificateSchema", () => {
    it("accepts a wildcard domainPattern", () => {
        const result = createCertificateSchema.safeParse({domainPattern: "*.example.com"});
        expect(result.success).toBe(true);
    });

    it("lowercases mixed-case input", () => {
        const result = createCertificateSchema.safeParse({domainPattern: "*.Example.COM"});
        expect(result.success).toBe(true);
        if (result.success) {
            expect(result.data.domainPattern).toBe("*.example.com");
        }
    });
});

describe("certSourceSchema", () => {
    it("accepts acme", () => {
        expect(certSourceSchema.safeParse("acme").success).toBe(true);
    });

    it("accepts custom", () => {
        expect(certSourceSchema.safeParse("custom").success).toBe(true);
    });

    it("rejects anything else", () => {
        expect(certSourceSchema.safeParse("letsencrypt").success).toBe(false);
    });
});

describe("certStatusSchema", () => {
    it.each(["pending", "issued", "failed", "expiring"])("accepts %s", (value) => {
        expect(certStatusSchema.safeParse(value).success).toBe(true);
    });
});

describe("assignDomainSchema — certSource/certificateId pairing rules", () => {
    it("defaults certSource to acme when the field is absent", () => {
        const result = assignDomainSchema.safeParse({domain: "cloud.example.com", internalPort: 80});
        expect(result.success).toBe(true);
        if (result.success) {
            expect(result.data.certSource).toBe("acme");
        }
    });

    it("rejects custom with no certificateId", () => {
        const result = assignDomainSchema.safeParse({
            domain: "cloud.example.com",
            internalPort: 80,
            certSource: "custom",
        });
        expect(result.success).toBe(false);
    });

    it("rejects acme with a certificateId", () => {
        const result = assignDomainSchema.safeParse({
            domain: "cloud.example.com",
            internalPort: 80,
            certSource: "acme",
            certificateId: "cert-1",
        });
        expect(result.success).toBe(false);
    });

    it("rejects custom with tlsEnabled false — a custom certificate contradicts a TLS-disabled row", () => {
        const result = assignDomainSchema.safeParse({
            domain: "cloud.example.com",
            internalPort: 80,
            certSource: "custom",
            certificateId: "cert-1",
            tlsEnabled: false,
        });
        expect(result.success).toBe(false);
    });

    it("accepts custom with a certificateId and tlsEnabled true", () => {
        const result = assignDomainSchema.safeParse({
            domain: "cloud.example.com",
            internalPort: 80,
            certSource: "custom",
            certificateId: "cert-1",
            tlsEnabled: true,
        });
        expect(result.success).toBe(true);
    });
});

describe("hostnamePattern — unchanged by this plan", () => {
    it("still rejects a wildcard directly", () => {
        expect(hostnamePattern.test("*.example.com")).toBe(false);
    });
});

describe("CERTIFICATE_EXPIRY_WARNING_DAYS", () => {
    it("is a single shared source of truth for the server poller and client badge threshold", () => {
        // Both consumers import this literal directly rather than
        // redeclaring it (see 09-REVIEW.md IN-01) — this test just pins the
        // value itself so a change is a deliberate, reviewed edit.
        expect(CERTIFICATE_EXPIRY_WARNING_DAYS).toBe(30);
    });
});
