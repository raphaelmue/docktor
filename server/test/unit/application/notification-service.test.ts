import { beforeEach, describe, expect, it, vi } from "vitest"
import { NotificationService } from "../../../src/application/notification-service.js"

// Use vi.hoisted so these refs are available in the vi.mock factory (which is hoisted to top)
const {mockVerify, mockSendMail, mockCreateTransport, mockPrismaUserFindMany} = vi.hoisted(() => {
    const mockVerify = vi.fn()
    const mockSendMail = vi.fn()
    const mockCreateTransport = vi.fn().mockReturnValue({
        verify: mockVerify,
        sendMail: mockSendMail,
    })
    const mockPrismaUserFindMany = vi.fn()
    return {mockVerify, mockSendMail, mockCreateTransport, mockPrismaUserFindMany}
})

// Mock nodemailer at module level so ESM imports are intercepted correctly
vi.mock("nodemailer", () => ({
    default: {
        createTransport: mockCreateTransport,
    },
}))

// Mock prisma to avoid DATABASE_URL requirement
vi.mock("../../../src/lib/db.js", () => ({
    prisma: {
        user: {
            findMany: mockPrismaUserFindMany,
        },
    },
}))

function createMockRepo() {
    return {
        create: vi.fn(),
        markEmailSent: vi.fn(),
        findLastDiskAlert: vi.fn(),
        setDiskAlertActive: vi.fn(),
    }
}

function createMockSettings() {
    return {
        getSetting: vi.fn(),
        upsertSetting: vi.fn(),
        getSmtpConfig: vi.fn(),
    }
}

function createMockBroadcaster() {
    return {
        publish: vi.fn(),
        subscribe: vi.fn(),
    }
}

describe("NotificationService", () => {
    let service: NotificationService
    let repo: ReturnType<typeof createMockRepo>
    let settings: ReturnType<typeof createMockSettings>
    let broadcaster: ReturnType<typeof createMockBroadcaster>

    beforeEach(() => {
        vi.clearAllMocks()
        // Reset transport mock to default resolved state
        mockVerify.mockResolvedValue(true)
        mockSendMail.mockResolvedValue({ messageId: "123" })
        mockCreateTransport.mockReturnValue({
            verify: mockVerify,
            sendMail: mockSendMail,
        })
        // Default: mock one user for email sending
        mockPrismaUserFindMany.mockResolvedValue([{ email: "user@example.com" }])
        repo = createMockRepo()
        settings = createMockSettings()
        broadcaster = createMockBroadcaster()
        service = new NotificationService(repo as any, settings as any, broadcaster as any)
    })

    describe("notify", () => {
        it("writes notification to DB when trigger is enabled", async () => {
            settings.getSetting.mockResolvedValue("true")
            settings.getSmtpConfig.mockResolvedValue(null)
            repo.create.mockResolvedValue({ id: "notif-1" })

            await service.notify({
                type: "stack_error",
                stackId: "my-stack",
                subject: "Stack Error",
                message: "Stack my-stack entered ERROR state",
            })

            expect(repo.create).toHaveBeenCalledWith(
                expect.objectContaining({
                    type: "stack_error",
                    stackId: "my-stack",
                    message: "Stack my-stack entered ERROR state",
                    emailSent: false,
                }),
            )
        })

        it("skips notification when trigger is disabled", async () => {
            settings.getSetting.mockResolvedValue("false")

            await service.notify({
                type: "stack_error",
                stackId: "my-stack",
                subject: "Stack Error",
                message: "Stack my-stack entered ERROR state",
            })

            expect(repo.create).not.toHaveBeenCalled()
        })

        it("sends email when SMTP is configured", async () => {
            settings.getSetting.mockResolvedValue("true")
            settings.getSmtpConfig.mockResolvedValue({
                host: "smtp.example.com",
                port: 587,
                username: "user@example.com",
                password: "secret",
                from: "noreply@example.com",
                recipient: "admin@example.com",
            })
            repo.create.mockResolvedValue({ id: "notif-2" })

            await service.notify({
                type: "stack_error",
                stackId: "my-stack",
                subject: "Stack Error",
                message: "Stack my-stack entered ERROR state",
            })

            expect(repo.markEmailSent).toHaveBeenCalledWith("notif-2")
        })

        it("logs to DB but does not send email when SMTP is not configured", async () => {
            settings.getSetting.mockResolvedValue("true")
            settings.getSmtpConfig.mockResolvedValue(null)
            repo.create.mockResolvedValue({ id: "notif-3" })

            await service.notify({
                type: "disk_warning",
                stackId: null,
                subject: "Disk Warning",
                message: "Disk space below threshold",
            })

            expect(repo.create).toHaveBeenCalled()
            expect(repo.markEmailSent).not.toHaveBeenCalled()
        })

        it("does not throw when email send fails", async () => {
            settings.getSetting.mockResolvedValue("true")
            settings.getSmtpConfig.mockResolvedValue({
                host: "smtp.example.com",
                port: 587,
                username: "user",
                password: "pass",
                from: "from@example.com",
                recipient: "to@example.com",
            })
            repo.create.mockResolvedValue({ id: "notif-4" })
            mockSendMail.mockRejectedValue(new Error("SMTP connection refused"))

            // Should not throw even when sendMail fails
            await expect(
                service.notify({
                    type: "stack_error",
                    stackId: "my-stack",
                    subject: "Stack Error",
                    message: "error message",
                }),
            ).resolves.not.toThrow()

            expect(repo.create).toHaveBeenCalled()
        })
    })

    describe("testSmtp", () => {
        it("sends test email", async () => {
            const smtpConfig = {
                host: "smtp.example.com",
                port: 587,
                username: "user@example.com",
                password: "secret",
                from: "noreply@example.com",
                recipient: "admin@example.com",
            }

            // For valid config, testSmtp should not throw
            await expect(service.testSmtp(smtpConfig)).resolves.not.toThrow()
            expect(mockSendMail).toHaveBeenCalledWith({
                from: "noreply@example.com",
                to: "admin@example.com",
                subject: "Docktor — SMTP test",
                text: "SMTP configuration is working correctly.",
            })
        })
    })
})
