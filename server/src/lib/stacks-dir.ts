import {access, mkdir, readFile} from "node:fs/promises";
import path from "node:path";

const MOUNTINFO_PATH = "/proc/self/mountinfo";
const DOCKERENV_PATH = "/.dockerenv";
const EPHEMERAL_FILESYSTEM_TYPES = new Set(["overlay", "overlayfs", "tmpfs", "ramfs"]);

/**
 * Checks for `/.dockerenv`, the file the Docker (and Podman, in Docker-
 * compatibility mode) container runtime creates inside every container it
 * starts. This is the only positive evidence assertStacksDirIsMounted() has
 * that the process is actually inside a container at all, as opposed to
 * running directly on a host whose root filesystem happens to have no
 * dedicated mount for the stacks path — see that function's doc comment for
 * why this check exists.
 */
async function defaultIsContainerized(): Promise<boolean> {
    try {
        await access(DOCKERENV_PATH);
        return true;
    } catch {
        return false;
    }
}

export function getStacksDir(): string {
    return path.resolve(process.env.DOCKTOR_STACKS_DIR || "./stacks");
}

/**
 * Ensures the top-level managed stacks directory exists, creating it
 * (including any missing intermediate segments) if absent. Idempotent: an
 * already-existing directory (the normal case, where the bind mount
 * attached) is left untouched and this resolves without error.
 *
 * Why this exists at all — it looks trivially redundant with the volume
 * mount declared in docker-compose.yml, and a future reader may be tempted
 * to delete it as dead weight. It is not: the application must not depend
 * on the container runtime auto-creating a missing bind-mount source.
 * Docker's short-syntax bind-mount auto-creation is legacy and best-effort,
 * not a guaranteed contract, and Docker Desktop's virtualized backends
 * (e.g. WSL2) handle a bare Linux absolute path that maps to no real host
 * location via a materially different code path than native Linux
 * dockerd's plain mkdir. That divergence is exactly how a cleanly booted
 * server ended up with no stacks directory and no error on a Windows/
 * Docker Desktop host (gap G-05.1-3). The only other directory creation in
 * this codebase — stack-filesystem.ts's createDirectory() — is per-stack
 * and on-demand; nothing else ever guarantees the top-level directory
 * exists, so this is the single place that does.
 */
export async function ensureStacksDir(): Promise<string> {
    const target = getStacksDir();
    try {
        await mkdir(target, {recursive: true});
    } catch (err) {
        throw new Error(
            `Failed to create the managed stacks directory at "${target}" — Docktor cannot manage any stack without it. Check whether the stacks volume in docker-compose.yml is actually mounted, and whether DOCKTOR_STACKS_DIR/DOCKTOR_STACKS_HOST_DIR point at a path this container can write to.`,
            {cause: err},
        );
    }
    return target;
}

/**
 * Joins the stacks directory with a stack id and asserts the result stays
 * under that directory. Stack ids are slugify()'d at creation time
 * (StackService.createStack), which is what actually keeps `..` out of the
 * joined path — this is defense-in-depth so the guarantee is enforced here
 * too, at the path layer, rather than solely upstream at slug time.
 */
export function getStackPath(id: string): string {
    const stacksDir = getStacksDir();
    const resolved = path.join(stacksDir, id);
    if (!resolved.startsWith(stacksDir + path.sep)) {
        throw new Error(
            `Stack id "${id}" resolves outside the managed stacks directory (${resolved} is not under ${stacksDir}) — refusing to use it as a stack path`,
        );
    }
    return resolved;
}

export function getComposePath(id: string): string {
    return path.join(getStackPath(id), "docker-compose.yml");
}

export function getEnvPath(id: string): string {
    return path.join(getStackPath(id), ".env");
}

