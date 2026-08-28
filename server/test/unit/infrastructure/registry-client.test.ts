import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"
import {RegistryClient, RegistryUnavailableError} from "../../../../src/infrastructure/registry-client.js"

function jsonResponse(status: number, body: unknown, headers?: Record<string, string>): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: {"content-type": "application/json", ...headers},
    })
}

function textResponse(status: number, body: string, headers?: Record<string, string>): Response {
    return new Response(body, {status, headers})
}

describe("RegistryClient", () => {
    let client: RegistryClient
    let fetchMock: ReturnType<typeof vi.fn>

    beforeEach(() => {
        client = new RegistryClient()
        fetchMock = vi.fn()
        vi.stubGlobal("fetch", fetchMock)
    })

    afterEach(() => {
        vi.unstubAllGlobals()
    })

    describe("listTags() (UPD-01)", () => {
        it("requests the Docker Hub v2 tags endpoint for library/nginx and returns a non-empty tag array", async () => {
            fetchMock.mockResolvedValueOnce(jsonResponse(200, {tags: ["1.24", "1.25", "1.26"]}))

            const result = await client.listTags("nginx:1.25")

            expect(fetchMock).toHaveBeenCalledTimes(1)
            const [url] = fetchMock.mock.calls[0]
            expect(url).toBe("https://registry-1.docker.io/v2/library/nginx/tags/list?n=100")
            expect(result).toEqual(["1.24", "1.25", "1.26"])
        })

        it("negotiates a bearer token when challenged with WWW-Authenticate and retries once with Authorization", async () => {
            fetchMock
                .mockResolvedValueOnce(
                    textResponse(401, "", {
                        "www-authenticate":
                            'Bearer realm="https://auth.docker.io/token",service="registry.docker.io",scope="repository:library/nginx:pull"',
                    }),
                )
                .mockResolvedValueOnce(jsonResponse(200, {token: "fake-token"}))
                .mockResolvedValueOnce(jsonResponse(200, {tags: ["1.25"]}))

            const result = await client.listTags("nginx:1.25")

            expect(fetchMock).toHaveBeenCalledTimes(3)
            const tokenCallUrl = fetchMock.mock.calls[1][0] as string
            expect(tokenCallUrl).toContain("https://auth.docker.io/token")
            expect(tokenCallUrl).toContain("service=registry.docker.io")
            expect(tokenCallUrl).toContain("scope=repository")

            const retryCallOptions = fetchMock.mock.calls[2][1] as RequestInit
            expect((retryCallOptions.headers as Record<string, string>).Authorization).toBe("Bearer fake-token")
            expect(result).toEqual(["1.25"])
        })

        it("throws RegistryUnavailableError rather than looping when the retry also answers 401", async () => {
            fetchMock
                .mockResolvedValueOnce(
                    textResponse(401, "", {
                        "www-authenticate": 'Bearer realm="https://auth.docker.io/token",service="registry.docker.io"',
                    }),
                )
                .mockResolvedValueOnce(jsonResponse(200, {token: "fake-token"}))
                .mockResolvedValueOnce(textResponse(401, ""))

            await expect(client.listTags("nginx:1.25")).rejects.toThrow(RegistryUnavailableError)
            // Exactly two tag-list requests (initial + one retry) plus one token
            // fetch — no third tag-list request after the repeated 401.
            expect(fetchMock).toHaveBeenCalledTimes(3)
        })

        it("throws RegistryUnavailableError naming the image reference when the registry answers 429", async () => {
            fetchMock.mockResolvedValueOnce(textResponse(429, ""))

            await expect(client.listTags("nginx:1.25")).rejects.toThrow(/nginx:1\.25/)
        })

        it("returns null when the registry answers 404", async () => {
            fetchMock.mockResolvedValueOnce(textResponse(404, ""))

            const result = await client.listTags("nginx:1.25")

            expect(result).toBeNull()
        })

        it("returns null after a warn log when the response body is not JSON", async () => {
            const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
            fetchMock.mockResolvedValueOnce(textResponse(200, "not json"))

            const result = await client.listTags("nginx:1.25")

            expect(result).toBeNull()
            expect(warnSpy).toHaveBeenCalled()
            warnSpy.mockRestore()
        })

        it("returns null after a warn log when the response body lacks a tags array", async () => {
            const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
            fetchMock.mockResolvedValueOnce(jsonResponse(200, {notTags: []}))

            const result = await client.listTags("nginx:1.25")

            expect(result).toBeNull()
            expect(warnSpy).toHaveBeenCalled()
            warnSpy.mockRestore()
        })

        it("requests ghcr.io with repository path user/app for ghcr.io/user/app:2.0", async () => {
            fetchMock.mockResolvedValueOnce(jsonResponse(200, {tags: ["2.0"]}))

            await client.listTags("ghcr.io/user/app:2.0")

            const [url] = fetchMock.mock.calls[0]
            expect(url).toBe("https://ghcr.io/v2/user/app/tags/list?n=100")
        })

        it("requests a generic v2 registry host with port and repository path team/app for registry.example.com:5000/team/app:1.0", async () => {
            fetchMock.mockResolvedValueOnce(jsonResponse(200, {tags: ["1.0"]}))

            await client.listTags("registry.example.com:5000/team/app:1.0")

            const [url] = fetchMock.mock.calls[0]
            expect(url).toBe("https://registry.example.com:5000/v2/team/app/tags/list?n=100")
        })

        it("always requests over HTTPS", async () => {
            fetchMock.mockResolvedValueOnce(jsonResponse(200, {tags: ["1.0"]}))

            await client.listTags("registry.example.com:5000/team/app:1.0")

            const [url] = fetchMock.mock.calls[0]
            expect(url.startsWith("https://")).toBe(true)
        })
    })
})
