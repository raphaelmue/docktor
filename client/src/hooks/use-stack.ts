import {useCallback, useEffect, useState} from "react";
import {toast} from "sonner";
import {getStack, type StackDetail} from "@/lib/stacks-api";
import {useContainerEvents} from "@/hooks/use-container-events";

type FetchMode = "initial" | "background";

export function useStack(id: string) {
    const [stack, setStack] = useState<StackDetail | null>(null);
    const [loading, setLoading] = useState(true);
    const [isRefreshing, setIsRefreshing] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // A background refresh (SSE-triggered or refetch()) sets isRefreshing and must
    // never touch `loading` or `error` — those flags drive the page's
    // placeholder/error early returns, which swap out the whole mounted tree.
    // Only the initial load may set them.
    const fetchStack = useCallback(async (mode: FetchMode) => {
        if (mode === "initial") {
            setLoading(true);
            setError(null);
        } else {
            setIsRefreshing(true);
        }
        try {
            const data = await getStack(id);
            setStack(data);
        } catch (err: any) {
            if (mode === "initial") {
                setError(err.message ?? "Failed to fetch stack");
            } else {
                console.warn("Background stack refresh failed", err);
            }
        } finally {
            if (mode === "initial") {
                setLoading(false);
            } else {
                setIsRefreshing(false);
            }
        }
    }, [id]);

    const refetch = useCallback(() => {
        void fetchStack("background");
    }, [fetchStack]);

    useEffect(() => {
        fetchStack("initial");
    }, [fetchStack]);

    useContainerEvents((event) => {
        if (event.type === "notification_created") return;
        if (event.stackId !== id) return;
        if (event.type === "container_state") {
            setStack(prev => {
                if (!prev) return prev;
                const updated = {
                    ...prev,
                    status: event.stackStatus,
                    services: prev.services.map(s =>
                        s.serviceName === event.serviceName
                            ? {...s, containerState: event.containerState, healthStatus: event.healthStatus}
                            : s
                    ),
                };
                // Add new status log to the beginning of the list if present
                if (event.statusLog) {
                    updated.statusLogs = [event.statusLog, ...prev.statusLogs];
                }
                return updated;
            });
        } else if (event.type === "stack_status") {
            setStack(prev => {
                if (!prev) return prev;
                return {...prev, status: event.stackStatus};
            });
        } else if (event.type === "config_changed") {
            toast.info('Configuration file changed externally');
            void fetchStack("background");
        } else if (event.type === "update_available") {
            void fetchStack("background");
        }
    });

    return {stack, loading, isRefreshing, error, refetch};
}
