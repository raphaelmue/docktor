import type {FastifyPluginAsyncZod} from "fastify-type-provider-zod"
import {z} from "zod"
import {requireAuth} from "../lib/auth-middleware.js"
import {settingsService, settingsRepository, notificationService} from "../application/index.js"
import {encrypt} from "../lib/crypto.js"
import {prisma} from "../lib/db.js"

const updateGeneralSettingsSchema = z.object({
    instanceName: z.string().optional(),
    baseUrl: z.string().optional(),
    timezone: z.string().optional(),
})

const smtpConfigSchema = z.object({
    host: z.string().min(1, "SMTP host is required"),
    port: z.number().int().min(1).max(65535, "Port must be between 1 and 65535"),
    username: z.string().optional().default(""),
    password: z.string().optional().default(""),
    from: z.string().email("From address must be a valid email"),
    recipient: z.string().email("Recipient must be a valid email"),
})

const smtpTestSchema = z.object({
    host: z.string().min(1, "SMTP host is required"),
    port: z.number().int().min(1).max(65535, "Port must be between 1 and 65535"),
    username: z.string().optional().default(""),
    password: z.string().min(1, "Password is required for test"),
    from: z.string().email("From address must be a valid email"),
    recipient: z.string().email("Recipient must be a valid email"),
})

const notificationTriggersSchema = z.object({
    stackError: z.boolean().optional(),
    diskWarning: z.boolean().optional(),
    diskThresholdPercent: z.number().min(1).max(99).optional(),
    diskThresholdBytes: z.number().min(0).optional(),
})

const settingsRoutes: FastifyPluginAsyncZod = async (app) => {
    app.addHook("onRequest", requireAuth)

    app.get("/api/settings/general", async () => {
        return settingsService.getGeneralSettings()
    })

    app.put(
        "/api/settings/general",
        {schema: {body: updateGeneralSettingsSchema}},
        async (request) => {
            return settingsService.updateGeneralSettings(request.body)
        },
    )

    // GET /api/settings/smtp — Returns SMTP config with password masked
    app.get("/api/settings/smtp", async () => {
        const keys = ["smtp.host", "smtp.port", "smtp.username", "smtp.password", "smtp.from", "smtp.recipient"]
        const values = await settingsRepository.getMany(keys)
        return {
            host: values["smtp.host"] ?? "",
            port: Number(values["smtp.port"] ?? "587"),
            username: values["smtp.username"] ?? "",
            hasPassword: !!values["smtp.password"],
            from: values["smtp.from"] ?? "",
            recipient: values["smtp.recipient"] ?? "",
        }
    })

    // PUT /api/settings/smtp — Saves SMTP config, encrypts password
    app.put(
        "/api/settings/smtp",
        {schema: {body: smtpConfigSchema}},
        async (request) => {
            const {host, port, username, password, from, recipient} = request.body
            await settingsRepository.upsert("smtp.host", host)
            await settingsRepository.upsert("smtp.port", String(port))
            await settingsRepository.upsert("smtp.username", username)
            if (password) {
                const encryptedPassword = encrypt(password)
                await prisma.setting.upsert({
                    where: {key: "smtp.password"},
                    create: {key: "smtp.password", value: encryptedPassword, encrypted: true},
                    update: {value: encryptedPassword, encrypted: true},
                })
            }
            await settingsRepository.upsert("smtp.from", from)
            await settingsRepository.upsert("smtp.recipient", recipient)
            return {success: true}
        },
    )

    // POST /api/settings/smtp/test — Test SMTP connection
    app.post(
        "/api/settings/smtp/test",
        {schema: {body: smtpTestSchema}},
        async (request) => {
            const {host, port, username, password, from, recipient} = request.body
            await notificationService.testSmtp({host, port, username, password, from, recipient})
            return {success: true}
        },
    )

    // GET /api/settings/notification-triggers — Returns trigger toggle values
    app.get("/api/settings/notification-triggers", async () => {
        const values = await settingsRepository.getMany(["notify.stackError", "notify.diskWarning", "disk.thresholdPercent", "disk.thresholdBytes"])
        return {
            stackError: values["notify.stackError"] !== "false",
            diskWarning: values["notify.diskWarning"] !== "false",
            diskThresholdPercent: Number(values["disk.thresholdPercent"] ?? "10"),
            diskThresholdBytes: Number(values["disk.thresholdBytes"] ?? "2147483648"),
        }
    })

    // PUT /api/settings/notification-triggers — Updates toggle values
    app.put(
        "/api/settings/notification-triggers",
        {schema: {body: notificationTriggersSchema}},
        async (request) => {
            const {stackError, diskWarning, diskThresholdPercent, diskThresholdBytes} = request.body
            if (stackError !== undefined) {
                await settingsRepository.upsert("notify.stackError", String(stackError))
            }
            if (diskWarning !== undefined) {
                await settingsRepository.upsert("notify.diskWarning", String(diskWarning))
            }
            if (diskThresholdPercent !== undefined) {
                await settingsRepository.upsert("disk.thresholdPercent", String(diskThresholdPercent))
            }
            if (diskThresholdBytes !== undefined) {
                await settingsRepository.upsert("disk.thresholdBytes", String(diskThresholdBytes))
            }
            return {success: true}
        },
    )
}

export default settingsRoutes
