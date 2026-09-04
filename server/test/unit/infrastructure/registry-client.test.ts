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

    describe("listTags() pagination (nginx has 1000+ tags spread across many pages)", () => {
        it("follows a Link: rel=\"next\" header across multiple pages and merges all tags", async () => {
            fetchMock
                .mockResolvedValueOnce(
                    jsonResponse(200, {tags: ["1-alpine", "1.10"]}, {
                        link: '</v2/library/nginx/tags/list?last=1.10&n=100>; rel="next"',
                    }),
                )
                .mockResolvedValueOnce(jsonResponse(200, {tags: ["1.27", "1.28"]}))

            const result = await client.listTags("nginx:1.27")

            expect(fetchMock).toHaveBeenCalledTimes(2)
            const [secondUrl] = fetchMock.mock.calls[1]
            expect(secondUrl).toBe("https://registry-1.docker.io/v2/library/nginx/tags/list?last=1.10&n=100")
            expect(result).toEqual(["1-alpine", "1.10", "1.27", "1.28"])
        })

        it("reuses the negotiated bearer token for subsequent pages", async () => {
            fetchMock
                .mockResolvedValueOnce(
                    textResponse(401, "", {
                        "www-authenticate": 'Bearer realm="https://auth.docker.io/token",service="registry.docker.io"',
                    }),
                )
                .mockResolvedValueOnce(jsonResponse(200, {token: "fake-token"}))
                .mockResolvedValueOnce(
                    jsonResponse(200, {tags: ["1.10"]}, {link: '</v2/library/nginx/tags/list?last=1.10>; rel="next"'}),
                )
                .mockResolvedValueOnce(jsonResponse(200, {tags: ["1.27"]}))

            const result = await client.listTags("nginx:1.27")

            const secondPageOptions = fetchMock.mock.calls[3][1] as RequestInit
            expect((secondPageOptions.headers as Record<string, string>).Authorization).toBe("Bearer fake-token")
            expect(result).toEqual(["1.10", "1.27"])
        })

        it("stops pagination and returns tags collected so far when a later page fails, without throwing", async () => {
            const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
            fetchMock
                .mockResolvedValueOnce(
                    jsonResponse(200, {tags: ["1.10"]}, {link: '</v2/library/nginx/tags/list?last=1.10>; rel="next"'}),
                )
                .mockRejectedValueOnce(new Error("network blip"))

            const result = await client.listTags("nginx:1.27")

            expect(result).toEqual(["1.10"])
            expect(warnSpy).toHaveBeenCalled()
            warnSpy.mockRestore()
        })

        it("caps pagination at a bounded number of pages against a pathologically large tag list", async () => {
            fetchMock.mockImplementation((url: string) => {
                const lastMatch = /last=(\d+)/.exec(url)
                const page = lastMatch ? Number(lastMatch[1]) : 0
                return Promise.resolve(
                    jsonResponse(200, {tags: [`page-${page}`]}, {
                        link: `</v2/library/nginx/tags/list?last=${page + 1}&n=100>; rel="next"`,
                    }),
                )
            })

            const result = await client.listTags("nginx:1.27")

            // Bounded: does not paginate forever even though every page claims a next link.
            expect(fetchMock.mock.calls.length).toBeLessThan(100)
            expect(result?.length).toBe(fetchMock.mock.calls.length)
        })

        it("has no Link header on a single-page response, so it does not attempt a second request", async () => {
            fetchMock.mockResolvedValueOnce(jsonResponse(200, {tags: ["1.27"]}))

            await client.listTags("nginx:1.27")

            expect(fetchMock).toHaveBeenCalledTimes(1)
        })
    })
})
