import {z} from "zod"
import {BadRequestError} from "../lib/errors.js"
import {decrypt} from "../lib/crypto.js"
import type {SettingsRepository} from "../repositories/settings-repository.js"
import type {SmtpConfig} from "./notification-service.js"

// Mirrors SETTING_KEYS from settings-repository — inlined to avoid loading db.ts at module level
const SETTING_KEYS = {
    INSTANCE_NAME: "instanceName",
    BASE_URL: "baseUrl",
    TIMEZONE: "timezone",
} as const

const PROXY_SETTING_KEYS = {
    ACME_EMAIL: "proxy.acmeEmail",
    SHOW_IN_DASHBOARD: "proxy.showInDashboard",
} as const

export interface GeneralSettings {
    instanceName: string
    baseUrl: string
    timezone: string
}

export interface ProxySettings {
    acmeEmail: string
    showInDashboard: boolean
}

const DEFAULTS: GeneralSettings = {
    instanceName: "Docktor",
    baseUrl: "",
    timezone: "UTC",
}

export class SettingsService {
    constructor(private readonly repo: SettingsRepository) {}

    async getSetting(key: string): Promise<string | null> {
        const record = await this.repo.findByKey(key)
        return record?.value ?? null
    }

    async getMany(keys: string[]): Promise<Record<string, string>> {
        return this.repo.getMany(keys)
    }

    async upsertSetting(key: string, value: string): Promise<void> {
        await this.repo.upsert(key, value)
    }

    async getSmtpConfig(): Promise<SmtpConfig | null> {
        const keys = [
            "smtp.host", "smtp.port", "smtp.encryption", "smtp.username",
            "smtp.password", "smtp.from",
        ]
        const values: Record<string, string> = {}
        for (const key of keys) {
            const val = await this.getSetting(key)
            if (val) values[key] = val
        }

        if (!values["smtp.host"] || !values["smtp.from"]) {
            return null
        }

        let password = values["smtp.password"] ?? ""
        if (password) {
            try {
                password = decrypt(password)
            } catch {
                console.error("[SettingsService] failed to decrypt SMTP password")
                return null
            }
        }

        const encryption = (values["smtp.encryption"] ?? "starttls") as SmtpConfig["encryption"]

        return {
            host: values["smtp.host"],
            port: Number(values["smtp.port"] ?? "587"),
            encryption,
            username: values["smtp.username"] ?? "",
            password,
            from: values["smtp.from"],
        }
    }

    async getGeneralSettings(): Promise<GeneralSettings> {
        const records = (await this.repo.findAll()) ?? []
        const map: Record<string, string> = {}
        for (const r of records) {
            map[r.key] = r.value
        }

        return {
            instanceName: map[SETTING_KEYS.INSTANCE_NAME] ?? DEFAULTS.instanceName,
            baseUrl: map[SETTING_KEYS.BASE_URL] ?? DEFAULTS.baseUrl,
            timezone: map[SETTING_KEYS.TIMEZONE] ?? DEFAULTS.timezone,
        }
    }

    async updateGeneralSettings(data: Partial<GeneralSettings>): Promise<GeneralSettings> {
        if (data.instanceName !== undefined) {
            if (!data.instanceName.trim()) {
                throw new BadRequestError("Instance name must not be empty")
            }
        }

        if (data.baseUrl !== undefined && data.baseUrl !== "") {
            const urlResult = z.string().url().safeParse(data.baseUrl)
            if (!urlResult.success) {
                throw new BadRequestError("Base URL must be a valid URL")
            }
        }

        if (data.timezone !== undefined) {
            const validTimezones = Intl.supportedValuesOf("timeZone")
            if (!validTimezones.includes(data.timezone)) {
                throw new BadRequestError(`Timezone "${data.timezone}" is not a valid IANA timezone`)
            }
        }

        const updates: Array<{key: string; value: string}> = []

        if (data.instanceName !== undefined) {
            updates.push({key: SETTING_KEYS.INSTANCE_NAME, value: data.instanceName})
        }
        if (data.baseUrl !== undefined) {
            updates.push({key: SETTING_KEYS.BASE_URL, value: data.baseUrl})
        }
        if (data.timezone !== undefined) {
            updates.push({key: SETTING_KEYS.TIMEZONE, value: data.timezone})
        }

        await Promise.all(updates.map(({key, value}) => this.repo.upsert(key, value)))

        // Fetch current settings and merge with updates
        const current = await this.getGeneralSettings()
        return {
            instanceName: data.instanceName ?? current.instanceName,
            baseUrl: data.baseUrl ?? current.baseUrl,
            timezone: data.timezone ?? current.timezone,
        }
    }

    /**
     * Reads only the two proxy.* keys — never falls back to smtp.from,
     * instanceName, baseUrl or any user record (T-06-18's mitigation: the
     * ACME registration email must be a value the user entered for that
     * purpose, never derived from another stored address).
     */
    async getProxySettings(): Promise<ProxySettings> {
        const values = await this.repo.getMany([
            PROXY_SETTING_KEYS.ACME_EMAIL,
            PROXY_SETTING_KEYS.SHOW_IN_DASHBOARD,
        ])
        return {
            acmeEmail: values[PROXY_SETTING_KEYS.ACME_EMAIL] ?? "",
            showInDashboard: values[PROXY_SETTING_KEYS.SHOW_IN_DASHBOARD] === "true",
        }
    }

    /**
     * Upserts only the keys present in the argument. An empty acmeEmail is
     * valid (D-09 — no registration email required); a non-empty value must
     * be a valid email address. No encryption — an ACME registration
     * address is not a secret.
     */
    async updateProxySettings(data: Partial<ProxySettings>): Promise<void> {
        if (data.acmeEmail !== undefined && data.acmeEmail !== "") {
            const emailResult = z.string().email().safeParse(data.acmeEmail)
            if (!emailResult.success) {
                throw new BadRequestError("ACME email must be a valid email address")
            }
        }

        const updates: Array<{key: string; value: string}> = []
        if (data.acmeEmail !== undefined) {
            updates.push({key: PROXY_SETTING_KEYS.ACME_EMAIL, value: data.acmeEmail})
        }
        if (data.showInDashboard !== undefined) {
            updates.push({key: PROXY_SETTING_KEYS.SHOW_IN_DASHBOARD, value: String(data.showInDashboard)})
        }

        await Promise.all(updates.map(({key, value}) => this.repo.upsert(key, value)))
    }
}
