export class ApiError extends Error {
    constructor(
        message: string,
        public status: number,
        public fields?: Record<string, string>,
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
    // `RequestInit["headers"]` (HeadersInit) legally also accepts a Headers
    // instance or a [string, string][] tuple array, not only a plain object
    // — an `as Record<string, string>` cast on it silently produces broken
    // headers for either of those shapes (spreading a Headers instance's own
    // enumerable properties yields {}; spreading a tuple array yields
    // numeric-indexed keys). `new Headers(...)` normalizes all three shapes
    // uniformly, so build the record explicitly instead of casting.
    const headers: Record<string, string> = {};
    if (options?.headers) {
        for (const [key, value] of new Headers(options.headers).entries()) {
            headers[key] = value;
        }
    }
    const hasCallerContentType = Object.keys(headers).some(
        (key) => key.toLowerCase() === "content-type",
    );
    // A FormData body must reach fetch with no Content-Type header: the
    // browser generates one itself containing the multipart boundary.
    // Setting it manually here produces a body the server cannot parse
    // into parts — the failure looks like a missing-field error, not a
    // header problem, which is why this exclusion exists.
    if (options?.body && !(options.body instanceof FormData) && !hasCallerContentType) {
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
            body.fields,
        );
    }

    if (res.status === 204) {
        return undefined as T;
    }

    return res.json();
}
