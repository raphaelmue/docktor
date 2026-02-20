export class ApiError extends Error {
    constructor(
        message: string,
        public status: number,
    ) {
        super(message);
        this.name = "ApiError";
    }
}

const BASE =
    globalThis.location.port === "5173" ? "http://localhost:3000" : "";

export async function apiFetch<T>(
    path: string,
    options?: RequestInit,
): Promise<T> {
    const headers: Record<string, string> = {
        ...options?.headers as Record<string, string>,
    };
    if (options?.body) {
        headers["Content-Type"] = "application/json";
    }

    const res = await fetch(`${BASE}${path}`, {
        credentials: "include",
        ...options,
        headers,
    });

    if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new ApiError(
            body.error ?? `Request failed with status ${res.status}`,
            res.status,
        );
    }

    if (res.status === 204) {
        return undefined as T;
    }

    return res.json();
}
