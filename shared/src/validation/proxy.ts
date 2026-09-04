import {z} from "zod";

// RFC-1123-style hostname pattern: labels of 1-63 alphanumerics/hyphens (no
// leading/trailing hyphen), at least one dot-separated segment. This is the
// domain-injection mitigation for threat T-06-02 — it is the security
// boundary between an untrusted request body and a value written into a
// service's compose `environment` block, so it lives here where both the
// client form and the server route share one definition.
export const hostnamePattern = /^(?!-)[A-Za-z0-9-]{1,63}(?<!-)(\.(?!-)[A-Za-z0-9-]{1,63}(?<!-))+$/;

export const assignDomainSchema = z.object({
    domain: z.string().min(1).regex(hostnamePattern, "Must be a valid hostname").toLowerCase(),
    internalPort: z.coerce.number().int().min(1).max(65535),
    tlsEnabled: z.boolean().default(true),
});
export type AssignDomainInput = z.infer<typeof assignDomainSchema>;

export const proxySettingsSchema = z.object({
    acmeEmail: z.string().email().or(z.literal("")).optional(),
    showInDashboard: z.boolean().optional(),
});
export type ProxySettingsInput = z.infer<typeof proxySettingsSchema>;

export const certStatusSchema = z.enum(["pending", "issued", "failed"]);
export type CertStatus = z.infer<typeof certStatusSchema>;
