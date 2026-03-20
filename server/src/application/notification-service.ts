import nodemailer from "nodemailer"
import {decrypt} from "../lib/crypto.js"
import {prisma} from "../lib/db.js"
import type {NotificationRepository} from "../repositories/notification-repository.js"
import type {StateBroadcaster} from "../lib/state-broadcaster.js"

export interface SmtpConfig {
    host: string
    port: number
    encryption: "none" | "starttls" | "ssl"
    username: string
    password: string
    from: string
}

export interface SmtpTestConfig extends SmtpConfig {
    recipient: string
}

export interface NotificationEvent {
    type: "stack_error" | "stack_unhealthy" | "disk_warning" | "backup_failure"
    stackId?: string | null
    subject: string
    message: string
}

export interface NotificationSettings {
    getSetting(key: string): Promise<string | null>
    getSmtpConfig(): Promise<SmtpConfig | null>
}

export class NotificationService {
    constructor(
        private readonly repo: NotificationRepository,
        private readonly settings: NotificationSettings,
        private readonly broadcaster: StateBroadcaster,
    ) {}

    async notify(event: NotificationEvent): Promise<void> {
        const toggleKey =
            event.type === "disk_warning"
                ? "notify.diskWarning"
                : event.type === "backup_failure"
                    ? "notify.backupFailure"
                    : "notify.stackError"
        const enabled = await this.settings.getSetting(toggleKey)
        if (enabled === "false") return

        const notification = await this.repo.create({
            type: event.type,
            stackId: event.stackId ?? null,
            message: event.message,
            emailSent: false,
        })

        // Broadcast notification creation event to all SSE clients
        this.broadcaster.publish({
            type: "notification_created",
            notificationId: notification.id,
        })

        const smtpConfig = await this.settings.getSmtpConfig()
        if (!smtpConfig) return

        const users = await prisma.user.findMany({select: {email: true}})
        if (users.length === 0) return

        try {
            const transport = this.createTransport(smtpConfig)
            await transport.sendMail({
                from: smtpConfig.from,
                to: users.map((u) => u.email).join(", "),
                subject: event.subject,
                text: event.message,
            })
            await this.repo.markEmailSent(notification.id)
        } catch (err) {
            console.error("[NotificationService] email send failed:", err)
        }
    }

    async testSmtp(config: SmtpTestConfig): Promise<void> {
        const transport = this.createTransport(config)
        await transport.sendMail({
            from: config.from,
            to: config.recipient,
            subject: "Docktor — SMTP test",
            text: "SMTP configuration is working correctly.",
        })
    }

    async getSmtpConfig(): Promise<SmtpConfig | null> {
        return this.settings.getSmtpConfig()
    }

    private createTransport(config: SmtpConfig) {
        return nodemailer.createTransport({
            host: config.host,
            port: config.port,
            secure: config.encryption === "ssl",
            requireTLS: config.encryption === "starttls",
            auth: config.username ? {user: config.username, pass: config.password} : undefined,
        })
    }
}
