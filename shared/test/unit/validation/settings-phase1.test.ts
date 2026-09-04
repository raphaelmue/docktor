import {describe, expect, it} from "vitest";
import {generalSettingsSchema} from "../../../src/validation/settings.js";

// generalSettingsSchema is not exported from settings.ts yet — this import
// will fail or the named export will be undefined, creating the RED state.
// Implementation will be added in Plan 04.

describe("generalSettingsSchema (SET-03)", () => {
    it("accepts valid instanceName, baseUrl (https URL), IANA timezone", () => {
        const result = generalSettingsSchema.safeParse({
            instanceName: "My Docktor",
            baseUrl: "https://docktor.example.com",
            timezone: "America/New_York",
        });
        expect(result.success).toBe(true);
    });

    it("rejects empty instanceName", () => {
        const result = generalSettingsSchema.safeParse({
            instanceName: "",
            baseUrl: "https://docktor.example.com",
            timezone: "UTC",
        });
        expect(result.success).toBe(false);
    });

    it("rejects non-URL baseUrl (plain string like 'notaurl')", () => {
        const result = generalSettingsSchema.safeParse({
            instanceName: "My Docktor",
            baseUrl: "notaurl",
            timezone: "UTC",
        });
        expect(result.success).toBe(false);
    });

    it("rejects non-IANA timezone string like 'Eastern Time'", () => {
        const result = generalSettingsSchema.safeParse({
            instanceName: "My Docktor",
            baseUrl: "https://docktor.example.com",
            timezone: "Eastern Time",
        });
        expect(result.success).toBe(false);
    });

    it("accepts valid IANA timezones: 'Europe/Paris', 'America/New_York', 'UTC'", () => {
        const validTimezones = ["Europe/Paris", "America/New_York", "UTC"];

        for (const timezone of validTimezones) {
            const result = generalSettingsSchema.safeParse({
                instanceName: "My Docktor",
                baseUrl: "https://docktor.example.com",
                timezone,
            });
            expect(result.success, `Expected ${timezone} to be valid`).toBe(true);
        }
    });
});
