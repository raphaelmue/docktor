import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {spawn} from "node:child_process";
import {DockerExecutor, dockerExecutor} from "../infrastructure/docker-executor.js";
import {VolumeMigrator, volumeMigrator} from "../infrastructure/volume-migrator.js";
import {ComposeRewriter, composeRewriter, type VolumeSelection} from "../infrastructure/compose-rewriter.js";
import {StackFilesystem} from "../infrastructure/stack-filesystem.js";
import {StackRepository, stackRepository} from "../repositories/stack-repository.js";
import {slugify} from "../lib/slugify.js";
import {createComposeConfig} from "../domain/compose-config.js";
import {BadRequestError} from "../lib/errors.js";

// CR-02: Docker volume names are also passed verbatim as the `-v` source to
// `docker run`; a name containing `/` is interpreted by Docker as a host bind
// path rather than a named volume, so names must be constrained to Docker's
// own allowed volume-name character set before ever reaching the CLI.
const VOLUME_NAME_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/;

/**
 * CR-02: Resolve `target` against `base` and reject the result unless it is
 * `base` itself or a strict descendant of it. Prevents `..` segments (or an
 * absolute path) in attacker-controlled `newPath`/volume-name values from
 * escaping the managed stack/volumes directory.
 */
function assertWithin(base: string, target: string): string {
	const resolvedBase = path.resolve(base);
	const resolved = path.resolve(base, target);
	if (resolved !== resolvedBase && !resolved.startsWith(resolvedBase + path.sep)) {
		throw new BadRequestError(`Path escapes managed directory: ${target}`);
	}
	return resolved;
}

export interface MigrationInput {
	composePath: string;
	displayName: string;
	volumeSelections: VolumeSelection[];
	namedVolumeSelections: Map<string, boolean>;
}

export interface MigrationResult {
	success: boolean;
	stackId?: string;
	error?: string;
	originalPath: string;
}

export class MigrationService {
	constructor(
		private readonly docker: DockerExecutor = dockerExecutor,
		private readonly migrator: VolumeMigrator = volumeMigrator,
		private readonly rewriter: ComposeRewriter = composeRewriter,
		private readonly stackFs: StackFilesystem = new StackFilesystem(),
		private readonly stackRepo: StackRepository = stackRepository,
	) {}

	/**
	 * Preview migration changes without executing
	 */
	async previewMigration(
		composePath: string,
		volumeSelections: VolumeSelection[],
		namedVolumeSelections: Map<string, boolean>,
	): Promise<{diff: string; extractedEnv: string}> {
		const originalCompose = await fs.readFile(composePath, "utf-8");
		const result = this.rewriter.rewrite(originalCompose, volumeSelections, namedVolumeSelections);
		const diff = this.rewriter.generateDiff(originalCompose, result.rewrittenCompose);
		return {diff, extractedEnv: result.extractedEnv};
	}

