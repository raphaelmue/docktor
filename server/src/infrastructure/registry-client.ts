import {AppError} from "../lib/errors.js"

/**
 * Strips the tag from an image reference, mirroring splitImageRef() in
 * jobs/update-checker.ts (a colon followed later by a slash is a registry
 * port, not a tag separator). Duplicated locally rather than imported —
 * update-checker.ts injects this infrastructure adapter via constructor DI
 * and defaults to the registryClient singleton exported below, so importing
 * from jobs/update-checker.ts here would create a circular module
 * dependency between the two singletons (each defined via `export const x =
 * new X()` at the foot of its file), which is a TDZ crash waiting to happen
 * depending on which module a caller imports first.
 */
function stripTag(imageRef: string): string {
    const lastColon = imageRef.lastIndexOf(":")
    if (lastColon === -1 || imageRef.indexOf("/", lastColon) !== -1) {
        return imageRef
    }
    return imageRef.slice(0, lastColon)
}

const REQUEST_TIMEOUT_MS = 15_000
const MAX_BODY_BYTES = 2 * 1024 * 1024 // ~2 MB
const MOVING_TAG_HOST_FALLBACK = "registry-1.docker.io"
// Registry v2 paginates tags/list via a `Link: <url>; rel="next"` header once a
// repository has more tags than fit in one page. Docker Hub returns tags in
// alphabetical order, not version or chronological order, so for a
// high-traffic image like nginx (1000+ tags) the tags a user actually cares
// about can be many pages in — nginx's own "1.27"/"1.28"/"1.29" don't appear
// until page 7 of 13. A cap still exists to bound worst-case request count
// against a pathological or malicious registry.
const MAX_TAG_PAGES = 50

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

    private async requestTagsListUrl(
        url: string,
        token: string | null,
    ): Promise<Response> {
        const headers: Record<string, string> = {}
        if (token) headers.Authorization = `Bearer ${token}`

        return fetch(url, {
            headers,
            signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
            redirect: "error",
        })
    }

    private requestTagsList(
        host: string,
        repository: string,
        token: string | null,
    ): Promise<Response> {
        return this.requestTagsListUrl(`https://${host}/v2/${repository}/tags/list?n=100`, token)
    }

    /**
     * Resolves a Registry v2 pagination `Link: <url>; rel="next"` header to an
     * absolute URL for the next page, or null when there is none. The header
     * value is host-relative (e.g. `</v2/library/nginx/tags/list?last=...>`),
     * so it's resolved against the same host the current page came from.
     */
    private resolveNextPageUrl(response: Response, host: string): string | null {
        const link = response.headers.get("link")
        if (!link) return null
        const match = /<([^>]+)>\s*;\s*rel="next"/i.exec(link)
        if (!match) return null
        return new URL(match[1], `https://${host}`).toString()
    }

    /**
     * Lists tags for an image reference over the standard Registry v2 API.
     * Returns null for outcomes that are a normal "nothing to report"
     * (repository not found, unusable body) and throws
     * RegistryUnavailableError for outcomes the caller must record as a
     * checkError (rate limit, persistent auth failure).
     */
    async listTags(imageRef: string): Promise<string[] | null> {
        const name = stripTag(imageRef)

        const {host, repository} = resolveRegistryTarget(name)
        if (!isValidHost(host)) {
            console.warn(`[RegistryClient] rejecting invalid host derived from ${imageRef}: ${host}`)
            return null
        }

        let response: Response
        let token: string | null = null
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

            token = await this.fetchToken(challenge, host)
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

        const firstPageTags = await this.parseTagsBody(response, imageRef)
        if (firstPageTags === null) return null

        const allTags = [...firstPageTags]
        let nextUrl = this.resolveNextPageUrl(response, host)
        let page = 1

        // A mid-pagination failure past the first page stops pagination and
        // returns what's already been accumulated, rather than throwing —
        // the first page already succeeded, so partial results are strictly
        // better than discarding everything over a later page's hiccup.
        while (nextUrl && page < MAX_TAG_PAGES) {
            page += 1
            let pageResponse: Response
            try {
                pageResponse = await this.requestTagsListUrl(nextUrl, token)
            } catch (err) {
                console.warn(`[RegistryClient] listTags: page ${page} request failed for ${imageRef}, returning ${allTags.length} tags collected so far`, err)
                break
            }
            if (!pageResponse.ok) {
                console.warn(`[RegistryClient] listTags: page ${page} returned status ${pageResponse.status} for ${imageRef}, returning ${allTags.length} tags collected so far`)
                break
            }
            const pageTags = await this.parseTagsBody(pageResponse, imageRef)
            if (pageTags === null) break
            allTags.push(...pageTags)
            nextUrl = this.resolveNextPageUrl(pageResponse, host)
        }

        return allTags
    }

    private async parseTagsBody(response: Response, imageRef: string): Promise<string[] | null> {
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
