import {useCallback, useEffect, useState} from "react";
import {listStacks, type StackWithServices} from "@/lib/stacks-api";

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

    return {stacks, loading, error, refetch: fetch};
}
