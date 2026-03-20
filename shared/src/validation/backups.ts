import {z} from "zod";

// --- Settings: backup repository configuration ---
export const backupRepoTypeSchema = z.enum(["local", "sftp", "s3"]);
export type BackupRepoType = z.infer<typeof backupRepoTypeSchema>;

export const backupSettingsSchema = z.object({
    repoType: backupRepoTypeSchema,
    repoPath: z.string().nullable().optional(),        // local
    sftpHost: z.string().nullable().optional(),         // sftp
    sftpUser: z.string().nullable().optional(),         // sftp
    sftpKey: z.string().nullable().optional(),          // sftp (private key PEM)
    s3Endpoint: z.string().nullable().optional(),       // s3
    s3Bucket: z.string().nullable().optional(),         // s3
    s3AccessKey: z.string().nullable().optional(),      // s3
    s3SecretKey: z.string().nullable().optional(),      // s3 (encrypted)
    password: z.string().nullable().optional(),  // optional when updating (only encrypt/save when user enters a new password)
}).superRefine((data, ctx) => {
    if (data.repoType === "local" && !data.repoPath?.trim()) {
        ctx.addIssue({code: z.ZodIssueCode.custom, message: "Repository path is required", path: ["repoPath"]});
    }
    if (data.repoType === "sftp") {
        if (!data.sftpHost?.trim()) ctx.addIssue({code: z.ZodIssueCode.custom, message: "SFTP host is required", path: ["sftpHost"]});
        if (!data.sftpUser?.trim()) ctx.addIssue({code: z.ZodIssueCode.custom, message: "SFTP username is required", path: ["sftpUser"]});
    }
    if (data.repoType === "s3") {
        if (!data.s3Bucket?.trim()) ctx.addIssue({code: z.ZodIssueCode.custom, message: "Bucket name is required", path: ["s3Bucket"]});
        if (!data.s3AccessKey?.trim()) ctx.addIssue({code: z.ZodIssueCode.custom, message: "Access key is required", path: ["s3AccessKey"]});
        if (!data.s3SecretKey?.trim()) ctx.addIssue({code: z.ZodIssueCode.custom, message: "Secret key is required", path: ["s3SecretKey"]});
    }
});
export type BackupSettingsInput = z.infer<typeof backupSettingsSchema>;

// --- Settings: global default schedule + retention ---
export const retentionPolicySchema = z.object({
    keepDaily: z.coerce.number().int().min(0).default(7),
    keepWeekly: z.coerce.number().int().min(0).default(4),
    keepMonthly: z.coerce.number().int().min(0).default(12),
});
export type RetentionPolicy = z.infer<typeof retentionPolicySchema>;

export const backupDefaultsSchema = z.object({
    defaultSchedule: z.string().optional(),  // cron expression, validated server-side with node-cron
    defaultRetention: retentionPolicySchema.optional(),
});
export type BackupDefaultsInput = z.infer<typeof backupDefaultsSchema>;

// --- Stack-level backup config ---
export const stackBackupConfigSchema = z.object({
    useGlobalSchedule: z.boolean().default(true),
    schedule: z.string().nullable().optional(),          // cron override
    useGlobalRetention: z.boolean().default(true),
    retention: retentionPolicySchema.nullable().optional(),
    preHook: z.string().nullable().optional(),           // shell command
    postHook: z.string().nullable().optional(),          // shell command
});
export type StackBackupConfigInput = z.infer<typeof stackBackupConfigSchema>;

// --- Trigger manual backup ---
export const triggerBackupSchema = z.object({
    stackId: z.string().min(1),
});
export type TriggerBackupInput = z.infer<typeof triggerBackupSchema>;

// --- Restore from snapshot ---
export const restoreSnapshotSchema = z.object({
    snapshotId: z.string().min(1, "Snapshot ID is required"),
});
export type RestoreSnapshotInput = z.infer<typeof restoreSnapshotSchema>;
