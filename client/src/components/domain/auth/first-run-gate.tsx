import {Navigate} from "react-router";
import {useSetupStatus} from "@/hooks/use-setup-status";

export interface FirstRunGateProps {
    children: React.ReactNode;
}

/**
 * Diverts a session-less visitor to `/setup` when the instance has no users
 * yet. The navigation target is always the hardcoded literal below — never a
 * value read from the setup-status response body, which would open a
 * server-controlled redirect surface.
 */
export function FirstRunGate({children}: Readonly<FirstRunGateProps>): React.JSX.Element {
    const status = useSetupStatus(true);

    if (status === "idle" || status === "loading") {
        return (
            <div className="flex min-h-screen items-center justify-center">
                <p className="text-gray-500">Loading...</p>
            </div>
        );
    }

    if (status === "incomplete") {
        return <Navigate to="/setup" replace />;
    }

    // "complete" and "error" both fall through to the caller's normal
    // unauthenticated handling. A failed status check must never surface the
    // account-creation wizard just because of a transient outage on an
    // instance that already has an admin.
    return <>{children}</>;
}
