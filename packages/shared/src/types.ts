/** Stack status values matching the Prisma enum */
export const STACK_STATUSES = [
  "DRAFT",
  "DEPLOYING",
  "RUNNING",
  "HEALTHY",
  "UNHEALTHY",
  "STOPPED",
  "ERROR",
  "UPDATING",
  "BACKING_UP",
  "RESTORING",
  "MIGRATING",
] as const;

export type StackStatus = (typeof STACK_STATUSES)[number];

/** Backup trigger values matching the Prisma enum */
export const BACKUP_TRIGGERS = ["MANUAL", "SCHEDULED"] as const;
export type BackupTrigger = (typeof BACKUP_TRIGGERS)[number];

/** Backup status values matching the Prisma enum */
export const BACKUP_STATUSES = ["IN_PROGRESS", "COMPLETED", "FAILED"] as const;
export type BackupStatus = (typeof BACKUP_STATUSES)[number];
