import {z} from "zod";

export const updateSettingSchema = z.object({
    key: z.string().min(1),
    value: z.string(),
    encrypted: z.boolean().optional(),
});

export type UpdateSettingInput = z.infer<typeof updateSettingSchema>;

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

export const generalSettingsSchema = z.object({
    instanceName: z.string().min(1, "Instance name is required"),
    baseUrl: z.string().url("Must be a valid URL").or(z.literal("")),
    timezone: z.string().refine(
        isValidIANATimezone,
        {message: "Must be a valid IANA timezone (e.g. 'America/New_York')"}
    ),
});

export const generalSettingsUpdateSchema = generalSettingsSchema.partial();

export type GeneralSettings = z.infer<typeof generalSettingsSchema>;
export type GeneralSettingsUpdate = z.infer<typeof generalSettingsUpdateSchema>;
