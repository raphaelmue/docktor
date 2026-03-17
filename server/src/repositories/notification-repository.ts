import {prisma} from "../lib/db.js"

export class NotificationRepository {
    async create(data: {
        type: "stack_error" | "stack_unhealthy" | "disk_warning"
        stackId?: string | null
        message: string
        emailSent: boolean
    }) {
        return prisma.notification.create({data})
    }

    async markEmailSent(id: string): Promise<void> {
        await prisma.notification.update({where: {id}, data: {emailSent: true}})
    }

    async findRecent(limit: number = 100) {
        return prisma.notification.findMany({
            orderBy: {createdAt: "desc"},
            take: limit,
            include: {stack: {select: {id: true, displayName: true}}},
        })
    }

    async findLastDiskAlert(): Promise<{active: boolean} | null> {
        // Disk alert state stored as Setting key "disk.alertActive"
        const setting = await prisma.setting.findUnique({where: {key: "disk.alertActive"}})
        if (!setting) return null
        return {active: setting.value === "true"}
    }

    async setDiskAlertActive(active: boolean): Promise<void> {
        await prisma.setting.upsert({
            where: {key: "disk.alertActive"},
            create: {key: "disk.alertActive", value: String(active)},
            update: {value: String(active)},
        })
    }
}

export const notificationRepository = new NotificationRepository()
