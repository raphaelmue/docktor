import {createRequire} from "node:module";

const moduleRequire = createRequire(import.meta.url);

/**
 * Resolves the Prisma CLI's JS entrypoint via Node module resolution and
 * returns an absolute, executable path to it.
 *
 * WHY THIS EXISTS (do not "simplify" this back to a hardcoded `.bin` path):
 *
 * Package managers using the node-modules linker (this repo's
 * `nodeLinker: node-modules`) generate, on POSIX, a symlink at
 * `node_modules/.bin/prisma` pointing at a shebang-prefixed JS file, which
 * the kernel execs transparently — no shell needed. On native Windows, the
 * same linker convention instead generates `.cmd`/`.ps1` shim files, so an
 * extensionless path into that generated `.bin` directory is not launchable
 * by Windows' native process creation. That platform divergence is exactly
 * what produced a `spawnSync ... ENOENT` on a native-Windows contributor
 * machine while CI (Linux-only) stayed green.
 *
 * Node's own binary (`process.execPath`) is a real executable on every
 * platform, so handing it this resolved JS entrypoint removes the
 * divergence entirely, with no shell and no platform branch.
 *
 * CALLER CONTRACT: callers MUST invoke this as
 * `execFile(process.execPath, [resolvePrismaCliEntrypoint(), ...argv])` (or
 * the sync/promisified equivalent) and MUST NOT pass a `shell` option —
 * passing the CLI path as a shell-interpolated string would reopen the
 * metacharacter-injection risk that T-05.1-02 and T-05.1-24 were written to
 * close.
 */
export function resolvePrismaCliEntrypoint(): string {
    try {
        return moduleRequire.resolve("prisma/build/index.js");
    } catch (err) {
        throw new Error(
            "resolvePrismaCliEntrypoint(): could not resolve module specifier " +
                '"prisma/build/index.js" — the `prisma` dependency install is missing or ' +
                "incomplete (run `yarn install`).",
            {cause: err},
        );
    }
}
