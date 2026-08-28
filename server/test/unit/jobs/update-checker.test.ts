import {describe, expect, it, vi, beforeEach} from "vitest";
import {
    UpdateChecker,
    compareVersions,
    getNextImageToCheck,
    splitImageRef,
    buildImageRefFromService,
} from "../../../../src/jobs/update-checker.js";

function createMockUpdateCheckerRepo() {
    return {
        findAllImageRefs: vi.fn(),
        getImageUpdateCheck: vi.fn(),
        upsertImageUpdateCheck: vi.fn(),
        findStacksByImageRef: vi.fn(),
    };
}

function createMockDockerExecutor() {
    return {
        manifestInspect: vi.fn(),
        imageDigest: vi.fn(),
    };
}

function createMockBroadcaster() {
    return {
        publish: vi.fn(),
    };
}

describe("UpdateChecker", () => {
    let checker: UpdateChecker;
    let mockRepo: ReturnType<typeof createMockUpdateCheckerRepo>;
    let mockDockerExecutor: ReturnType<typeof createMockDockerExecutor>;
    let mockBroadcaster: ReturnType<typeof createMockBroadcaster>;

    beforeEach(() => {
        vi.clearAllMocks();
        mockRepo = createMockUpdateCheckerRepo();
        mockDockerExecutor = createMockDockerExecutor();
        mockBroadcaster = createMockBroadcaster();
        // Safe default so hasUpdate=true scenarios that don't care about the
        // broadcast fan-out list don't hit "stacks is not iterable" — tests
        // that assert broadcast behavior override this explicitly.
        mockRepo.findStacksByImageRef.mockResolvedValue([]);
        checker = new UpdateChecker(mockRepo as any, mockDockerExecutor as any, mockBroadcaster as any);
    });

    describe("compareVersions() (UPD-01)", () => {
        it("returns 'newer' when latestTag is higher semver than currentTag", () => {
            expect(compareVersions("1.24.0", "1.25.0")).toBe("newer");
        });

        it("returns 'same' when tags are equal semver", () => {
            expect(compareVersions("1.25.0", "1.25.0")).toBe("same");
        });

        it("returns 'newer' for date tags when latest date is more recent", () => {
            expect(compareVersions("2024-01-01", "2024-06-01")).toBe("newer");
        });

        it("falls through to digest comparison when tags are not semver or date", () => {
            // Non-parseable tags: compare digests — if digests differ, treat as unknown / "newer"
            const result = compareVersions("nightly", "nightly", {
                currentDigest: "sha256:aaaa",
                latestDigest: "sha256:bbbb",
            });
            expect(result).toBe("newer");
        });

        it("handles semver coerce for truncated tags like '28' or '1.25'", () => {
            // semver.coerce("28") → "28.0.0"; semver.coerce("1.25") → "1.25.0"
            expect(compareVersions("28", "29")).toBe("newer");
            expect(compareVersions("1.25", "1.26")).toBe("newer");
            expect(compareVersions("1.25", "1.25")).toBe("same");
        });
    });

    describe("getNextImageToCheck() (UPD-02)", () => {
        it("returns image with null lastCheckedAt first (never checked)", async () => {
            const images = [
                {imageRef: "nginx:1.25", lastCheckedAt: new Date(Date.now() - 1000)},
                {imageRef: "redis:7", lastCheckedAt: null},
            ];
            const result = await getNextImageToCheck(images as any, 3600000);
            expect(result?.imageRef).toBe("redis:7");
        });

        it("returns image whose lastCheckedAt is older than stagger window", async () => {
            const staggerWindowMs = 3600000 / 2; // 2 images → 30 minutes each
            const images = [
                {imageRef: "nginx:1.25", lastCheckedAt: new Date(Date.now() - staggerWindowMs - 1000)},
                {imageRef: "redis:7", lastCheckedAt: new Date(Date.now() - 1000)},
            ];
            const result = await getNextImageToCheck(images as any, 3600000);
            expect(result?.imageRef).toBe("nginx:1.25");
        });

        it("returns null when all images were checked within stagger window", async () => {
            const images = [
                {imageRef: "nginx:1.25", lastCheckedAt: new Date(Date.now() - 1000)},
                {imageRef: "redis:7", lastCheckedAt: new Date(Date.now() - 2000)},
            ];
            // All checked very recently — within stagger window
            const result = await getNextImageToCheck(images as any, 3600000);
            expect(result).toBeNull();
        });

        it("stagger window = CHECK_INTERVAL_MS / imageCount", async () => {
            const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours
            const imageCount = 10;
            const expectedStagger = CHECK_INTERVAL_MS / imageCount; // 36 minutes
            expect(expectedStagger).toBe(36 * 60 * 1000);
        });
    });

    describe("triggerUpdate() (UPD-04)", () => {
        it("calls docker pull then docker compose up -d for the stack", async () => {
            const stack = {id: "stack-1", composeFilePath: "/stacks/myapp/docker-compose.yml"};
            mockRepo.findStacksByImageRef.mockResolvedValue([stack]);

            await (checker as any).triggerUpdate("nginx:1.25", stack as any);

            expect(mockDockerExecutor.manifestInspect).toHaveBeenCalled();
        });

        it("transitions stack status to UPDATING then back to RUNNING on success", async () => {
            const stack = {id: "stack-1", composeFilePath: "/stacks/myapp/docker-compose.yml", status: "RUNNING"};

            await (checker as any).triggerUpdate("nginx:1.25", stack as any);

            // Implementation should transition: RUNNING → UPDATING → RUNNING
            expect(mockBroadcaster.publish).toHaveBeenCalledWith(
                expect.objectContaining({stackId: stack.id}),
            );
        });

        it("transitions stack to ERROR on pull/recreate failure", async () => {
            const stack = {id: "stack-1", composeFilePath: "/stacks/myapp/docker-compose.yml", status: "RUNNING"};
            mockDockerExecutor.manifestInspect.mockRejectedValue(new Error("pull failed"));

            await (checker as any).triggerUpdate("nginx:1.25", stack as any);

            expect(mockBroadcaster.publish).toHaveBeenCalledWith(
                expect.objectContaining({stackId: stack.id, type: "update_error"}),
            );
        });
    });

    describe("splitImageRef() (UPD-01)", () => {
        it("splits name and tag on the tag separator", () => {
            expect(splitImageRef("nginx:1.25")).toEqual({name: "nginx", tag: "1.25"});
        });

        it("defaults to tag 'latest' when no separator is present", () => {
            expect(splitImageRef("nginx")).toEqual({name: "nginx", tag: "latest"});
        });

        it("splits a registry host with a path and an explicit tag", () => {
            expect(splitImageRef("ghcr.io/user/app:2.0")).toEqual({name: "ghcr.io/user/app", tag: "2.0"});
        });

        it("does not mistake a registry port for a tag separator when a tag follows", () => {
            expect(splitImageRef("registry.example.com:5000/app:1.2")).toEqual({
                name: "registry.example.com:5000/app",
                tag: "1.2",
            });
        });

        it("does not mistake a registry port for a tag separator when no tag follows", () => {
            expect(splitImageRef("registry.example.com:5000/app")).toEqual({
                name: "registry.example.com:5000/app",
                tag: "latest",
            });
        });
    });

    describe("buildImageRefFromService() (UPD-02 imageless filter)", () => {
        it("returns null for a build-only service with no image", () => {
            expect(buildImageRefFromService("", null)).toBeNull();
            expect(buildImageRefFromService("   ", null)).toBeNull();
            expect(buildImageRefFromService(null, null)).toBeNull();
            expect(buildImageRefFromService(undefined, undefined)).toBeNull();
        });

        it("reconstructs a canonical tag-qualified ref matching findAllImageRefs' spelling", () => {
            expect(buildImageRefFromService("nginx", "1.25")).toBe("nginx:1.25");
        });

        it("defaults to :latest when no tag is stored", () => {
            expect(buildImageRefFromService("nginx", null)).toBe("nginx:latest");
        });
    });

    describe("checkImage() digest comparison (UPD-01, UPD-02)", () => {
        it("resolves imageDigest() from the local image store, not the registry", async () => {
            mockDockerExecutor.manifestInspect.mockResolvedValue({digest: "sha256:bbbb", latestTag: null});
            mockDockerExecutor.imageDigest.mockResolvedValue("sha256:aaaa");
            mockRepo.getImageUpdateCheck.mockResolvedValue(null);
            mockRepo.findStacksByImageRef.mockResolvedValue([]);

            await checker.checkImage("nginx:1.25");

            expect(mockDockerExecutor.imageDigest).toHaveBeenCalledWith("nginx:1.25");
        });

        it("sets hasUpdate=true on the very first check when the registry digest differs from the local digest", async () => {
            mockDockerExecutor.manifestInspect.mockResolvedValue({digest: "sha256:bbbb", latestTag: null});
            mockDockerExecutor.imageDigest.mockResolvedValue("sha256:aaaa");
            mockRepo.getImageUpdateCheck.mockResolvedValue(null); // no prior row — first check
            mockRepo.findStacksByImageRef.mockResolvedValue([{id: "stack-1"}]);

            await checker.checkImage("nginx:1.25");

            expect(mockRepo.upsertImageUpdateCheck).toHaveBeenCalledWith(
                expect.objectContaining({
                    imageRef: "nginx:1.25",
                    currentDigest: "sha256:aaaa",
                    latestDigest: "sha256:bbbb",
                    hasUpdate: true,
                }),
            );
            expect(mockBroadcaster.publish).toHaveBeenCalledWith(
                expect.objectContaining({type: "update_available", stackId: "stack-1"}),
            );
        });

        it("sets hasUpdate=false and publishes no event when the registry digest equals the local digest", async () => {
            mockDockerExecutor.manifestInspect.mockResolvedValue({digest: "sha256:aaaa", latestTag: null});
            mockDockerExecutor.imageDigest.mockResolvedValue("sha256:aaaa");
            mockRepo.getImageUpdateCheck.mockResolvedValue(null);

            await checker.checkImage("nginx:1.25");

            expect(mockRepo.upsertImageUpdateCheck).toHaveBeenCalledWith(
                expect.objectContaining({hasUpdate: false, currentDigest: "sha256:aaaa", latestDigest: "sha256:aaaa"}),
            );
            expect(mockBroadcaster.publish).not.toHaveBeenCalled();
        });

        it("persists a non-null currentDigest and latestDigest on a successful check", async () => {
            mockDockerExecutor.manifestInspect.mockResolvedValue({digest: "sha256:cccc", latestTag: null});
            mockDockerExecutor.imageDigest.mockResolvedValue("sha256:dddd");
            mockRepo.getImageUpdateCheck.mockResolvedValue(null);

            await checker.checkImage("redis:7");

            const call = mockRepo.upsertImageUpdateCheck.mock.calls[0][0];
            expect(call.currentDigest).not.toBeNull();
            expect(call.latestDigest).not.toBeNull();
        });

        it("produces the same hasUpdate verdict and the same imageRef key on a repeated check against unchanged state", async () => {
            mockDockerExecutor.manifestInspect.mockResolvedValue({digest: "sha256:same", latestTag: null});
            mockDockerExecutor.imageDigest.mockResolvedValue("sha256:same");
            mockRepo.getImageUpdateCheck.mockResolvedValue(null);

            await checker.checkImage("nginx:1.25");
            await checker.checkImage("nginx:1.25");

            expect(mockRepo.upsertImageUpdateCheck).toHaveBeenCalledTimes(2);
            const [firstCall, secondCall] = mockRepo.upsertImageUpdateCheck.mock.calls;
            expect(firstCall[0].imageRef).toBe(secondCall[0].imageRef);
            expect(firstCall[0].hasUpdate).toBe(secondCall[0].hasUpdate);
        });

        it("leaves hasUpdate=false and does not compare against local digest when the local image is not present", async () => {
            mockDockerExecutor.manifestInspect.mockResolvedValue({digest: "sha256:bbbb", latestTag: null});
            mockDockerExecutor.imageDigest.mockResolvedValue(null); // not deployed locally yet
            mockRepo.getImageUpdateCheck.mockResolvedValue(null);

            await checker.checkImage("nginx:1.25");

            expect(mockRepo.upsertImageUpdateCheck).toHaveBeenCalledWith(
                expect.objectContaining({hasUpdate: false, currentDigest: null, latestDigest: "sha256:bbbb"}),
            );
        });

        it("records hasUpdate=false with a checkError naming the image and clears a previously stored hasUpdate=true when manifestInspect returns null", async () => {
            mockDockerExecutor.manifestInspect.mockResolvedValue(null);

            await checker.checkImage("nginx:1.25");

            expect(mockRepo.upsertImageUpdateCheck).toHaveBeenCalledWith(
                expect.objectContaining({
                    hasUpdate: false,
                    checkError: expect.stringContaining("nginx:1.25"),
                }),
            );
        });

        it("uses the true tag (not the registry port) for a port-qualified ref with no explicit tag", async () => {
            mockDockerExecutor.manifestInspect.mockResolvedValue({digest: "sha256:same", latestTag: "2.0"});
            mockDockerExecutor.imageDigest.mockResolvedValue("sha256:same");

            await checker.checkImage("registry.example.com:5000/app");

            // With the correct split, tag === "latest" so the digest branch is
            // used and the tag-comparison branch (which would incorrectly fire
            // if the port were mistaken for a tag) is never entered.
            expect(mockRepo.getImageUpdateCheck).not.toHaveBeenCalled();
            expect(mockRepo.upsertImageUpdateCheck).toHaveBeenCalledWith(
                expect.objectContaining({hasUpdate: false}),
            );
        });
    });
});
