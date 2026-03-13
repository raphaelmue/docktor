import {describe, expect, it, vi, beforeEach} from "vitest";
import {FileWatcher} from "../../../../src/jobs/file-watcher.js";

vi.mock("chokidar", () => ({
    watch: vi.fn().mockReturnValue({
        on: vi.fn().mockReturnThis(),
        close: vi.fn().mockResolvedValue(undefined),
    }),
}));

vi.mock("node-cron", () => ({
    default: {schedule: vi.fn().mockReturnValue({stop: vi.fn()})},
}));

function createMockFileWatcherRepo() {
    return {
        findAllStacks: vi.fn(),
        findStackByPath: vi.fn(),
        updateStackHash: vi.fn(),
        createStackEvent: vi.fn(),
    };
}

function createMockBroadcaster() {
    return {
        publish: vi.fn(),
    };
}

describe("FileWatcher", () => {
    let fileWatcher: FileWatcher;
    let mockRepo: ReturnType<typeof createMockFileWatcherRepo>;
    let mockBroadcaster: ReturnType<typeof createMockBroadcaster>;

    beforeEach(() => {
        vi.clearAllMocks();
        mockRepo = createMockFileWatcherRepo();
        mockBroadcaster = createMockBroadcaster();
        fileWatcher = new FileWatcher(mockRepo as any, mockBroadcaster as any);
    });

    describe("start() (FW-01)", () => {
        it("starts a chokidar watcher watching the stacks root directory", async () => {
            await fileWatcher.start();
            expect(fileWatcher.isWatching()).toBe(true);
        });

        it("stop() closes the chokidar watcher and cron task", async () => {
            await fileWatcher.start();
            await fileWatcher.stop();
            expect(fileWatcher.isWatching()).toBe(false);
        });
    });

    describe("handleFileChange() (FW-02)", () => {
        it("calls repo.updateStackHash and repo.createStackEvent with type config_changed when hash differs", async () => {
            const fakePath = "/stacks/my-stack/docker-compose.yml";
            const fakeStack = {id: "stack-1", composeFilePath: fakePath, hash: "old-hash"};
            mockRepo.findStackByPath.mockResolvedValue(fakeStack);
            mockRepo.updateStackHash.mockResolvedValue(undefined);
            mockRepo.createStackEvent.mockResolvedValue(undefined);

            await (fileWatcher as any).handleFileChange(fakePath);

            expect(mockRepo.updateStackHash).toHaveBeenCalledWith(
                expect.objectContaining({stackId: fakeStack.id}),
            );
            expect(mockRepo.createStackEvent).toHaveBeenCalledWith(
                expect.objectContaining({stackId: fakeStack.id, type: "config_changed"}),
            );
        });

        it("calls repo.createStackEvent with type config_error when YAML is invalid", async () => {
            const fakePath = "/stacks/my-stack/docker-compose.yml";
            const fakeStack = {id: "stack-1", composeFilePath: fakePath, hash: "old-hash"};
            mockRepo.findStackByPath.mockResolvedValue(fakeStack);
            mockRepo.createStackEvent.mockResolvedValue(undefined);

            // Simulate invalid YAML by providing a path that can't be read in test
            // handleFileChange should catch the parse error and create config_error event
            await (fileWatcher as any).handleFileChange(fakePath, {forceInvalidYaml: true});

            expect(mockRepo.createStackEvent).toHaveBeenCalledWith(
                expect.objectContaining({stackId: fakeStack.id, type: "config_error"}),
            );
        });

        it("broadcasts config_changed SSE event via broadcaster.publish", async () => {
            const fakePath = "/stacks/my-stack/docker-compose.yml";
            const fakeStack = {id: "stack-1", composeFilePath: fakePath, hash: "old-hash"};
            mockRepo.findStackByPath.mockResolvedValue(fakeStack);
            mockRepo.updateStackHash.mockResolvedValue(undefined);
            mockRepo.createStackEvent.mockResolvedValue(undefined);

            await (fileWatcher as any).handleFileChange(fakePath);

            expect(mockBroadcaster.publish).toHaveBeenCalledWith(
                expect.objectContaining({type: "config_changed", stackId: fakeStack.id}),
            );
        });

        it("broadcasts config_error SSE event with message via broadcaster.publish", async () => {
            const fakePath = "/stacks/my-stack/docker-compose.yml";
            const fakeStack = {id: "stack-1", composeFilePath: fakePath, hash: "old-hash"};
            mockRepo.findStackByPath.mockResolvedValue(fakeStack);
            mockRepo.createStackEvent.mockResolvedValue(undefined);

            await (fileWatcher as any).handleFileChange(fakePath, {forceInvalidYaml: true});

            expect(mockBroadcaster.publish).toHaveBeenCalledWith(
                expect.objectContaining({type: "config_error", stackId: fakeStack.id}),
            );
        });

        it("does NOT create event when hash is unchanged (no false positives)", async () => {
            const fakePath = "/stacks/my-stack/docker-compose.yml";
            // Stack hash matches the file hash — no change
            const fakeStack = {id: "stack-1", composeFilePath: fakePath, hash: "same-hash"};
            mockRepo.findStackByPath.mockResolvedValue(fakeStack);

            await (fileWatcher as any).handleFileChange(fakePath, {simulatedHash: "same-hash"});

            expect(mockRepo.createStackEvent).not.toHaveBeenCalled();
            expect(mockBroadcaster.publish).not.toHaveBeenCalled();
        });
    });

    describe("reconcile() (FW-03)", () => {
        it("re-hashes all stacks and updates DB for stacks whose hash changed", async () => {
            const stacks = [
                {id: "stack-1", composeFilePath: "/stacks/s1/docker-compose.yml", hash: "old-hash-1"},
                {id: "stack-2", composeFilePath: "/stacks/s2/docker-compose.yml", hash: "old-hash-2"},
            ];
            mockRepo.findAllStacks.mockResolvedValue(stacks);
            mockRepo.updateStackHash.mockResolvedValue(undefined);
            mockRepo.createStackEvent.mockResolvedValue(undefined);

            await (fileWatcher as any).reconcile();

            expect(mockRepo.findAllStacks).toHaveBeenCalled();
            // At least one stack should have its hash updated (since "old-hash-*" won't match real hash)
            expect(mockRepo.updateStackHash).toHaveBeenCalled();
        });

        it("does not update DB when hash matches lastKnownHash", async () => {
            // Provide a stack with a hash that matches what reconcile computes
            const stacks = [
                {id: "stack-1", composeFilePath: "/stacks/s1/docker-compose.yml", hash: "current-hash"},
            ];
            mockRepo.findAllStacks.mockResolvedValue(stacks);

            // When the computed hash equals the stored hash, no DB write should happen
            await (fileWatcher as any).reconcile({simulatedHashMatches: true});

            expect(mockRepo.updateStackHash).not.toHaveBeenCalled();
        });
    });
});