	/**
	 * Execute full migration: stop -> backup -> copy -> rewrite -> deploy
	 * BF-04: Full migration wizard
	 * BF-05: Rollback on failure
	 */
	async migrate(input: MigrationInput): Promise<MigrationResult> {
		const {composePath, displayName, volumeSelections, namedVolumeSelections} = input;
		const originalDir = path.dirname(composePath);
		const stackId = slugify(displayName);

		if (!stackId) {
			return {success: false, error: "Display name produces an empty slug", originalPath: originalDir};
		}

		// Check if stack already exists
		if (await this.stackRepo.exists(stackId)) {
			return {success: false, error: `Stack "${stackId}" already exists`, originalPath: originalDir};
		}

		// Create backup before migration
		const backupDir = path.join(os.tmpdir(), `docktor-migration-backup-${stackId}-${Date.now()}`);

		try {
			// Step 1: Create backup of original directory
			await fs.cp(originalDir, backupDir, {recursive: true});

			// Step 2: Stop running containers
			try {
				await this.stopContainersAtPath(originalDir);
			} catch {
				// Continue even if stop fails (might not be running)
			}

			// Step 3: Create new stack directory
			const newStackPath = await this.stackFs.createDirectory(stackId);
			const volumesDir = path.join(newStackPath, "volumes");
			await fs.mkdir(volumesDir, {recursive: true});

			// Step 4: Copy named volumes to bind mounts
			for (const [volName, shouldConvert] of namedVolumeSelections) {
				if (shouldConvert) {
					// CR-02: volName is attacker-controlled (request body key) and is
					// also used as the Docker `-v` source below — validate it against
					// Docker's volume-name charset and confine destPath to volumesDir.
					if (!VOLUME_NAME_PATTERN.test(volName)) {
						throw new BadRequestError(`Invalid volume name: ${volName}`);
					}
					const destPath = assertWithin(volumesDir, volName);
					await this.migrator.copyVolumeToBindMount(volName, destPath);
				}
			}

			// Step 5: Copy bind mount data
			for (const sel of volumeSelections) {
				if (sel.convert) {
					const srcPath = path.isAbsolute(sel.originalPath)
						? sel.originalPath
						: path.join(originalDir, sel.originalPath);
					// CR-02: sel.newPath is fully attacker-controlled — confine the
					// resolved destination to be a strict descendant of newStackPath.
					const destPath = assertWithin(newStackPath, sel.newPath);

					try {
						await fs.access(srcPath);
						await this.migrator.copyDirectory(srcPath, destPath);
					} catch {
						// Source might not exist yet (empty volume)
						await fs.mkdir(destPath, {recursive: true});
					}
				}
			}

			// Step 6: Rewrite compose file
			const originalCompose = await fs.readFile(composePath, "utf-8");
			const rewriteResult = this.rewriter.rewrite(originalCompose, volumeSelections, namedVolumeSelections);

			// Write new compose file
			await fs.writeFile(
				path.join(newStackPath, "docker-compose.yml"),
				rewriteResult.rewrittenCompose,
				"utf-8",
			);

			// Write extracted env vars if any
			if (rewriteResult.extractedEnv) {
				// Merge with existing .env if present
				let existingEnv = "";
				try {
					existingEnv = await fs.readFile(path.join(originalDir, ".env"), "utf-8");
				} catch {
					// No existing .env
				}
				const newEnv = existingEnv
					? `${existingEnv}\n\n# Extracted from docker-compose.yml\n${rewriteResult.extractedEnv}`
					: rewriteResult.extractedEnv;
				await fs.writeFile(path.join(newStackPath, ".env"), newEnv, "utf-8");
			} else {
				// Copy existing .env if present
				try {
					await fs.copyFile(
						path.join(originalDir, ".env"),
						path.join(newStackPath, ".env"),
					);
				} catch {
					// No .env to copy
				}
			}

			// Step 7: Create stack record
			const composeConfig = createComposeConfig(rewriteResult.rewrittenCompose);
			await this.stackRepo.create({
				id: stackId,
				displayName,
				description: `Migrated from ${originalDir}`,
				hostPath: newStackPath,
				composeConfig,
			});

			// Step 8: Deploy new stack
			await this.docker.up(stackId);

			// Clean up backup (keep for now, user can delete old files later)
			// await fs.rm(backupDir, {recursive: true, force: true});

			return {success: true, stackId, originalPath: originalDir};

		} catch (err: any) {
			// Rollback on failure
			console.error(`[MigrationService] Migration failed, rolling back: ${err.message}`);

			try {
				// Delete incomplete stack directory
				await this.stackFs.removeDirectory(stackId);
			} catch {
				// Ignore cleanup errors
			}

			try {
				// Delete incomplete stack record if created
				await this.stackRepo.delete(stackId).catch(() => {});
			} catch {
				// Ignore
			}

			try {
				// Restore original files from backup
				await fs.rm(originalDir, {recursive: true, force: true});
				await fs.cp(backupDir, originalDir, {recursive: true});
			} catch (restoreErr: any) {
				console.error(`[MigrationService] Restore failed: ${restoreErr.message}`);
			}

			try {
				// Restart containers at original location
				await this.startContainersAtPath(originalDir);
			} catch {
				// Container restart might fail if compose is broken
			}

			try {
				// Clean up backup
				await fs.rm(backupDir, {recursive: true, force: true});
			} catch {
				// Ignore
			}

			return {
				success: false,
				error: `Migration failed: ${err.message}. Rollback complete.`,
				originalPath: originalDir,
			};
		}
	}

	private async stopContainersAtPath(dirPath: string): Promise<void> {
		return new Promise((resolve, reject) => {
			const proc = spawn("docker", ["compose", "stop"], {cwd: dirPath});
			proc.on("close", (code) => {
				if (code === 0) resolve();
				else reject(new Error(`docker compose stop failed with code ${code}`));
			});
			proc.on("error", reject);
		});
	}

	private async startContainersAtPath(dirPath: string): Promise<void> {
		return new Promise((resolve, reject) => {
			const proc = spawn("docker", ["compose", "up", "-d"], {cwd: dirPath});
			proc.on("close", (code) => {
				if (code === 0) resolve();
				else reject(new Error(`docker compose up failed with code ${code}`));
			});
			proc.on("error", reject);
		});
	}
}

export const migrationService = new MigrationService();
