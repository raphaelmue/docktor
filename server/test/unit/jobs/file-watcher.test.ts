import {describe, expect, it, vi, beforeEach, afterEach} from "vitest";
import {FileWatcher} from "../../../../src/jobs/file-watcher.js";
import {watch} from "chokidar";

vi.mock("chokidar", () => ({
    watch: vi.fn().mockReturnValue({
        on: vi.fn().mockReturnThis(),
        close: vi.fn().mockResolvedValue(undefined),
    }),
}));

vi.mock("node-cron", () => ({
    default: {schedule: vi.fn().mockReturnValue({stop: vi.fn()})},
}));

// Mock fs/promises so tests don't hit the real filesystem
vi.mock("node:fs/promises", () => ({
    readFile: vi.fn(),
}));

// Mock compose-parser so we can control hash/parse outcomes
vi.mock("../../../../src/lib/compose-parser.js", () => ({
    hashComposeContent: vi.fn(),
    parseComposeContent: vi.fn(),
}));

vi.mock("../../../../src/domain/compose-config.js", () => ({
    createComposeConfig: vi.fn().mockReturnValue({
        hash: "mock-hash",
        services: [{serviceName: "app", image: "nginx", imageTag: "latest", ports: [], volumes: []}],
    }),
}));

function createMockFileWatcherRepo() {
    return {
        findAllStacks: vi.fn(),
        findStackByPath: vi.fn(),
        updateStackHash: vi.fn(),
        syncServicesFromCompose: vi.fn().mockResolvedValue(undefined),
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let mockReadFile: any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let mockHashContent: any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let mockParseContent: any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let mockCreateComposeConfig: any;

    beforeEach(async () => {
        vi.clearAllMocks();
        mockRepo = createMockFileWatcherRepo();
        mockBroadcaster = createMockBroadcaster();
        fileWatcher = new FileWatcher(mockRepo as any, mockBroadcaster as any);

        const fs = await import("node:fs/promises");
        mockReadFile = fs.readFile as ReturnType<typeof vi.fn>;

        const parser = await import("../../../../src/lib/compose-parser.js");
        mockHashContent = parser.hashComposeContent as ReturnType<typeof vi.fn>;
        mockParseContent = parser.parseComposeContent as ReturnType<typeof vi.fn>;

        const composeConfigModule = await import("../../../../src/domain/compose-config.js");
        mockCreateComposeConfig = composeConfigModule.createComposeConfig as ReturnType<typeof vi.fn>;

        // Default: file reads succeed with some content
        mockReadFile.mockResolvedValue("services:\n  app:\n    image: nginx:latest\n");
        // Default: hash returns a value different from "old-hash"
        mockHashContent.mockReturnValue("new-computed-hash");
        // Default: parse succeeds (unused directly by handleFileChange, kept for compose-parser mock shape)
        mockParseContent.mockReturnValue([{serviceName: "app", image: "nginx", imageTag: "latest", ports: [], volumes: []}]);
        // Default: createComposeConfig succeeds
        mockCreateComposeConfig.mockReturnValue({
            hash: "new-computed-hash",
            services: [{serviceName: "app", image: "nginx", imageTag: "latest", ports: [], volumes: []}],
        });
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

    describe("polling mode selection (FW-01)", () => {
        const originalPlatform = process.platform;
        const originalEnv = process.env.DOCKTOR_FS_POLLING;

        afterEach(() => {
            Object.defineProperty(process, "platform", {value: originalPlatform});
            if (originalEnv === undefined) {
                delete process.env.DOCKTOR_FS_POLLING;
            } else {
                process.env.DOCKTOR_FS_POLLING = originalEnv;
            }
        });

        it("does not use polling by default on non-Windows platforms with no override", async () => {
            Object.defineProperty(process, "platform", {value: "linux"});
            delete process.env.DOCKTOR_FS_POLLING;

            await fileWatcher.start();

            const options = (watch as ReturnType<typeof vi.fn>).mock.calls[0][1];
            expect(options.usePolling).toBe(false);
        });

        it("uses polling automatically when process.platform is win32", async () => {
            Object.defineProperty(process, "platform", {value: "win32"});
            delete process.env.DOCKTOR_FS_POLLING;

            await fileWatcher.start();

            const options = (watch as ReturnType<typeof vi.fn>).mock.calls[0][1];
            expect(options.usePolling).toBe(true);
            expect(options.interval).toBe(1000);
        });

        it("forces polling on via DOCKTOR_FS_POLLING=true even on Linux (containerized bind mounts, e.g. Docker Desktop on Windows/Mac, may not propagate inotify into the container regardless of its reported platform)", async () => {
            Object.defineProperty(process, "platform", {value: "linux"});
            process.env.DOCKTOR_FS_POLLING = "true";

            await fileWatcher.start();

            const options = (watch as ReturnType<typeof vi.fn>).mock.calls[0][1];
            expect(options.usePolling).toBe(true);
            expect(options.interval).toBe(1000);
        });

        it("forces polling off via DOCKTOR_FS_POLLING=false even on Windows", async () => {
            Object.defineProperty(process, "platform", {value: "win32"});
            process.env.DOCKTOR_FS_POLLING = "false";

            await fileWatcher.start();

            const options = (watch as ReturnType<typeof vi.fn>).mock.calls[0][1];
            expect(options.usePolling).toBe(false);
        });
    });

    describe("ignored filter (FW-01 regression)", () => {
        async function getIgnoredFn(): Promise<(filePath: string, stats?: import("node:fs").Stats) => boolean | undefined> {
            await fileWatcher.start();
            const options = (watch as ReturnType<typeof vi.fn>).mock.calls[0][1];
            return options.ignored;
        }

        it("does not ignore a directory when stats confirm it is a directory", async () => {
            const ignored = await getIgnoredFn();
            const dirStats = {isDirectory: () => true, isFile: () => false} as import("node:fs").Stats;
            expect(ignored("/stacks/my-stack", dirStats)).toBeFalsy();
        });

        it("does not ignore a directory-like path when stats are undefined (readdirp does not always supply stats during traversal)", async () => {
            // Regression: chokidar's own documented pattern for a function-based `ignored`
            // (`stats?.isFile() && !f.endsWith(...)`) treats an undefined `stats` as "don't
            // ignore" by short-circuiting to a falsy value. A prior version of this filter
            // used `stats?.isDirectory() ?? false` as its directory guard, which defaults to
            // `false` when stats is undefined and falls through to the suffix check — wrongly
            // ignoring (and thus blocking traversal into) any directory whose name doesn't
            // happen to end with "docker-compose.yml". That silently broke live file-change
            // detection entirely (proven via a real chokidar diagnostic against a Docker bind
            // mount where directory-filter stats came back undefined).
            const ignored = await getIgnoredFn();
            expect(ignored("/stacks/my-stack", undefined)).toBeFalsy();
        });

        it("ignores a file that is not named docker-compose.yml", async () => {
            const ignored = await getIgnoredFn();
            const fileStats = {isDirectory: () => false, isFile: () => true} as import("node:fs").Stats;
            expect(ignored("/stacks/my-stack/readme.md", fileStats)).toBe(true);
        });

        it("does not ignore a file named docker-compose.yml", async () => {
            const ignored = await getIgnoredFn();
            const fileStats = {isDirectory: () => false, isFile: () => true} as import("node:fs").Stats;
            expect(ignored("/stacks/my-stack/docker-compose.yml", fileStats)).toBeFalsy();
        });
    });

    describe("handleFileChange() (FW-02)", () => {
        it("calls repo.updateStackHash and repo.createStackEvent with type config_changed when hash differs", async () => {
            const fakePath = "/stacks/my-stack/docker-compose.yml";
            const fakeStack = {id: "stack-1", composeFilePath: fakePath, hash: "old-hash"};
            mockRepo.findStackByPath.mockResolvedValue(fakeStack);
            mockRepo.updateStackHash.mockResolvedValue(undefined);
            mockRepo.createStackEvent.mockResolvedValue(undefined);
            // hash returns "new-computed-hash" which differs from "old-hash"
            mockHashContent.mockReturnValue("new-computed-hash");

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
            // hash differs so we proceed to parse
            mockHashContent.mockReturnValue("new-computed-hash");
            // createComposeConfig throws to simulate invalid YAML (propagated from parseComposeContent)
            mockCreateComposeConfig.mockImplementation(() => {
                throw new Error("Invalid YAML");
            });

            await (fileWatcher as any).handleFileChange(fakePath);

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
            mockHashContent.mockReturnValue("new-computed-hash");

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
            mockHashContent.mockReturnValue("new-computed-hash");
            mockCreateComposeConfig.mockImplementation(() => {
                throw new Error("Invalid YAML");
            });

            await (fileWatcher as any).handleFileChange(fakePath);

            expect(mockBroadcaster.publish).toHaveBeenCalledWith(
                expect.objectContaining({type: "config_error", stackId: fakeStack.id}),
            );
        });

        it("does NOT create event when hash is unchanged (no false positives)", async () => {
            const fakePath = "/stacks/my-stack/docker-compose.yml";
            const fakeStack = {id: "stack-1", composeFilePath: fakePath, hash: "same-hash"};
            mockRepo.findStackByPath.mockResolvedValue(fakeStack);
            // Hash equals stored hash — no change
            mockHashContent.mockReturnValue("same-hash");

            await (fileWatcher as any).handleFileChange(fakePath);

            expect(mockRepo.createStackEvent).not.toHaveBeenCalled();
            expect(mockBroadcaster.publish).not.toHaveBeenCalled();
        });

        it("calls repo.syncServicesFromCompose with stack.id and the parsed ComposeConfig", async () => {
            const fakePath = "/stacks/my-stack/docker-compose.yml";
            const fakeStack = {id: "stack-1", composeFilePath: fakePath, hash: "old-hash"};
            const fakeComposeConfig = {
                hash: "new-computed-hash",
                services: [{serviceName: "app", image: "nginx", imageTag: "1.25", ports: [], volumes: []}],
            };
            mockRepo.findStackByPath.mockResolvedValue(fakeStack);
            mockRepo.updateStackHash.mockResolvedValue(undefined);
            mockRepo.createStackEvent.mockResolvedValue(undefined);
            mockHashContent.mockReturnValue("new-computed-hash");
            mockCreateComposeConfig.mockReturnValue(fakeComposeConfig);

            await (fileWatcher as any).handleFileChange(fakePath);

            expect(mockRepo.syncServicesFromCompose).toHaveBeenCalledWith(fakeStack.id, fakeComposeConfig);
        });

        it("calls repo.syncServicesFromCompose before repo.updateStackHash", async () => {
            const fakePath = "/stacks/my-stack/docker-compose.yml";
            const fakeStack = {id: "stack-1", composeFilePath: fakePath, hash: "old-hash"};
            mockRepo.findStackByPath.mockResolvedValue(fakeStack);
            mockRepo.updateStackHash.mockResolvedValue(undefined);
            mockRepo.createStackEvent.mockResolvedValue(undefined);
            mockHashContent.mockReturnValue("new-computed-hash");

            await (fileWatcher as any).handleFileChange(fakePath);

            const syncOrder = mockRepo.syncServicesFromCompose.mock.invocationCallOrder[0];
            const updateHashOrder = mockRepo.updateStackHash.mock.invocationCallOrder[0];
            expect(syncOrder).toBeLessThan(updateHashOrder);
        });

        it("does NOT call updateStackHash or publish config_changed when syncServicesFromCompose rejects", async () => {
            const fakePath = "/stacks/my-stack/docker-compose.yml";
            const fakeStack = {id: "stack-1", composeFilePath: fakePath, hash: "old-hash"};
            mockRepo.findStackByPath.mockResolvedValue(fakeStack);
            mockRepo.updateStackHash.mockResolvedValue(undefined);
            mockRepo.createStackEvent.mockResolvedValue(undefined);
            mockHashContent.mockReturnValue("new-computed-hash");
            mockRepo.syncServicesFromCompose.mockRejectedValue(new Error("sync failed"));

            await expect((fileWatcher as any).handleFileChange(fakePath)).rejects.toThrow("sync failed");

            expect(mockRepo.updateStackHash).not.toHaveBeenCalled();
            expect(mockBroadcaster.publish).not.toHaveBeenCalledWith(
                expect.objectContaining({type: "config_changed"}),
            );
        });

        it("does NOT call syncServicesFromCompose when the hash is unchanged", async () => {
            const fakePath = "/stacks/my-stack/docker-compose.yml";
            const fakeStack = {id: "stack-1", composeFilePath: fakePath, hash: "same-hash"};
            mockRepo.findStackByPath.mockResolvedValue(fakeStack);
            mockHashContent.mockReturnValue("same-hash");

            await (fileWatcher as any).handleFileChange(fakePath);

            expect(mockRepo.syncServicesFromCompose).not.toHaveBeenCalled();
        });
    });

    describe("reconcile() (FW-03)", () => {
        it("re-hashes all stacks and updates DB for stacks whose hash changed", async () => {
            const stacks = [
                {id: "stack-1", composeFilePath: "/stacks/s1/docker-compose.yml", hash: "old-hash-1"},
                {id: "stack-2", composeFilePath: "/stacks/s2/docker-compose.yml", hash: "old-hash-2"},
            ];
            mockRepo.findAllStacks.mockResolvedValue(stacks);
            mockRepo.findStackByPath.mockImplementation(async (path: string) =>
                stacks.find((s) => s.composeFilePath === path) ?? null,
            );
            mockRepo.updateStackHash.mockResolvedValue(undefined);
            mockRepo.createStackEvent.mockResolvedValue(undefined);
            // Computed hash differs from stored hash
            mockHashContent.mockReturnValue("new-hash-differs");

            await (fileWatcher as any).reconcile();

            expect(mockRepo.findAllStacks).toHaveBeenCalled();
            // At least one stack should have its hash updated (since hashes differ)
            expect(mockRepo.updateStackHash).toHaveBeenCalled();
        });

        it("does not update DB when hash matches lastKnownHash", async () => {
            const stacks = [
                {id: "stack-1", composeFilePath: "/stacks/s1/docker-compose.yml", hash: "current-hash"},
            ];
            mockRepo.findAllStacks.mockResolvedValue(stacks);
            // Computed hash equals stored hash — no update
            mockHashContent.mockReturnValue("current-hash");

            await (fileWatcher as any).reconcile();

            expect(mockRepo.updateStackHash).not.toHaveBeenCalled();
        });
    });
});
