import {describe, expect, it, vi, beforeEach} from "vitest";
import {StatePoller} from "../../../../src/jobs/state-poller.js";

// StatePoller accepts DockerodeClient and StackRepository via constructor for testability.
// This allows mocking without module-level vi.mock() calls.

const TRANSITIONAL_STATES = ["DEPLOYING", "UPDATING", "BACKING_UP", "RESTORING", "MIGRATING"] as const;

function createMockDockerodeClient() {
    return {
        getEventStream: vi.fn(),
        inspectContainer: vi.fn(),
        listContainers: vi.fn(),
        getLogStream: vi.fn(),
    };
}

function createMockStackRepository() {
    return {
        findByComposeProject: vi.fn(),
        findAll: vi.fn(),
        updateServiceState: vi.fn(),
        updateStackStatus: vi.fn(),
        findServiceByContainerId: vi.fn(),
    };
}

describe("StatePoller", () => {
    let poller: StatePoller;
    let mockDockerClient: ReturnType<typeof createMockDockerodeClient>;
    let mockStackRepo: ReturnType<typeof createMockStackRepository>;

    beforeEach(() => {
        vi.clearAllMocks();
        mockDockerClient = createMockDockerodeClient();
        mockStackRepo = createMockStackRepository();
        poller = new StatePoller(mockDockerClient as any, mockStackRepo as any);
    });

    describe("handleEvent (OBS-02)", () => {
        it("calls dockerode inspectContainer for the event's container ID", async () => {
            const event = {
                Type: "container",
                Action: "start",
                Actor: {
                    ID: "container-abc",
                    Attributes: {
                        "com.docker.compose.project": "my-stack",
                        "com.docker.compose.service": "web",
                    },
                },
            };

            const inspectResult = {
                Id: "container-abc",
                State: {Status: "running", Health: {Status: "healthy"}},
            };
            mockDockerClient.inspectContainer.mockResolvedValue(inspectResult);
            mockStackRepo.findByComposeProject.mockResolvedValue({
                id: "my-stack",
                status: "RUNNING",
                services: [{serviceName: "web"}],
            });
            mockStackRepo.updateStackStatus.mockResolvedValue(null);

            await (poller as any).handleEvent(event);

            expect(mockDockerClient.inspectContainer).toHaveBeenCalledWith("container-abc");
        });

        it("updates DB service row with containerState and healthStatus from inspect result", async () => {
            const event = {
                Type: "container",
                Action: "health_status",
                Actor: {
                    ID: "container-xyz",
                    Attributes: {
                        "com.docker.compose.project": "my-stack",
                        "com.docker.compose.service": "web",
                    },
                },
            };

            const inspectResult = {
                Id: "container-xyz",
                State: {Status: "running", Health: {Status: "healthy"}},
            };
            mockDockerClient.inspectContainer.mockResolvedValue(inspectResult);
            mockStackRepo.findByComposeProject.mockResolvedValue({
                id: "my-stack",
                status: "RUNNING",
                services: [{serviceName: "web"}],
            });
            mockStackRepo.updateStackStatus.mockResolvedValue(null);

            await (poller as any).handleEvent(event);

            expect(mockStackRepo.updateServiceState).toHaveBeenCalledWith(
                expect.objectContaining({
                    containerState: "running",
                    healthStatus: "healthy",
                }),
            );
        });
    });

    describe("handleEvent — skip conditions (OBS-03)", () => {
        it.each(TRANSITIONAL_STATES)(
            "skips update when stack.status is '%s' (transitional state)",
            async (transitionalStatus) => {
                const event = {
                    Type: "container",
                    Action: "start",
                    Actor: {
                        ID: "container-abc",
                        Attributes: {
                            "com.docker.compose.project": "my-stack",
                            "com.docker.compose.service": "web",
                        },
                    },
                };

                mockStackRepo.findByComposeProject.mockResolvedValue({
                    id: "my-stack",
                    status: transitionalStatus,
                    services: [],
                });

                await (poller as any).handleEvent(event);

                expect(mockDockerClient.inspectContainer).not.toHaveBeenCalled();
                expect(mockStackRepo.updateServiceState).not.toHaveBeenCalled();
            },
        );

        it("skips when container has no com.docker.compose.project label", async () => {
            const event = {
                Type: "container",
                Action: "start",
                Actor: {
                    ID: "container-abc",
                    // No compose labels — unmanaged container
                    Attributes: {},
                },
            };

            await (poller as any).handleEvent(event);

            expect(mockDockerClient.inspectContainer).not.toHaveBeenCalled();
            expect(mockStackRepo.updateServiceState).not.toHaveBeenCalled();
        });
    });

    describe("reconcile (OBS-04)", () => {
        it.todo("calls dockerode.listContainers and updates all matched services in DB");

        it.todo("does not update stacks in transitional states");
    });
});
