import {useEffect, useState} from "react";
import {checkSetupStatus} from "@/lib/setup-api";

export type SetupStatusState = "idle" | "loading" | "incomplete" | "complete" | "error";

type ResolvedSetupStatusState = Exclude<SetupStatusState, "idle" | "loading">;

/**
 * Module-level cache for the `GET /api/setup/status` result. `FirstRunGate`
 * can mount many times over the life of a single page load (e.g. every
 * unauthenticated redirect through `ProtectedRoute`); without this cache
 * each mount re-fires the request and re-enters "loading", flashing the
 * loading shell even though the instance's setup state cannot have changed
 * within the same session. The cache is intentionally module-scoped rather
 * than persisted anywhere — a full page reload (which is required to reach
 * a genuinely different setup state, e.g. right after finishing the wizard)
 * naturally clears it.
 */
let cachedPromise: Promise<ResolvedSetupStatusState> | null = null;
let cachedResult: ResolvedSetupStatusState | null = null;

function getSetupStatus(): Promise<ResolvedSetupStatusState> {
    if (cachedResult !== null) {
        return Promise.resolve(cachedResult);
    }

    if (!cachedPromise) {
        cachedPromise = checkSetupStatus()
            .then((status) => {
                const resolved: ResolvedSetupStatusState = status.setupComplete ? "complete" : "incomplete";
                cachedResult = resolved;
                return resolved;
            })
            .catch((error: unknown) => {
                // Do not cache failures — a transient outage should not
                // permanently wedge every future first-run check into
                // "error" for the rest of the page session; the next
                // mount gets to retry the request.
                cachedPromise = null;
                throw error;
            });
    }

    return cachedPromise;
}

/**
 * Resets the module-level setup-status cache. Exported solely for tests —
 * production code has no legitimate reason to invalidate the cache mid
 * page-session (a real change in setup state requires a page reload).
 */
export function resetSetupStatusCacheForTests(): void {
    cachedPromise = null;
    cachedResult = null;
}

/**
 * Owns the `GET /api/setup/status` server state for the first-run gate.
 *
 * When `enabled` is false the check never runs and the hook stays "idle" —
 * used by callers (e.g. an already-authenticated session) that must never
 * trigger the setup-status request at all.
 *
 * The underlying request/result is cached at module scope (see
 * `getSetupStatus` above), so repeated mounts within the same page session
 * reuse the first resolved value instead of re-fetching and re-flashing a
 * loading shell.
 */
export function useSetupStatus(enabled: boolean): SetupStatusState {
    const [state, setState] = useState<SetupStatusState>(() => {
        if (!enabled) {
            return "idle";
        }
        return cachedResult ?? "loading";
    });

    useEffect(() => {
        let cancelled = false;

        if (!enabled) {
            setState("idle");
            return;
        }

        if (cachedResult !== null) {
            setState(cachedResult);
            return;
        }

        setState("loading");
        getSetupStatus()
            .then((resolved) => {
                if (cancelled) {
                    return;
                }
                setState(resolved);
            })
            .catch(() => {
                if (cancelled) {
                    return;
                }
                setState("error");
            });

        return () => {
            cancelled = true;
        };
    }, [enabled]);

    return state;
}