/**
 * Verifies that the host-side path of the stacks directory volume mount
 * (DOCKTOR_STACKS_HOST_DIR) matches the container-side path Docktor itself
 * resolves (getStacksDir(), driven by DOCKTOR_STACKS_DIR). Docktor runs
 * Docker-outside-of-Docker: `docker compose` inside this container resolves
 * relative bind mounts declared in a managed stack's compose file against
 * its own filesystem view, then sends the resulting absolute path to the
 * *host's* Docker daemon over the mounted socket. If the two paths differ,
 * the host daemon silently creates directories at a path that does not
 * exist inside this container, misplacing every relative-volume stack's
 * data (see .planning/todos/pending/2026-08-28-dood-bind-mount-path-mismatch.md).
 *
 * When DOCKTOR_STACKS_HOST_DIR is unset, this only warns and returns rather
 * than throwing — an operator running Docktor outside of Docker (e.g. a dev
 * setup where DooD does not apply) has no host-side path to compare
 * against and must not be blocked at startup.
 */
export function assertStacksDirMatchesHost(): void {
    const hostDir = process.env.DOCKTOR_STACKS_HOST_DIR;
    const containerDir = getStacksDir();

    if (!hostDir) {
        console.warn(
            `[stacks-dir] DOCKTOR_STACKS_HOST_DIR is not set — cannot verify that the host-side stacks path matches the container-side path (${containerDir}). If Docktor is running Docker-outside-of-Docker, relative bind mounts in managed stacks will be written to the wrong host location unless the two are actually identical. Set DOCKTOR_STACKS_HOST_DIR to the host path of the stacks volume mount to enable this check.`,
        );
        return;
    }

    const normalizedHostDir = path.resolve(hostDir);
    if (normalizedHostDir !== containerDir) {
        throw new Error(
            `Stacks directory path mismatch: DOCKTOR_STACKS_HOST_DIR ("${normalizedHostDir}") does not match the container-side DOCKTOR_STACKS_DIR ("${containerDir}"). Docktor runs Docker-outside-of-Docker — the stacks directory must be mounted at the identical absolute path on both the host and inside this container, or relative bind mounts declared in managed stacks' compose files will be written to the wrong host location. Fix docker-compose.yml so DOCKTOR_STACKS_HOST_DIR drives both sides of the stacks volume mapping and matches DOCKTOR_STACKS_DIR.`,
        );
    }
}

/**
 * A single parsed entry from /proc/self/mountinfo: the mount point path and
 * the filesystem type backing it.
 */
export interface MountEntry {
    readonly mountPoint: string;
    readonly filesystemType: string;
}

/**
 * Finds the mountinfo entry that covers a resolved filesystem path — either
 * an exact match on the mount point, or the deepest mounted ancestor
 * directory. Every path on a Linux system is covered by exactly one mount
 * namespace entry once you walk up to "/", so this never legitimately
 * returns null for a well-formed mountinfo listing; null is reserved for the
 * "could not determine" case (malformed/empty content), which callers must
 * treat as "cannot verify" rather than "not mounted".
 *
 * Per man 5 proc's "mountinfo" section, field index 4 (0-based) is always
 * the mount point, but the filesystem type's index is NOT fixed — it sits
 * immediately after a literal "-" separator, and the number of optional
 * fields before that separator varies per line. Locating the type via
 * `indexOf("-")` rather than a hardcoded index is required for correctness
 * (see 07-RESEARCH.md Assumptions Log A2).
 *
 * Malformed lines (too few fields, no "-" separator, nothing after it) are
 * skipped rather than thrown on — a single corrupt line must not make this
 * function unusable for every other line in the file.
 *
 * The ancestor-boundary check below always uses a literal "/" rather than
 * `path.sep`: every mount point this function ever sees originates from
 * /proc/self/mountinfo, which is exclusively POSIX-formatted (Linux has no
 * concept of a platform-native separator), regardless of which OS the
 * *caller* happens to run on. Using `path.sep` here made this function
 * silently stop matching any deeper-than-root mount point whenever it ran
 * on a win32 host (e.g. this codebase's own Windows CI unit-test job),
 * since `path.sep` is `"\\"` there — a corrupt-looking bug for a value
 * that has nothing to do with the host OS's path conventions at all.
 */
