import {StackRepository} from "../repositories/stack-repository.js";
import {StackFilesystem} from "../infrastructure/stack-filesystem.js";
import {DockerExecutor} from "../infrastructure/docker-executor.js";
import {StackService} from "./stack-service.js";

const repo = new StackRepository();
const fs = new StackFilesystem();
const docker = new DockerExecutor();

export const stackService = new StackService(repo, fs, docker);
