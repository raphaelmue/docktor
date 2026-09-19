import {z} from "zod";

// RFC-1123-style hostname pattern: labels of 1-63 alphanumerics/hyphens (no
// leading/trailing hyphen), at least one dot-separated segment. This is the
// domain-injection mitigation for threat T-06-02 — it is the security
// boundary between an untrusted request body and a value written into a
// service's compose `environment` block, so it lives here where both the
// client form and the server route share one definition.
export const hostnamePattern = /^(?!-)[A-Za-z0-9-]{1,63}(?<!-)(\.(?!-)[A-Za-z0-9-]{1,63}(?<!-))+$/;

// Same hostname-label rules as hostnamePattern, plus one optional leading
// "*." wildcard label. This is Certificate.domainPattern's own boundary —
// it is a filesystem-path boundary as well as a formatting rule, because
// the value becomes the base name of a certificate file written under the
// proxy stack's certificates directory (see certFileBaseName() in plan
// 09-06), so its character set is validated before any path is derived
// from it. The wildcard is permitted only in the leading label and only
// once — "sub.*.example.com" and "**.example.com" are both rejected. This
// is intentionally NOT used for ProxyConfig.domain (that field keeps using
// hostnamePattern unmodified): a wildcard is never a routable virtual host.
export const domainPatternRegex =
    /^(?:\*\.)?(?!-)[A-Za-z0-9-]{1,63}(?<!-)(\.(?!-)[A-Za-z0-9-]{1,63}(?<!-))+$/;

export const certSourceSchema = z.enum(["acme", "custom"]);
export type CertSource = z.infer<typeof certSourceSchema>;

export const assignDomainSchema = z
    .object({
        domain: z.string().min(1).regex(hostnamePattern, "Must be a valid hostname").toLowerCase(),
        internalPort: z.coerce.number().int().min(1).max(65535),
        tlsEnabled: z.boolean().default(true),
        // D-11 promote decision: every row carries an explicit certificate
        // source, ACME rows included — see this plan's assumption-delta
        // block. Defaults to "acme" so existing callers that never mention
        // this field keep their current behavior unchanged.
        certSource: certSourceSchema.default("acme"),
        certificateId: z.string().optional(),
    })
    .superRefine((data, ctx) => {
        if (data.certSource === "custom" && !data.certificateId) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: "certificateId is required when certSource is custom",
                path: ["certificateId"],
            });
        }
        if (data.certSource === "acme" && data.certificateId) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: "certificateId must not be set when certSource is acme",
                path: ["certificateId"],
            });
        }
        if (data.certSource === "custom" && !data.tlsEnabled) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: "tlsEnabled must be true when certSource is custom",
                path: ["tlsEnabled"],
            });
        }
    });
export type AssignDomainInput = z.infer<typeof assignDomainSchema>;

export const proxySettingsSchema = z.object({
    acmeEmail: z.string().email().or(z.literal("")).optional(),
    showInDashboard: z.boolean().optional(),
});
export type ProxySettingsInput = z.infer<typeof proxySettingsSchema>;

// createCertificateSchema (D-10): the Certificate resource's own creation
// input. Only domainPattern is a JSON-body field — the certificate, private
// key, and optional CA chain arrive as multipart file parts (plan 09-06),
// and their PEM content is validated server-side via node:crypto, not by
// this schema.
export const createCertificateSchema = z.object({
    domainPattern: z
        .string()
        .min(1)
        .regex(domainPatternRegex, "Must be a valid hostname or wildcard pattern")
        .toLowerCase(),
});
export type CreateCertificateInput = z.infer<typeof createCertificateSchema>;

// D-13: "expiring" is the approaching-expiry state for certificates with no
// automatic renewal (custom certs have none, unlike ACME). This is the
// closed vocabulary shared by the database column, the live status event
// payload, the client hook, and the badge — all four must be kept in sync
// with this enum.
export const certStatusSchema = z.enum(["pending", "issued", "failed", "expiring"]);
export type CertStatus = z.infer<typeof certStatusSchema>;

// D-13: thirty days is the common industry default and enough runway for a
// human to obtain and upload a replacement certificate by hand — custom
// certificates have no automatic renewal, so silence here is a real outage
// waiting to happen. Shared so the server poller's classification and the
// client's "expiring soon" badge can never drift apart (previously
// duplicated as two independent literals — see 09-REVIEW.md IN-01).
export const CERTIFICATE_EXPIRY_WARNING_DAYS = 30;