export function findMountEntryForPath(
    resolvedPath: string,
    mountinfoContent: string,
): MountEntry | null {
    let best: MountEntry | null = null;

    for (const line of mountinfoContent.split("\n")) {
        if (!line.trim()) continue;

        const fields = line.split(" ");
        if (fields.length < 5) continue;

        const separatorIndex = fields.indexOf("-");
        if (separatorIndex === -1 || !fields[separatorIndex + 1]) continue;

        const mountPoint = unescapeMountinfoField(fields[4] ?? "");
        const filesystemType = fields[separatorIndex + 1];
        if (!mountPoint) continue;

        const covers =
            mountPoint === resolvedPath ||
            (mountPoint === "/" && resolvedPath.startsWith("/")) ||
            resolvedPath.startsWith(mountPoint + "/");
        if (!covers) continue;

        if (!best || mountPoint.length > best.mountPoint.length) {
            best = {mountPoint, filesystemType};
        }
    }

    return best;
}

/**
 * Converts a resolved stacks-directory path into the POSIX-only comparable
 * form /proc/self/mountinfo entries are always expressed in, before handing
 * it to findMountEntryForPath(). This is a genuine no-op everywhere Docktor
 * actually runs in production — the server only ever executes inside a
 * Linux container, so `process.platform` is never "win32" there. It exists
 * purely because this module's unit tests inject a Linux-format mountinfo
 * fixture directly (bypassing the real /proc read, which callers can't
 * reach on a non-Linux host), and that fixture-matching logic also runs on
 * this codebase's windows-latest CI job: node's native, host-OS-aware
 * `path.resolve()` (used by getStacksDir()) turns a POSIX-style env value
 * like "/opt/docktor/stacks" into a drive-qualified, backslash-separated
 * path such as "D:\opt\docktor\stacks" on win32, which could never
 * structurally match any forward-slash mountinfo entry without this
 * conversion.
 */
function toMountinfoComparablePath(target: string): string {
    if (process.platform !== "win32") return target;
    return target.replace(/\\/g, "/").replace(/^[A-Za-z]:/, "");
}

/**
 * Un-escapes the octal sequences /proc/self/mountinfo uses for characters
 * that cannot appear raw in its space-delimited text format — space
 * (\040), tab (\011), newline (\012), and backslash (\134) itself (man 5
 * proc). Without this, a mount point containing a space (e.g.
 * "/opt/my stacks") is reported as "/opt/my\040stacks" and never matches
 * the real path, silently producing a false "not mounted" result.
 */
function unescapeMountinfoField(field: string): string {
    return field.replace(/\\([0-7]{3})/g, (_match, oct: string) =>
        String.fromCharCode(Number.parseInt(oct, 8)),
    );
}

