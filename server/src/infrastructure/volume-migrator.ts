import {spawn} from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";

export class VolumeMigrator {
	/**
	 * Copy data from Docker named volume to bind mount directory
	 * Uses: docker run --rm -v volumeName:/source -v destPath:/dest alpine cp -a /source/. /dest/
	 */
	async copyVolumeToBindMount(volumeName: string, destPath: string): Promise<void> {
		// Create destination directory
		await fs.mkdir(destPath, {recursive: true});

		const args = [
			"run",
			"--rm",
			"-v", `${volumeName}:/source:ro`,
			"-v", `${destPath}:/dest`,
			"alpine",
			"sh", "-c", "cp -a /source/. /dest/",
		];

		return new Promise((resolve, reject) => {
			const proc = spawn("docker", args);

			let stderr = "";
			proc.stderr.on("data", (chunk) => {
				stderr += chunk.toString();
			});

			proc.on("close", (code) => {
				if (code === 0) {
					resolve();
				} else {
					reject(new Error(`Volume copy failed (exit ${code}): ${stderr}`));
				}
			});

			proc.on("error", (err) => {
				reject(new Error(`Failed to spawn docker: ${err.message}`));
			});
		});
	}

	/**
	 * Copy files from source directory to destination
	 */
	async copyDirectory(srcPath: string, destPath: string): Promise<void> {
		await fs.cp(srcPath, destPath, {recursive: true});
	}
}

export const volumeMigrator = new VolumeMigrator();
