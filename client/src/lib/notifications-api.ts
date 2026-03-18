import {apiFetch} from "./api"

// SMTP settings types
export interface SmtpSettings {
    host: string
    port: number
    encryption: "none" | "starttls" | "ssl"
    username: string
    hasPassword: boolean
    from: string
}

export interface SmtpSettingsInput {
    host: string
    port: number
    encryption: "none" | "starttls" | "ssl"
    username: string
    password: string
    from: string
}

export interface SmtpTestInput extends SmtpSettingsInput {
    recipient: string
}

// Notification triggers types
export interface NotificationTriggers {
    stackError: boolean
    diskWarning: boolean
    diskThresholdPercent: number
    diskThresholdBytes: number
}

// Notification log types
export interface NotificationEntry {
    id: string
    type: "stack_error" | "stack_unhealthy" | "disk_warning"
    stackId: string | null
    stack: {id: string; displayName: string} | null
    message: string
    emailSent: boolean
    createdAt: string
}

// SMTP API
export async function getSmtpSettings(): Promise<SmtpSettings> {
    return apiFetch<SmtpSettings>("/api/settings/smtp")
}

export async function saveSmtpSettings(data: SmtpSettingsInput): Promise<{success: boolean}> {
    return apiFetch("/api/settings/smtp", {
        method: "PUT",
        body: JSON.stringify(data),
    })
}

export async function testSmtp(data: SmtpTestInput): Promise<{success: boolean}> {
    return apiFetch("/api/settings/smtp/test", {
        method: "POST",
        body: JSON.stringify(data),
    })
}

// Notification triggers API
export async function getNotificationTriggers(): Promise<NotificationTriggers> {
    return apiFetch<NotificationTriggers>("/api/settings/notification-triggers")
}

export async function updateNotificationTriggers(
    data: Partial<NotificationTriggers>,
): Promise<{success: boolean}> {
    return apiFetch("/api/settings/notification-triggers", {
        method: "PUT",
        body: JSON.stringify(data),
    })
}

// Notification log API
export async function getNotifications(): Promise<NotificationEntry[]> {
    return apiFetch<NotificationEntry[]>("/api/notifications")
}