/**
 * Verifies that the resolved stacks directory is backed by a real,
 * persistent mount rather than a plain directory ensureStacksDir()'s mkdir
 * happened to create inside this container's own writable overlay layer.
 * mkdir succeeding proves the directory exists; it proves nothing about
 * whether it survives container recreation — a bind mount that never
 * attached leaves mkdir with nothing to do but create an ordinary directory
 * in the overlay layer, which looks identical to a real mount until the
 * container is recreated and everything written there vanishes with no
 * prior error.
 *
 * Detection reads /proc/self/mountinfo (kernel-documented, stable ABI) and
 * inspects the nearest covering mount's filesystem type. This is the only
 * reliable signal available: an st.dev (device-number) comparison — the
 * classic Unix mountpoint idiom — has a documented false-negative class for
 * bind mounts on the same underlying filesystem as their parent, and a
 * marker-file-on-first-boot approach is circular, since the marker itself
 * would be silently lost in exactly the failure case it exists to detect.
 *
 * Fails only on positive evidence of ephemerality (decision PD-3): an
 * unreadable /proc/self/mountinfo, or no covering entry at all, means this
 * check cannot verify anything and must never brick an otherwise-working
 * deployment — those cases warn once (matching assertStacksDirMatchesHost()'s
 * warn-and-return shape) and return rather than throwing. The check itself
 * can also be deliberately disabled via DOCKTOR_STACKS_MOUNT_CHECK=false,
 * which likewise warns and returns rather than throwing.
 *
 * Ephemerality is judged two ways: the covering mount's filesystem type is
 * one of EPHEMERAL_FILESYSTEM_TYPES, OR the covering mount is the
 * container's own root ("/") while DOCKTOR_STACKS_HOST_DIR is set AND the
 * process can positively confirm it is actually running inside a container
 * (via `/.dockerenv` — see isContainerized). The second clause matters
 * because a deployment that sets DOCKTOR_STACKS_HOST_DIR has declared itself
 * the containerized Docker-outside-of-Docker deployment, where the stacks
 * volume must appear as a mount of its own — without this clause, a
 * btrfs/zfs/xfs container root (a non-overlay storage driver) would slip
 * past the filesystem-type test even though the volume never actually
 * attached. The containerization guard on top of that exists because
 * "root mount + DOCKTOR_STACKS_HOST_DIR set" alone is indistinguishable from
 * an entirely ordinary bare-metal/VM deployment with a single-partition
 * Linux layout and no separate mount for the stacks path — without positive
 * evidence of actually being inside a container, that combination is not
 * evidence of ephemerality at all, and treating it as such previously bricked
 * exactly that layout (07-VERIFICATION.md gap).
 *
 * The optional `readMountinfo` and `isContainerized` parameters (default:
 * read the real /proc/self/mountinfo, and check for a real /.dockerenv)
 * exist purely for testability — unit tests inject fixture content /
 * fixed booleans instead of mocking node:fs/promises, since this module is
 * also imported by tests exercising the real filesystem via
 * mkdir/mkdtemp/rm/stat/writeFile, which a module-level fs mock would break.
 */
export async function assertStacksDirIsMounted(
    readMountinfo: () => Promise<string> = () => readFile(MOUNTINFO_PATH, "utf-8"),
    isContainerized: () => Promise<boolean> = defaultIsContainerized,
): Promise<void> {
    const target = getStacksDir();

    if (process.env.DOCKTOR_STACKS_MOUNT_CHECK === "false") {
        console.warn(
            `[stacks-dir] DOCKTOR_STACKS_MOUNT_CHECK=false — skipping the persistence check for "${target}". If the stacks volume is not actually mounted, everything written there will be silently lost on the next container recreation.`,
        );
        return;
    }

    let content: string;
    try {
        content = await readMountinfo();
    } catch (err) {
        console.warn(
            `[stacks-dir] Could not read /proc/self/mountinfo — persistence of the stacks directory at "${target}" could not be verified. This is expected on a non-Linux host; on Linux it may indicate a hardened runtime restricting /proc access.`,
            err,
        );
        return;
    }

    const entry = findMountEntryForPath(toMountinfoComparablePath(target), content);
    if (!entry) {
        console.warn(
            `[stacks-dir] No mount entry covering the stacks directory at "${target}" was found — persistence could not be verified.`,
        );
        return;
    }

    const hostDir = process.env.DOCKTOR_STACKS_HOST_DIR;
    const isContainerRootWithHostDir =
        entry.mountPoint === "/" && !!hostDir && (await isContainerized());
    const isEphemeral =
        EPHEMERAL_FILESYSTEM_TYPES.has(entry.filesystemType) || isContainerRootWithHostDir;

    if (isEphemeral) {
        throw new Error(
            `Stacks directory at "${target}" is not on a persistent filesystem: the nearest covering mount ("${entry.mountPoint}") is of type "${entry.filesystemType}", which does not survive container recreation. Everything Docktor writes there — each managed stack's docker-compose.yml, .env, and relative bind-mount data — will be silently discarded the next time this container is recreated by an image update, a "docker compose up", or a host reboot. Mount the stacks directory into the container at exactly this path: docker-compose.yml's stacks volume is driven by DOCKTOR_STACKS_HOST_DIR, which must equal DOCKTOR_STACKS_DIR. If running on ephemeral storage is deliberate, set DOCKTOR_STACKS_MOUNT_CHECK=false to downgrade this to a warning.`,
        );
    }
}
