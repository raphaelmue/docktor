import {apiFetch} from "@/lib/api"

export interface BackupRecord {
    id: string
    stackId: string
    resticSnapshotId: string
    sizeBytes: string | null
    trigger: "MANUAL" | "SCHEDULED" | "RESTORE"
    status: "IN_PROGRESS" | "COMPLETED" | "FAILED"
    errorMessage: string | null
    logLines: string[]
    startedAt: string
    completedAt: string | null
    createdAt: string
}

export interface ResticSnapshot {
    id: string
    time: string
    hostname: string
    tags: string[] | null
    paths: string[]
    short_id: string
}

export interface BackupSettings {
    repoType: "local" | "sftp" | "s3" | null
    repoPath: string | null
    sftpHost: string | null
    sftpUser: string | null
    s3Endpoint: string | null
    s3Bucket: string | null
    s3AccessKey: string | null
    hasPassword: boolean
    hasSftpKey: boolean
    hasS3SecretKey: boolean
}

export interface RetentionPolicy {
    keepDaily: number
    keepWeekly: number
    keepMonthly: number
}

export interface BackupDefaults {
    defaultSchedule: string | null
    defaultRetention: RetentionPolicy | null
}

export interface StackBackupConfig {
    useGlobalSchedule: boolean
    schedule: string | null
    useGlobalRetention: boolean
    retention: RetentionPolicy | null
    preHook: string | null
    postHook: string | null
    globalSchedule: string | null
    globalRetention: RetentionPolicy | null
}

export interface ResticStatus {
    available: boolean
    version?: string
}

// Stack-scoped backup operations
export async function triggerBackup(stackId: string): Promise<{backupId: string}> {
    return apiFetch<{backupId: string}>(`/api/stacks/${stackId}/backup`, {
        method: "POST",
    })
}

export async function triggerRestore(
    stackId: string,
    snapshotId: string,
): Promise<{backupId: string}> {
    return apiFetch<{backupId: string}>(`/api/stacks/${stackId}/restore`, {
        method: "POST",
        body: JSON.stringify({snapshotId}),
    })
}

export async function getBackups(stackId: string): Promise<BackupRecord[]> {
    return apiFetch<BackupRecord[]>(`/api/stacks/${stackId}/backups`)
}

export async function getBackup(backupId: string): Promise<BackupRecord> {
    return apiFetch<BackupRecord>(`/api/backups/${backupId}`)
}

export async function getSnapshots(stackId: string): Promise<ResticSnapshot[]> {
    return apiFetch<ResticSnapshot[]>(`/api/stacks/${stackId}/snapshots`)
}

export async function getVolumeWarnings(stackId: string): Promise<{warnings: string[]}> {
    return apiFetch<{warnings: string[]}>(`/api/stacks/${stackId}/volume-warnings`)
}

// Global backup settings
export async function getBackupSettings(): Promise<BackupSettings> {
    return apiFetch<BackupSettings>("/api/settings/backup")
}

export async function saveBackupSettings(data: Record<string, unknown>): Promise<void> {
    await apiFetch("/api/settings/backup", {
        method: "PUT",
        body: JSON.stringify(data),
    })
}

export async function getBackupDefaults(): Promise<BackupDefaults> {
    return apiFetch<BackupDefaults>("/api/settings/backup-defaults")
}

export async function saveBackupDefaults(data: Record<string, unknown>): Promise<void> {
    await apiFetch("/api/settings/backup-defaults", {
        method: "PUT",
        body: JSON.stringify(data),
    })
}

// Per-stack backup config
export async function getBackupConfig(stackId: string): Promise<StackBackupConfig> {
    return apiFetch<StackBackupConfig>(`/api/stacks/${stackId}/backup-config`)
}

export async function saveBackupConfig(
    stackId: string,
    data: Record<string, unknown>,
): Promise<void> {
    await apiFetch(`/api/stacks/${stackId}/backup-config`, {
        method: "PUT",
        body: JSON.stringify(data),
    })
}

export async function getResticStatus(): Promise<ResticStatus> {
    return apiFetch<ResticStatus>("/api/settings/backup/status")
}
