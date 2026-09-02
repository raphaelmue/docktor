import {execFile} from "node:child_process";
import {existsSync} from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {promisify} from "node:util";
// A raw `pg` client is used here purely to hold a Postgres advisory lock and
// probe reachability before the schema exists — `lib/db.ts`'s Prisma Proxy
// must not be touched this early (see server/src/lib/db.ts), and this is not
// a repository-owned domain query, so a direct `pg` connection confined to
// `lib/` is consistent with CLAUDE.md's Prisma-access rule.
import {Client} from "pg";

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

export type SchemaSyncOutcome =
    | "skipped"
    | "unreachable"
    | "lock-not-acquired"
    | "already-current"
    | "applied"
    | "failed";

export interface SchemaSyncResult {
    outcome: SchemaSyncOutcome;
    detail?: string;
}

export interface CliRunResult {
    code: number;
    stdout: string;
    stderr: string;
}

export type RunCliFn = (argv: string[]) => Promise<CliRunResult>;

export type LockAcquisitionResult =
    | {status: "unreachable"; host: string; port: string}
    | {status: "not-acquired"}
    | {status: "acquired"; release: () => Promise<void>};

export type AcquireLockFn = () => Promise<LockAcquisitionResult>;

export interface SchemaSyncDeps {
    runCli?: RunCliFn;
    acquireLock?: AcquireLockFn;
}

// Fixed, application-chosen Postgres advisory-lock key (session-level,
// non-blocking try-variant). Any int works as long as it's stable and not
// reused elsewhere in the codebase — this is the only advisory lock Docktor
// takes.
const ADVISORY_LOCK_KEY = 875_142_001;

// A handful of attempts over roughly thirty seconds — the compose file
// already gates container start on `db: condition: service_healthy`, so this
// only needs to cover the residual race, not act as the primary readiness
// check.
const REACHABILITY_RETRY_ATTEMPTS = 6;
const REACHABILITY_RETRY_DELAY_MS = 5_000;
const REACHABILITY_CONNECT_TIMEOUT_MS = 5_000;

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Parses only the host and port out of DATABASE_URL for logging. Never logs
 * the full connection string — it carries the database password (T-05.1-23).
 */
function parseHostPort(databaseUrl: string | undefined): {host: string; port: string} {
    if (!databaseUrl) return {host: "unknown", port: "unknown"};
    try {
        const url = new URL(databaseUrl);
        return {host: url.hostname || "unknown", port: url.port || "5432"};
    } catch {
        return {host: "unknown", port: "unknown"};
    }
}

/**
 * Resolves the Prisma CLI binary path from this module's own location, not
 * the process working directory. The container's CMD runs from /app while
 * the compiled module lives under /app/dist/server/lib — three directories
 * up from there lands on /app either way (dev: server/src/lib is also three
 * segments below the repo root), so a single relative path resolves
 * correctly in both the dev (tsx, run from source) and built-image contexts.
 */
function resolvePrismaBin(): string {
    return path.resolve(__dirname, "../../../node_modules/.bin/prisma");
}

/**
 * Resolves server/prisma/prisma.config.ts from this module's own location.
 * Unlike the CLI binary, the correct relative distance differs between dev
 * (this module runs directly from server/src/lib, two directories under
 * server/) and the built image (the compiled module runs from
 * /app/dist/server/lib, while server/prisma/ is copied to a sibling
 * /app/server/prisma, three directories up with a "server/" segment) —
 * mirrors server/test/integration/setup.ts's resolution approach, extended
 * with a filesystem check for the layout that setup.ts never needs to
 * handle: setup.ts always runs from source, this module runs from both.
 */
function resolvePrismaConfigPath(): string {
    const candidates = [
        path.resolve(__dirname, "../../prisma/prisma.config.ts"),
        path.resolve(__dirname, "../../../server/prisma/prisma.config.ts"),
    ];
    const found = candidates.find((candidate) => existsSync(candidate));
    if (!found) {
        throw new Error(
            `schema-sync: could not resolve server/prisma/prisma.config.ts — tried: ${candidates.join(", ")}`,
        );
    }
    return found;
}

/**
 * Builds the Prisma CLI argv as an array — never a shell string (T-05.1-24) —
 * containing only the push subcommand and --config. Must never include a
 * data-loss-acceptance flag or a reset flag (T-05.1-20): if the push would
 * drop data, the CLI's own non-interactive refusal (non-zero exit) is the
 * correct outcome, surfaced as a "failed" result rather than silently forced
 * through.
 */
function buildArgv(): string[] {
    return ["db", "push", `--config=${resolvePrismaConfigPath()}`, "--skip-generate"];
}

