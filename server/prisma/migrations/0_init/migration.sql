-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "BackupTrigger" AS ENUM ('MANUAL', 'SCHEDULED', 'RESTORE');

-- CreateEnum
CREATE TYPE "BackupStatus" AS ENUM ('IN_PROGRESS', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('stack_error', 'stack_unhealthy', 'disk_warning', 'backup_failure');

-- CreateEnum
CREATE TYPE "StackEventType" AS ENUM ('config_changed', 'config_error', 'update_available');

-- CreateEnum
CREATE TYPE "StackStatus" AS ENUM ('DRAFT', 'DEPLOYING', 'RUNNING', 'HEALTHY', 'UNHEALTHY', 'STOPPED', 'ERROR', 'UPDATING', 'BACKING_UP', 'RESTORING', 'MIGRATING');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "emailVerified" BOOLEAN NOT NULL DEFAULT false,
    "image" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Account" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "accessToken" TEXT,
    "refreshToken" TEXT,
    "idToken" TEXT,
    "accessTokenExpiresAt" TIMESTAMP(3),
    "refreshTokenExpiresAt" TIMESTAMP(3),
    "scope" TEXT,
    "password" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Verification" (
    "id" TEXT NOT NULL,
    "identifier" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3),

    CONSTRAINT "Verification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Backup" (
    "id" TEXT NOT NULL,
    "stackId" TEXT NOT NULL,
    "resticSnapshotId" TEXT NOT NULL,
    "sizeBytes" BIGINT,
    "trigger" "BackupTrigger" NOT NULL,
    "status" "BackupStatus" NOT NULL,
    "errorMessage" TEXT,
    "logLines" TEXT[],
    "startedAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Backup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Deployment" (
    "id" TEXT NOT NULL,
    "stackId" TEXT NOT NULL,
    "templateId" TEXT,
    "templateVersion" TEXT,
    "composeHash" TEXT NOT NULL,
    "deployedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "success" BOOLEAN NOT NULL,
    "errorMessage" TEXT,

    CONSTRAINT "Deployment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImageUpdateCheck" (
    "id" TEXT NOT NULL,
    "imageRef" TEXT NOT NULL,
    "lastCheckedAt" TIMESTAMP(3) NOT NULL,
    "latestTag" TEXT,
    "latestDigest" TEXT,
    "currentDigest" TEXT,
    "hasUpdate" BOOLEAN NOT NULL DEFAULT false,
    "checkError" TEXT,
    "availableTags" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ImageUpdateCheck_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "type" "NotificationType" NOT NULL,
    "stackId" TEXT,
    "message" TEXT NOT NULL,
    "emailSent" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StackIncident" (
    "id" TEXT NOT NULL,
    "stackId" TEXT NOT NULL,
    "triggerType" TEXT NOT NULL,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StackIncident_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProxyConfig" (
    "id" TEXT NOT NULL,
    "stackId" TEXT NOT NULL,
    "serviceName" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "internalPort" INTEGER NOT NULL,
    "tlsEnabled" BOOLEAN NOT NULL DEFAULT true,
    "certStatus" TEXT NOT NULL DEFAULT 'pending',
    "certMessage" TEXT,
    "certCheckedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProxyConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Registry" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "username" TEXT,
    "password" TEXT,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Registry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Service" (
    "id" TEXT NOT NULL,
    "stackId" TEXT NOT NULL,
    "serviceName" TEXT NOT NULL,
    "image" TEXT NOT NULL,
    "imageTag" TEXT,
    "imageDigest" TEXT,
    "ports" TEXT,
    "volumes" TEXT,
    "containerId" TEXT,
    "containerState" TEXT,
    "healthStatus" TEXT,
    "restartCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Service_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Setting" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "encrypted" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Setting_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "StackEvent" (
    "id" TEXT NOT NULL,
    "stackId" TEXT NOT NULL,
    "type" "StackEventType" NOT NULL,
    "message" TEXT,
    "payload" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StackEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Stack" (
    "id" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "description" TEXT,
    "hostPath" TEXT NOT NULL,
    "isAdoptedInPlace" BOOLEAN NOT NULL DEFAULT false,
    "isProtected" BOOLEAN NOT NULL DEFAULT false,
    "status" "StackStatus" NOT NULL DEFAULT 'DRAFT',
    "previousStatus" "StackStatus",
    "lastKnownHash" TEXT,
    "lastParsedAt" TIMESTAMP(3),
    "configChanged" BOOLEAN NOT NULL DEFAULT false,
    "configError" TEXT,
    "lastEnvHash" TEXT,
    "importedFrom" TEXT,
    "importedAt" TIMESTAMP(3),
    "volumeSizeBytes" BIGINT,
    "volumeSizeAt" TIMESTAMP(3),
    "backupPreHook" TEXT,
    "backupPostHook" TEXT,
    "backupSchedule" TEXT,
    "backupRetention" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Stack_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StatusLog" (
    "id" TEXT NOT NULL,
    "stackId" TEXT NOT NULL,
    "fromStatus" "StackStatus",
    "toStatus" "StackStatus" NOT NULL,
    "message" TEXT,
    "output" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StatusLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Session_token_key" ON "Session"("token");

-- CreateIndex
CREATE UNIQUE INDEX "ImageUpdateCheck_imageRef_key" ON "ImageUpdateCheck"("imageRef");

-- CreateIndex
CREATE INDEX "Notification_createdAt_idx" ON "Notification"("createdAt");

-- CreateIndex
CREATE INDEX "Notification_stackId_createdAt_idx" ON "Notification"("stackId", "createdAt");

-- CreateIndex
CREATE INDEX "StackIncident_stackId_triggerType_idx" ON "StackIncident"("stackId", "triggerType");

-- CreateIndex
CREATE UNIQUE INDEX "StackIncident_stackId_triggerType_resolvedAt_key" ON "StackIncident"("stackId", "triggerType", "resolvedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ProxyConfig_domain_key" ON "ProxyConfig"("domain");

-- CreateIndex
CREATE UNIQUE INDEX "Registry_url_key" ON "Registry"("url");

-- CreateIndex
CREATE UNIQUE INDEX "Service_stackId_serviceName_key" ON "Service"("stackId", "serviceName");

-- CreateIndex
CREATE INDEX "StackEvent_stackId_createdAt_idx" ON "StackEvent"("stackId", "createdAt");

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Account" ADD CONSTRAINT "Account_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Backup" ADD CONSTRAINT "Backup_stackId_fkey" FOREIGN KEY ("stackId") REFERENCES "Stack"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Deployment" ADD CONSTRAINT "Deployment_stackId_fkey" FOREIGN KEY ("stackId") REFERENCES "Stack"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_stackId_fkey" FOREIGN KEY ("stackId") REFERENCES "Stack"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StackIncident" ADD CONSTRAINT "StackIncident_stackId_fkey" FOREIGN KEY ("stackId") REFERENCES "Stack"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProxyConfig" ADD CONSTRAINT "ProxyConfig_stackId_fkey" FOREIGN KEY ("stackId") REFERENCES "Stack"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Service" ADD CONSTRAINT "Service_stackId_fkey" FOREIGN KEY ("stackId") REFERENCES "Stack"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StackEvent" ADD CONSTRAINT "StackEvent_stackId_fkey" FOREIGN KEY ("stackId") REFERENCES "Stack"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StatusLog" ADD CONSTRAINT "StatusLog_stackId_fkey" FOREIGN KEY ("stackId") REFERENCES "Stack"("id") ON DELETE CASCADE ON UPDATE CASCADE;

