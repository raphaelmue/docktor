import {useCallback, useEffect, useState} from "react";
import {getStack, type StackDetail} from "@/lib/stacks-api";

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

    return {stack, loading, error, refetch: fetch};
}
