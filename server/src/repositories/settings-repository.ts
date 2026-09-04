import {prisma} from "../lib/db.js"

export const SETTING_KEYS = {
    INSTANCE_NAME: "instanceName",
    BASE_URL: "baseUrl",
    TIMEZONE: "timezone",
} as const

export class SettingsRepository {
    async findByKey(key: string): Promise<{key: string; value: string} | null> {
        return prisma.setting.findUnique({where: {key}})
    }

    async upsert(key: string, value: string): Promise<void> {
        await prisma.setting.upsert({
            where: {key},
            create: {key, value},
            update: {value},
        })
    }

    async findAll(): Promise<{key: string; value: string}[]> {
        return prisma.setting.findMany()
    }

    // Convenience alias for plan interface compatibility
    async get(key: string): Promise<string | null> {
        const record = await this.findByKey(key)
        return record?.value ?? null
    }

    async getMany(keys: string[]): Promise<Record<string, string>> {
        const records = await prisma.setting.findMany({where: {key: {in: keys}}})
        return records.reduce(
            (acc: Record<string, string>, r: {key: string; value: string}) => {
                acc[r.key] = r.value
                return acc
            },
            {} as Record<string, string>,
        )
    }
}
