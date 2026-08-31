import {useEffect, useState} from "react";
import {checkSetupStatus} from "@/lib/setup-api";

export type SetupStatusState = "idle" | "loading" | "incomplete" | "complete" | "error";

/**
 * Owns the `GET /api/setup/status` server state for the first-run gate.
 *
 * When `enabled` is false the check never runs and the hook stays "idle" —
 * used by callers (e.g. an already-authenticated session) that must never
 * trigger the setup-status request at all.
 */
export function useSetupStatus(enabled: boolean): SetupStatusState {
    const [state, setState] = useState<SetupStatusState>("idle");

    useEffect(() => {
        let cancelled = false;

        if (!enabled) {
            setState("idle");
            return;
        }

        setState("loading");
        checkSetupStatus()
            .then((status) => {
                if (cancelled) {
                    return;
                }
                setState(status.setupComplete ? "complete" : "incomplete");
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
