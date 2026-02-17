export const StackStatus = {
  DRAFT: "DRAFT",
  DEPLOYING: "DEPLOYING",
  RUNNING: "RUNNING",
  HEALTHY: "HEALTHY",
  UNHEALTHY: "UNHEALTHY",
  STOPPED: "STOPPED",
  ERROR: "ERROR",
  UPDATING: "UPDATING",
  BACKING_UP: "BACKING_UP",
  RESTORING: "RESTORING",
  MIGRATING: "MIGRATING",
} as const;

export type StackStatus = (typeof StackStatus)[keyof typeof StackStatus];

export const BackupTrigger = {
  MANUAL: "MANUAL",
  SCHEDULED: "SCHEDULED",
} as const;

export type BackupTrigger = (typeof BackupTrigger)[keyof typeof BackupTrigger];

export const BackupStatus = {
  IN_PROGRESS: "IN_PROGRESS",
  COMPLETED: "COMPLETED",
  FAILED: "FAILED",
} as const;

export type BackupStatus = (typeof BackupStatus)[keyof typeof BackupStatus];

export interface Stack {
  id: string;
  displayName: string;
  description: string | null;
  hostPath: string;
  isAdoptedInPlace: boolean;
  status: StackStatus;
  previousStatus: StackStatus | null;
  lastKnownHash: string | null;
  lastParsedAt: string | null;
  configChanged: boolean;
  importedFrom: string | null;
  importedAt: string | null;
  volumeSizeBytes: number | null;
  volumeSizeAt: string | null;
  backupPreHook: string | null;
  backupPostHook: string | null;
  backupSchedule: string | null;
  backupRetention: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Service {
  id: string;
  stackId: string;
  serviceName: string;
  image: string;
  imageTag: string | null;
  imageDigest: string | null;
  ports: string | null;
  volumes: string | null;
  containerId: string | null;
  containerState: string | null;
  healthStatus: string | null;
  restartCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface Backup {
  id: string;
  stackId: string;
  resticSnapshotId: string;
  sizeBytes: number | null;
  trigger: BackupTrigger;
  status: BackupStatus;
  errorMessage: string | null;
  startedAt: string;
  completedAt: string | null;
  createdAt: string;
}
