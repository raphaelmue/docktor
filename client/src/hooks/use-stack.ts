import {useCallback, useEffect, useState} from "react";
import {toast} from "sonner";
import {getStack, type StackDetail} from "@/lib/stacks-api";
import {useContainerEvents} from "@/hooks/use-container-events";

export function useStack(id: string) {
    const [stack, setStack] = useState<StackDetail | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const fetch = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const data = await getStack(id);
            setStack(data);
        } catch (err: any) {
            setError(err.message ?? "Failed to fetch stack");
        } finally {
            setLoading(false);
        }
    }, [id]);

    useEffect(() => {
        fetch();
    }, [fetch]);

    useContainerEvents((event) => {
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
            fetch();
        } else if (event.type === "update_available") {
            fetch();
        }
    });

    return {stack, loading, error, refetch: fetch};
}
