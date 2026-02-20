import {describe, expect, it} from "vitest";
import {updateSettingSchema} from "../../../src/validation/settings.js";

describe("updateSettingSchema", () => {
    it("accepts valid setting", () => {
        const result = updateSettingSchema.safeParse({
            key: "theme",
            value: "dark",
        });
        expect(result.success).toBe(true);
    });

    it("accepts optional encrypted flag", () => {
        const result = updateSettingSchema.safeParse({
            key: "api-key",
            value: "secret",
            encrypted: true,
        });
        expect(result.success).toBe(true);
        if (result.success) {
            expect(result.data.encrypted).toBe(true);
        }
    });

    it("rejects empty key", () => {
        const result = updateSettingSchema.safeParse({
            key: "",
            value: "dark",
        });
        expect(result.success).toBe(false);
    });

    it("rejects missing key", () => {
        const result = updateSettingSchema.safeParse({
            value: "dark",
        });
        expect(result.success).toBe(false);
    });

    it("rejects missing value", () => {
        const result = updateSettingSchema.safeParse({
            key: "theme",
        });
        expect(result.success).toBe(false);
    });

    it("accepts empty string as value", () => {
        const result = updateSettingSchema.safeParse({
            key: "theme",
            value: "",
        });
        expect(result.success).toBe(true);
    });
});
