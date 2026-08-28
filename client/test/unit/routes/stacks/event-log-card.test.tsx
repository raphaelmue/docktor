import {beforeEach, describe, expect, it, vi} from "vitest";
import {render, screen, waitFor} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {EventLogCard, describeStackEvent} from "../../../../src/routes/app/stacks/components/event-log-card";
import {getStackEvents, type StackEvent} from "@/lib/stacks-api";
import type {StateEvent} from "@/hooks/use-container-events";

vi.mock("@/lib/stacks-api", () => ({
    getStackEvents: vi.fn(),
}));

vi.mock("@/hooks/use-container-events", () => ({
    useContainerEvents: vi.fn((_handler: (event: StateEvent) => void) => {}),
}));

const mockGetStackEvents = vi.mocked(getStackEvents);

beforeEach(() => {
    mockGetStackEvents.mockReset();
});

function makeEvent(overrides: Partial<StackEvent>): StackEvent {
    return {
        id: "1",
        type: "config_changed",
        message: null,
        payload: null,
        createdAt: "2026-08-28T12:00:00Z",
        ...overrides,
    };
}

describe("EventLogCard", () => {
    it("is reachable by its accessible heading, distinct from the status log's heading", async () => {
        mockGetStackEvents.mockResolvedValue([]);

        render(<EventLogCard stackId="my-app" />);

        const heading = await screen.findByRole("heading", {name: "Event Log"});
        expect(heading).toBeInTheDocument();
        expect(heading.textContent).not.toBe("Status Log");
    });

    it("shows a loading state while the initial load is in flight", () => {
        mockGetStackEvents.mockReturnValue(new Promise(() => {}));

        render(<EventLogCard stackId="my-app" />);

        expect(screen.getByRole("status", {name: /loading events/i})).toBeInTheDocument();
        expect(screen.queryByText(/no events recorded/i)).not.toBeInTheDocument();
    });

    it("renders an explicit empty message when the stack has no recorded events", async () => {
        mockGetStackEvents.mockResolvedValue([]);

        render(<EventLogCard stackId="my-app" />);

        expect(await screen.findByText(/no events recorded/i)).toBeInTheDocument();
    });

    it("renders a config_changed entry naming its type and saying the compose file changed on disk", async () => {
        mockGetStackEvents.mockResolvedValue([
            makeEvent({id: "1", type: "config_changed"}),
        ]);

        render(<EventLogCard stackId="my-app" />);

        expect(await screen.findByText("Config Changed")).toBeInTheDocument();
        expect(screen.getByText(/compose file changed on disk/i)).toBeInTheDocument();
    });

    it("renders a config_error entry with its stored message and a distinct badge variant", async () => {
        mockGetStackEvents.mockResolvedValue([
            makeEvent({id: "1", type: "config_error", message: "services: is required"}),
        ]);

        render(<EventLogCard stackId="my-app" />);

        expect(await screen.findByText("Config Error")).toBeInTheDocument();
        expect(screen.getByText("services: is required")).toBeInTheDocument();

        const errorBadge = screen.getByText("Config Error");
        expect(errorBadge).toHaveAttribute("data-variant", "destructive");
    });

    it("renders an update_available entry naming its type and the image reference it carries", async () => {
        mockGetStackEvents.mockResolvedValue([
            makeEvent({id: "1", type: "update_available", message: "nginx:1.27"}),
        ]);

        render(<EventLogCard stackId="my-app" />);

        expect(await screen.findByText("Update Available")).toBeInTheDocument();
        expect(screen.getByText("nginx:1.27")).toBeInTheDocument();
    });

    it("badge variants for the three types are all visibly distinct", async () => {
        mockGetStackEvents.mockResolvedValue([
            makeEvent({id: "1", type: "config_changed"}),
            makeEvent({id: "2", type: "config_error", message: "bad yaml"}),
            makeEvent({id: "3", type: "update_available", message: "nginx:1.27"}),
        ]);

        render(<EventLogCard stackId="my-app" />);

        const changedBadge = await screen.findByText("Config Changed");
        const errorBadge = screen.getByText("Config Error");
        const updateBadge = screen.getByText("Update Available");

        const variants = [changedBadge, errorBadge, updateBadge].map((b) =>
            b.getAttribute("data-variant"),
        );
        expect(new Set(variants).size).toBe(3);
    });

    it("renders an entry with a malformed payload without throwing", async () => {
        mockGetStackEvents.mockResolvedValue([
            makeEvent({id: "1", type: "config_changed", payload: "{not valid json"}),
        ]);

        render(<EventLogCard stackId="my-app" />);

        expect(await screen.findByText("Config Changed")).toBeInTheDocument();
        expect(screen.getByText(/compose file changed on disk/i)).toBeInTheDocument();
    });

    it("renders an entry with an absent payload without throwing", async () => {
        mockGetStackEvents.mockResolvedValue([
            makeEvent({id: "1", type: "config_changed", payload: null}),
        ]);

        render(<EventLogCard stackId="my-app" />);

        expect(await screen.findByText("Config Changed")).toBeInTheDocument();
    });

    it("renders an entry with an empty-string payload without throwing", async () => {
        mockGetStackEvents.mockResolvedValue([
            makeEvent({id: "1", type: "config_changed", payload: ""}),
        ]);

        render(<EventLogCard stackId="my-app" />);

        expect(await screen.findByText("Config Changed")).toBeInTheDocument();
    });

    it("renders the error message and a retry control on a failed initial load, and re-runs the request", async () => {
        mockGetStackEvents.mockRejectedValueOnce(new Error("Failed to fetch stack events"));

        render(<EventLogCard stackId="my-app" />);

        expect(await screen.findByText("Failed to fetch stack events")).toBeInTheDocument();

        mockGetStackEvents.mockResolvedValueOnce([makeEvent({id: "1", type: "config_changed"})]);
        await userEvent.click(screen.getByRole("button", {name: /retry/i}));

        await waitFor(() => expect(mockGetStackEvents).toHaveBeenCalledTimes(2));
        expect(await screen.findByText("Config Changed")).toBeInTheDocument();
    });
});

describe("describeStackEvent", () => {
    it("returns the fixed compose-changed text when the payload cannot be parsed", () => {
        const result = describeStackEvent(
            makeEvent({type: "config_changed", payload: "{not valid json"}),
        );
        expect(result.label).toBe("Config Changed");
        expect(result.description).toMatch(/compose file changed on disk/i);
    });

    it("appends short hash forms when the payload parses with both hashes", () => {
        const result = describeStackEvent(
            makeEvent({
                type: "config_changed",
                payload: JSON.stringify({oldHash: "abcdef1234567890", newHash: "1234567890abcdef"}),
            }),
        );
        expect(result.description).toMatch(/compose file changed on disk/i);
        expect(result.description).toContain("abcdef1");
        expect(result.description).toContain("1234567");
    });

    it("returns the stored message for config_error", () => {
        const result = describeStackEvent(
            makeEvent({type: "config_error", message: "services: is required"}),
        );
        expect(result.label).toBe("Config Error");
        expect(result.description).toBe("services: is required");
        expect(result.variant).toBe("destructive");
    });

    it("returns the message (image reference) for update_available", () => {
        const result = describeStackEvent(
            makeEvent({type: "update_available", message: "nginx:1.27"}),
        );
        expect(result.label).toBe("Update Available");
        expect(result.description).toBe("nginx:1.27");
    });
});