const defaultRunCli: RunCliFn = async (argv) => {
    const prismaBin = resolvePrismaBin();
    try {
        const {stdout, stderr} = await execFileAsync(prismaBin, argv, {
            env: process.env,
            maxBuffer: 10 * 1024 * 1024,
        });
        return {code: 0, stdout, stderr};
    } catch (err) {
        const execErr = err as NodeJS.ErrnoException & {
            code?: number;
            stdout?: string;
            stderr?: string;
        };
        return {
            code: typeof execErr.code === "number" ? execErr.code : 1,
            stdout: execErr.stdout ?? "",
            stderr: execErr.stderr ?? String(execErr.message ?? err),
        };
    }
};

async function connectWithRetry(): Promise<Client | null> {
    const connectionString = process.env.DATABASE_URL;
    for (let attempt = 1; attempt <= REACHABILITY_RETRY_ATTEMPTS; attempt++) {
        const client = new Client({connectionString, connectionTimeoutMillis: REACHABILITY_CONNECT_TIMEOUT_MS});
        try {
            await client.connect();
            return client;
        } catch {
            await client.end().catch(() => {});
            if (attempt < REACHABILITY_RETRY_ATTEMPTS) {
                await sleep(REACHABILITY_RETRY_DELAY_MS);
            }
        }
    }
    return null;
}

const defaultAcquireLock: AcquireLockFn = async () => {
    const {host, port} = parseHostPort(process.env.DATABASE_URL);
    const client = await connectWithRetry();
    if (!client) {
        return {status: "unreachable", host, port};
    }

    try {
        const result = await client.query<{locked: boolean}>(
            "SELECT pg_try_advisory_lock($1) AS locked",
            [ADVISORY_LOCK_KEY],
        );
        const locked = result.rows[0]?.locked === true;
        if (!locked) {
            await client.end().catch(() => {});
            return {status: "not-acquired"};
        }

        return {
            status: "acquired",
            release: async () => {
                try {
                    await client.query("SELECT pg_advisory_unlock($1)", [ADVISORY_LOCK_KEY]);
                } finally {
                    await client.end().catch(() => {});
                }
            },
        };
    } catch {
        await client.end().catch(() => {});
        return {status: "unreachable", host, port};
    }
};

/**
 * Guarded startup schema-synchronisation step (todo B2). Applies the current
 * Prisma schema via `prisma db push` before the server starts serving
 * requests, gated by four guards: an opt-out env var, a bounded reachability
 * retry budget, a non-blocking Postgres advisory lock (so two instances
 * starting against one database never both apply the schema), and an argv
 * that can never accept data loss or trigger a reset. Never throws — every
 * failure mode resolves to a discriminated outcome so the HTTP server can
 * still come up and the operator can read the logs.
 *
 * Interim fix only: this project deliberately stays on schemaless
 * `prisma db push` until the MVP milestone completes (see the
 * "adopt prisma <formal-migrations command> post-mvp" todo under
 * .planning/todos/pending/) — do not adopt that formal-migrations command
 * here.
 */
export async function syncDatabaseSchema(deps: SchemaSyncDeps = {}): Promise<SchemaSyncResult> {
    if (process.env.DOCKTOR_DB_AUTO_PUSH === "false") {
        return {outcome: "skipped", detail: "DOCKTOR_DB_AUTO_PUSH=false"};
    }

    const runCli = deps.runCli ?? defaultRunCli;
    const acquireLock = deps.acquireLock ?? defaultAcquireLock;

    try {
        const lockResult = await acquireLock();

        if (lockResult.status === "unreachable") {
            console.error(
                `[schema-sync] database unreachable at ${lockResult.host}:${lockResult.port} after retry budget exhausted — skipping schema sync; the server will still start`,
            );
            return {outcome: "unreachable", detail: `${lockResult.host}:${lockResult.port}`};
        }

        if (lockResult.status === "not-acquired") {
            return {outcome: "lock-not-acquired", detail: "another instance holds the schema-sync advisory lock"};
        }

        try {
            const argv = buildArgv();
            const cliResult = await runCli(argv);
            const combinedOutput = `${cliResult.stdout}\n${cliResult.stderr}`.trim();

            if (cliResult.code !== 0) {
                console.error(
                    `[schema-sync] prisma db push failed (exit ${cliResult.code}) — resolve the schema conflict manually:\n${cliResult.stderr}`,
                );
                return {outcome: "failed", detail: cliResult.stderr || combinedOutput};
            }

            if (/already in sync/i.test(combinedOutput)) {
                return {outcome: "already-current", detail: combinedOutput};
            }

            return {outcome: "applied", detail: combinedOutput};
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            console.error(`[schema-sync] prisma db push threw before completing: ${message}`);
            return {outcome: "failed", detail: message};
        } finally {
            await lockResult.release();
        }
    } catch (err) {
        // Defense in depth: syncDatabaseSchema must never throw, regardless
        // of an unexpected failure in a collaborator (T-05.1-22).
        const message = err instanceof Error ? err.message : String(err);
        console.error(`[schema-sync] unexpected error: ${message}`);
        return {outcome: "failed", detail: message};
    }
}
