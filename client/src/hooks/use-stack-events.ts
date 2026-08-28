import {useCallback, useEffect, useState} from "react";
import {getStackEvents, type StackEvent} from "@/lib/stacks-api";
import {useContainerEvents} from "@/hooks/use-container-events";

type FetchMode = "initial" | "background";

// Mirrors useStack (plan 02-14): one fetch function with an explicit
// initial-versus-background mode, so a background refresh triggered by SSE
// never re-enters the loading state or clears entries already on screen.
export function useStackEvents(stackId: string) {
    const [events, setEvents] = useState<StackEvent[] | null>(null);
    const [loading, setLoading] = useState(true);
    const [isRefreshing, setIsRefreshing] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const fetchEvents = useCallback(async (mode: FetchMode) => {
        if (mode === "initial") {
            setLoading(true);
            setError(null);
        } else {
            setIsRefreshing(true);
        }
        try {
            const data = await getStackEvents(stackId);
            setEvents(data);
        } catch (err: any) {
            if (mode === "initial") {
                setError(err.message ?? "Failed to fetch stack events");
            } else {
                console.warn("Background stack events refresh failed", err);
            }
        } finally {
            if (mode === "initial") {
                setLoading(false);
            } else {
                setIsRefreshing(false);
            }
        }
    }, [stackId]);

    const refetch = useCallback(() => {
        void fetchEvents("background");
    }, [fetchEvents]);

    useEffect(() => {
        fetchEvents("initial");
    }, [fetchEvents]);

    useContainerEvents((event) => {
        if (
            event.type !== "config_changed" &&
            event.type !== "config_error" &&
            event.type !== "update_available"
        ) {
            return;
        }
        if (event.stackId !== stackId) return;
        void fetchEvents("background");
    });

    return {events, loading, isRefreshing, error, refetch};
}
