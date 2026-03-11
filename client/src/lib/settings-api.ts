import {apiFetch} from "./api";
import type {GeneralSettings, GeneralSettingsUpdate} from "@docktor/shared";

export type {GeneralSettings, GeneralSettingsUpdate};

export async function getGeneralSettings(): Promise<GeneralSettings> {
    return apiFetch<GeneralSettings>("/api/settings/general");
}

export async function updateGeneralSettings(data: GeneralSettingsUpdate): Promise<GeneralSettings> {
    return apiFetch<GeneralSettings>("/api/settings/general", {
        method: "PUT",
        body: JSON.stringify(data),
    });
}
