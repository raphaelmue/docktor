import {z} from "zod";
import {backupSettingsSchema} from "./backups.js";

// Helper function from settings.ts for timezone validation
function isValidIANATimezone(tz: string): boolean {
    if (Intl.supportedValuesOf("timeZone").includes(tz)) {
        return true;
    }
    // Some environments (e.g. Node.js with limited ICU data) omit "UTC" from
    // supportedValuesOf but Intl.DateTimeFormat still accepts it as valid.
    try {
        Intl.DateTimeFormat(undefined, {timeZone: tz});
        return true;
    } catch {
        return false;
    }
}

// Step 1: Account creation
export const wizardStep1Schema = z.object({
    email: z.string().email("Valid email required"),
    password: z.string().min(8, "Password must be at least 8 characters"),
});

export type WizardStep1Input = z.infer<typeof wizardStep1Schema>;

// Step 2: Instance settings
export const wizardStep2Schema = z.object({
    instanceName: z.string().min(1, "Instance name is required"),
    baseUrl: z.string().url("Must be a valid URL").or(z.literal("")),
    timezone: z.string().refine(
        isValidIANATimezone,
        {message: "Must be a valid IANA timezone (e.g. 'America/New_York')"}
    ),
});

export type WizardStep2Input = z.infer<typeof wizardStep2Schema>;

// Step 3: Backup configuration (optional)
// Reuse existing backupSettingsSchema from backups.ts
export const wizardStep3Schema = backupSettingsSchema;

export type WizardStep3Input = z.infer<typeof wizardStep3Schema>;

// Step 4: SMTP notification settings (optional)
export const wizardStep4Schema = z.object({
    host: z.string().min(1, "SMTP host is required"),
    port: z.coerce.number().int().min(1).max(65535, "Port must be between 1 and 65535"),
    encryption: z.enum(["none", "starttls", "ssl"]),
    username: z.string().optional(),
    password: z.string().optional(),
    from: z.string().email("From address must be a valid email"),
});

export type WizardStep4Input = z.infer<typeof wizardStep4Schema>;

// Step 5: Brownfield scan directories (optional)
export const wizardStep5Schema = z.object({
    directories: z.array(z.string()).min(1, "At least one directory is required"),
});

export type WizardStep5Input = z.infer<typeof wizardStep5Schema>;

// Step 6: Proxy stack deployment (optional) — D-09 makes the ACME email
// explicitly non-blocking (empty string is valid), reusing proxySettingsSchema's
// email wording so the wizard and Settings cannot drift.
export const wizardStep6Schema = z.object({
    acmeEmail: z.string().email().or(z.literal("")).optional(),
});

export type WizardStep6Input = z.infer<typeof wizardStep6Schema>;
