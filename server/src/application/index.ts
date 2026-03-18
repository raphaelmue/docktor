import {StackRepository} from "../repositories/stack-repository.js";
import {StackFilesystem} from "../infrastructure/stack-filesystem.js";
import {DockerExecutor} from "../infrastructure/docker-executor.js";
import {StackService} from "./stack-service.js";
import {SettingsRepository} from "../repositories/settings-repository.js";
import {SettingsService} from "./settings-service.js";
import {NotificationRepository} from "../repositories/notification-repository.js";
import {NotificationService} from "./notification-service.js";
import {BackupRepository} from "../repositories/backup-repository.js";
import {ResticExecutor} from "../infrastructure/restic-executor.js";
import {BackupService} from "./backup-service.js";
import type {BackupStackRepo} from "./backup-service.js";
import type {StackStatus} from "../generated/prisma/enums.js";

const repo = new StackRepository();
const fs = new StackFilesystem();
const docker = new DockerExecutor();

export const stackService = new StackService(repo, fs, docker);
export const settingsRepository = new SettingsRepository();
export const settingsService = new SettingsService(settingsRepository);
export const notificationService = new NotificationService(
    new NotificationRepository(),
    settingsService,
);

// Adapter: StackRepository -> BackupStackRepo interface
const backupStackRepo: BackupStackRepo = {
    findByIdOrThrow: (id: string) => repo.findByIdOrThrow(id),
    update: async (id: string, data: Record<string, unknown>) => {
        const {prisma} = await import("../lib/db.js")
        await prisma.stack.update({
            where: {id},
            data: data as {status?: StackStatus; previousStatus?: StackStatus | null},
        })
    },
}

export const backupService = new BackupService(
    new ResticExecutor(),
    new BackupRepository(),
    backupStackRepo,
    settingsService,
    notificationService,
    fs,
);

export {getBackupBroadcaster} from "./backup-service.js";
