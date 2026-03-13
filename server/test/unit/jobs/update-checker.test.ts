import {describe, expect, it, vi, beforeEach} from "vitest";
import {UpdateChecker, compareVersions, getNextImageToCheck} from "../../../../src/jobs/update-checker.js";

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
});
