import {spawn} from "node:child_process";

export interface ResticRunResult {
    exitCode: number;
    stderr: string;
}

export interface ResticSnapshot {
    id: string;
    time: string;
    hostname: string;
    tags: string[] | null;
    paths: string[];
    short_id: string;
}

export interface BackupRepoConfig {
    repoType: "local" | "sftp" | "s3";
    repoPath?: string;
    sftpHost?: string;
    sftpUser?: string;
    sftpKey?: string;
    s3Endpoint?: string;
    s3Bucket?: string;
    s3AccessKey?: string;
    s3SecretKey?: string;
    password: string; // already decrypted
}

export interface RetentionPolicy {
    keepDaily: number;
    keepWeekly: number;
    keepMonthly: number;
}

export class ResticExecutor {
    private readonly binary: string;

    constructor(binary?: string) {
        this.binary = binary ?? process.env.RESTIC_BINARY ?? "restic";
    }

    /**
     * Spawn the restic binary with provided args and env, streaming stdout lines
     * via the optional onLine callback.
     *
     * Credentials must NEVER appear on the CLI — they belong in the env object.
     */
    async run(
        args: string[],
        env: Record<string, string>,
        onLine?: (line: string) => void,
    ): Promise<ResticRunResult> {
        return new Promise((resolve, reject) => {
            const child = spawn(this.binary, args, {
                env: {...process.env, ...env},
                stdio: ["ignore", "pipe", "pipe"],
            });

            let stderrBuf = "";
            let lineBuf = "";

            child.stdout.on("data", (chunk: Buffer) => {
                lineBuf += chunk.toString("utf8");
                const lines = lineBuf.split("\n");
                // Last element may be incomplete — keep it in the buffer
                lineBuf = lines.pop() ?? "";
                for (const line of lines) {
                    if (line.trim()) onLine?.(line);
                }
            });

            child.stderr.on("data", (chunk: Buffer) => {
                stderrBuf += chunk.toString("utf8");
            });

            child.on("error", reject);

            child.on("close", (code) => {
                // Flush any partial line remaining in the buffer
                if (lineBuf.trim()) onLine?.(lineBuf);
                resolve({exitCode: code ?? 1, stderr: stderrBuf});
            });
        });
    }

    /**
     * Returns the args array to pass to restic for a backup operation.
     * Format: [stackPath, "--exclude", "<stackPath>/logs", "--tag", stackId, "--json"]
     * The caller prepends "backup" as the subcommand when needed.
     */
    buildBackupArgs(stackPath: string, stackId: string): string[] {
        return [stackPath, "--exclude", `${stackPath}/logs`, "--tag", stackId, "--json"];
    }

    /** Returns ["forget", "--tag", stackId, "--keep-daily", N, "--keep-weekly", N, "--keep-monthly", N, "--prune"] */
    buildForgetArgs(stackId: string, policy: RetentionPolicy): string[] {
        return [
            "forget",
            "--tag",
            stackId,
            "--keep-daily",
            String(policy.keepDaily),
            "--keep-weekly",
            String(policy.keepWeekly),
            "--keep-monthly",
            String(policy.keepMonthly),
            "--prune",
        ];
    }

    /** Returns ["restore", snapshotId, "--target", "/"] */
    buildRestoreArgs(snapshotId: string): string[] {
        return ["restore", snapshotId, "--target", "/"];
    }

    /** Returns ["init"] */
    buildInitArgs(): string[] {
        return ["init"];
    }

    /**
     * Lists snapshots for the given tag. Returns [] if the repository has not
     * been initialised yet (exit code 10). Throws on other non-zero exit codes.
     */
    async snapshots(env: Record<string, string>, tag: string): Promise<ResticSnapshot[]> {
        const lines: string[] = [];
        const {exitCode, stderr} = await this.run(
            ["snapshots", "--tag", tag, "--json"],
            env,
            (l) => lines.push(l),
        );

        if (exitCode === 10) return [];
        if (exitCode !== 0) throw new Error(`restic snapshots failed: ${stderr}`);

        const json = lines.join("");
        return JSON.parse(json) as ResticSnapshot[];
    }

    /**
     * Builds the env object needed to authenticate restic against the configured
     * backend. Credentials are injected here — never on the CLI.
     */
    buildEnv(config: BackupRepoConfig): Record<string, string> {
        const base: Record<string, string> = {
            RESTIC_REPOSITORY: this.buildRepoUrl(config),
            RESTIC_PASSWORD: config.password,
        };

        if (config.repoType === "s3") {
            return {
                ...base,
                AWS_ACCESS_KEY_ID: config.s3AccessKey ?? "",
                AWS_SECRET_ACCESS_KEY: config.s3SecretKey ?? "",
            };
        }

        return base;
    }

    /** Builds the RESTIC_REPOSITORY URL string for the given backend type. */
    buildRepoUrl(config: BackupRepoConfig): string {
        if (config.repoType === "local") {
            return config.repoPath ?? "";
        }
        if (config.repoType === "sftp") {
            return `sftp:${config.sftpUser}@${config.sftpHost}:${config.repoPath ?? "/backups"}`;
        }
        // s3
        const endpoint = config.s3Endpoint ?? "s3.amazonaws.com";
        return `s3:${endpoint}/${config.s3Bucket}`;
    }

    /**
     * Checks whether the restic binary is available and returns its version.
     */
    async checkVersion(): Promise<{available: boolean; version?: string}> {
        try {
            const lines: string[] = [];
            await this.run(["version"], {}, (l) => lines.push(l));
            const versionLine = lines[0] ?? "";
            const match = versionLine.match(/restic\s+([\d.]+)/);
            return {available: true, version: match?.[1]};
        } catch {
            return {available: false};
        }
    }
}

export const resticExecutor = new ResticExecutor();
