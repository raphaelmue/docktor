import {buildApp} from "./app.js";
import {assertStacksDirMatchesHost, ensureStacksDir} from "./lib/stacks-dir.js";
import {syncDatabaseSchema} from "./lib/schema-sync.js";

// Fail fast on a misconfigured DooD stacks-path mount, then guarantee the
// managed stacks directory itself exists, before anything else starts — no
// Fastify app exists yet, so this logs to the console directly. Order
// matters: the assertion runs first, since creating a directory at a path
// already known to be wrong would materialize the stray directory the
// assertion exists to prevent.
try {
    assertStacksDirMatchesHost();
    await ensureStacksDir();
} catch (err) {
    console.error(err);
    process.exit(1);
}

// Guarded, interim schema-sync step (todo B2) — must complete before
// buildApp()/app.listen(), since app.ts's onReady hook calls startJobs(),
// which immediately touches the database. Never throws: every outcome is
// logged at a level matching its severity, and the HTTP server still comes
// up on a non-success outcome so the operator can reach the container and
// read the logs.
const schemaSyncResult = await syncDatabaseSchema();
switch (schemaSyncResult.outcome) {
    case "applied":
    case "already-current":
        console.info(
            `[schema-sync] ${schemaSyncResult.outcome}${schemaSyncResult.detail ? `: ${schemaSyncResult.detail}` : ""}`,
        );
        break;
    case "skipped":
        console.info("[schema-sync] skipped (DOCKTOR_DB_AUTO_PUSH=false)");
        break;
    case "lock-not-acquired":
        console.info("[schema-sync] lock-not-acquired — another instance is applying the schema");
        break;
    case "unreachable":
        console.error(
            `[schema-sync] unreachable (${schemaSyncResult.detail ?? "unknown host"}) — starting the server anyway; ` +
                "verify the database is reachable and DATABASE_URL is correct, then restart to apply the schema",
        );
        break;
    case "failed":
        console.error(
            `[schema-sync] failed${schemaSyncResult.detail ? `: ${schemaSyncResult.detail}` : ""} — starting the server anyway; ` +
                "resolve the schema conflict manually, or set DOCKTOR_DB_AUTO_PUSH=false to disable this step",
        );
        break;
}

const app = await buildApp();

const port = Number.parseInt(process.env.PORT ?? "3000", 10);
const host = process.env.HOST ?? "0.0.0.0";

try {
    await app.listen({port, host});
} catch (err) {
    app.log.error(err);
    process.exit(1);
}
