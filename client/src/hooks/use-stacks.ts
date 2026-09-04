import {useCallback, useEffect, useState} from "react";
import {listStacks, type StackWithServices} from "@/lib/stacks-api";
import {useContainerEvents} from "@/hooks/use-container-events";

export function useStacks() {
    const [stacks, setStacks] = useState<StackWithServices[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const fetch = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const data = await listStacks();
            setStacks(data);
        } catch (err: any) {
            setError(err.message ?? "Failed to fetch stacks");
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        fetch();
    }, [fetch]);

    useContainerEvents((event) => {
        if (event.type === "container_state") {
            setStacks(prev => prev.map(stack =>
                stack.id === event.stackId
                    ? {
                        ...stack,
                        status: event.stackStatus,
                        services: stack.services.map(s =>
                            s.serviceName === event.serviceName
                                ? {...s, containerState: event.containerState, healthStatus: event.healthStatus}
                                : s
                        ),
                    }
                    : stack
            ));
        } else if (event.type === "stack_status") {
            setStacks(prev => prev.map(stack =>
                stack.id === event.stackId
                    ? {...stack, status: event.stackStatus}
                    : stack
            ));
        } else if (event.type === "config_changed" || event.type === "config_error") {
            fetch();
        }
    });

    return {stacks, loading, error, refetch: fetch};
}
