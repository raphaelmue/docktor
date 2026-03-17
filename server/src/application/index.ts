import {StackRepository} from "../repositories/stack-repository.js";
import {StackFilesystem} from "../infrastructure/stack-filesystem.js";
import {DockerExecutor} from "../infrastructure/docker-executor.js";
import {StackService} from "./stack-service.js";
import {SettingsRepository} from "../repositories/settings-repository.js";
import {SettingsService} from "./settings-service.js";
import {NotificationRepository} from "../repositories/notification-repository.js";
import {NotificationService} from "./notification-service.js";

const repo = new StackRepository();
const fs = new StackFilesystem();
const docker = new DockerExecutor();

export const stackService = new StackService(repo, fs, docker);
export const settingsService = new SettingsService(new SettingsRepository());
export const notificationService = new NotificationService(
    new NotificationRepository(),
    settingsService,
);
