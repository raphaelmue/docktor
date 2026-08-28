import {AppError} from "../lib/errors.js"
import {splitImageRef} from "../jobs/update-checker.js"

const REQUEST_TIMEOUT_MS = 15_000
const MAX_BODY_BYTES = 2 * 1024 * 1024 // ~2 MB
const MOVING_TAG_HOST_FALLBACK = "registry-1.docker.io"

/**
 * Thrown when the registry cannot be reached or refuses to answer — a
 * rate limit (429) or a persistent authentication failure (401 even after
 * a bearer-token retry). Callers record this as a checkError and must not
 * let it abort the wider staggered check tick.
 */
export class RegistryUnavailableError extends AppError {
    constructor(imageRef: string, reason: string, options?: {cause?: unknown}) {
        super(`Registry unavailable for ${imageRef}: ${reason}`, 502)
        if (options?.cause !== undefined) {
            this.cause = options.cause
        }
    }
}

interface RegistryTarget {
    host: string
    repository: string
}

/**
 * Derives the registry host and repository path from an already
 * tag-stripped image name. Docker Hub images with no explicit host (no dot
 * in the first path segment, and not "localhost") resolve to
 * registry-1.docker.io, with single-segment names implicitly prefixed with
 * "library/" (Docker's own default for official images).
 */
function resolveRegistryTarget(name: string): RegistryTarget {
    const firstSlash = name.indexOf("/")
    if (firstSlash === -1) {
        return {host: MOVING_TAG_HOST_FALLBACK, repository: `library/${name}`}
    }

    const firstSegment = name.slice(0, firstSlash)
    const looksLikeHost = firstSegment.includes(".") || firstSegment === "localhost" || firstSegment.includes(":")
    if (!looksLikeHost) {
        // Namespaced Docker Hub image (e.g. "someuser/somerepo") — the
        // namespace already stands in for "library/", no prefix needed.
        return {host: MOVING_TAG_HOST_FALLBACK, repository: name}
    }

    return {host: firstSegment, repository: name.slice(firstSlash + 1)}
}

/** Syntactically valid host (with optional port) — no scheme, no path, no credentials. */
function isValidHost(host: string): boolean {
    return /^[a-zA-Z0-9.-]+(:\d+)?$/.test(host)
}

interface AuthChallenge {
    realm: string
    service?: string
    scope?: string
}

function parseWwwAuthenticate(header: string): AuthChallenge | null {
    const match = /^Bearer\s+(.+)$/i.exec(header.trim())
    if (!match) return null

    const params: Record<string, string> = {}
    // Matches key="value" pairs, comma-separated per RFC 7235 auth-param syntax.
    const paramPattern = /(\w+)="([^"]*)"/g
    let m: RegExpExecArray | null
    while ((m = paramPattern.exec(match[1])) !== null) {
        params[m[1]] = m[2]
    }

    if (!params.realm) return null
    return {realm: params.realm, service: params.service, scope: params.scope}
}

async function readBoundedBody(response: Response): Promise<string | null> {
    const text = await response.text()
    if (text.length > MAX_BODY_BYTES) {
        console.warn(`[RegistryClient] response body exceeded ${MAX_BODY_BYTES} bytes, abandoning parse`)
        return null
    }
    return text
}

export class RegistryClient {
    private async fetchToken(challenge: AuthChallenge, host: string): Promise<string | null> {
        const realmUrl = new URL(challenge.realm)
        if (realmUrl.protocol !== "https:") {
            console.warn(`[RegistryClient] refusing non-HTTPS token realm for ${host}: ${challenge.realm}`)
            return null
        }
        if (challenge.service) realmUrl.searchParams.set("service", challenge.service)
        if (challenge.scope) realmUrl.searchParams.set("scope", challenge.scope)

        const res = await fetch(realmUrl.toString(), {
            signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
            redirect: "error",
        })
        if (!res.ok) return null

        const body = await readBoundedBody(res)
        if (!body) return null

        try {
            const parsed = JSON.parse(body) as {token?: string; access_token?: string}
            return parsed.token ?? parsed.access_token ?? null
        } catch {
            return null
        }
    }

    private async requestTagsList(
        host: string,
        repository: string,
        token: string | null,
    ): Promise<Response> {
        const url = `https://${host}/v2/${repository}/tags/list?n=100`
        const headers: Record<string, string> = {}
        if (token) headers.Authorization = `Bearer ${token}`

        return fetch(url, {
            headers,
            signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
            redirect: "error",
        })
    }

    /**
     * Lists tags for an image reference over the standard Registry v2 API.
     * Returns null for outcomes that are a normal "nothing to report"
     * (repository not found, unusable body) and throws
     * RegistryUnavailableError for outcomes the caller must record as a
     * checkError (rate limit, persistent auth failure).
     */
    async listTags(imageRef: string): Promise<string[] | null> {
        const {name} = splitImageRef(imageRef)

        const {host, repository} = resolveRegistryTarget(name)
        if (!isValidHost(host)) {
            console.warn(`[RegistryClient] rejecting invalid host derived from ${imageRef}: ${host}`)
            return null
        }

        let response: Response
        try {
            response = await this.requestTagsList(host, repository, null)
        } catch (err) {
            throw new RegistryUnavailableError(imageRef, "request failed", {cause: err})
        }

        if (response.status === 401) {
            const challengeHeader = response.headers.get("www-authenticate")
            const challenge = challengeHeader ? parseWwwAuthenticate(challengeHeader) : null
            if (!challenge) {
                throw new RegistryUnavailableError(imageRef, "401 with no usable auth challenge")
            }

            const token = await this.fetchToken(challenge, host)
            let retryResponse: Response
            try {
                retryResponse = await this.requestTagsList(host, repository, token)
            } catch (err) {
                throw new RegistryUnavailableError(imageRef, "retry request failed", {cause: err})
            }

            if (retryResponse.status === 401) {
                throw new RegistryUnavailableError(imageRef, "authentication failed after token retry")
            }
            response = retryResponse
        }

        if (response.status === 429) {
            throw new RegistryUnavailableError(imageRef, "rate limited (429)")
        }

        if (response.status === 404) {
            return null
        }

        if (!response.ok) {
            console.warn(`[RegistryClient] listTags: unexpected status ${response.status} for ${imageRef}`)
            return null
        }

        const body = await readBoundedBody(response)
        if (!body) return null

        try {
            const parsed = JSON.parse(body) as {tags?: unknown}
            if (!Array.isArray(parsed.tags)) {
                console.warn(`[RegistryClient] listTags: response body for ${imageRef} lacks a tags array`)
                return null
            }
            return parsed.tags.filter((t): t is string => typeof t === "string")
        } catch {
            console.warn(`[RegistryClient] listTags: response body for ${imageRef} is not valid JSON`)
            return null
        }
    }
}

export const registryClient = new RegistryClient()
