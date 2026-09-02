import {beforeEach, describe, expect, it, vi} from "vitest";
import {render, screen, waitFor} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {MemoryRouter, Route, Routes} from "react-router";
import StackDetailPage from "../../../../src/routes/app/stacks/[id]";
import {useStack} from "@/hooks/use-stack";
import {getComposeContent, getEnvContent, updateStack} from "@/lib/stacks-api";
import type {StackDetail} from "@/lib/stacks-api";
import {SidebarProvider} from "@/components/ui/sidebar";

// Task 3 (05.1-02): handleSaveCompose()/handleSaveEnv() must call refetch()
// after a successful save (so the configChanged banner reflects the save on
// the same tab that made it, with no manual reload) and must NOT call it on
// a failed save (so the editor contents and dirty flag are left alone).
//
// useStack is mocked wholesale rather than exercised through the real hook:
// this test is only asserting the page's call-site sequencing around
// updateStack() — that refetch is reached exactly when the save succeeds —
// which is orthogonal to what refetch() itself does once invoked (already
// covered by client/test/unit/hooks/use-stack.test.ts).

vi.mock("@/hooks/use-stack", () => ({
    useStack: vi.fn(),
}));

vi.mock("@/lib/stacks-api", () => ({
    getComposeContent: vi.fn(),
    getEnvContent: vi.fn(),
    updateStack: vi.fn(),
}));

// Mirrors the pattern in service-upgrade-dialog.test.tsx: resolve/reject the
// underlying promise and invoke sonner's success/error callbacks directly,
// without needing a mounted <Toaster/>.
vi.mock("sonner", () => ({
    toast: {
        promise: vi.fn((promise: Promise<unknown>, opts: any) => {
            // success/error here may be a static string (as [id].tsx passes)
            // rather than a callback — only invoke when it's actually a function.
            promise.then(
                (result) => {
                    if (typeof opts.success === "function") opts.success(result);
                },
                (err) => {
                    if (typeof opts.error === "function") opts.error(err);
                },
            );
            return promise.catch(() => {});
        }),
    },
}));

// Every child component below fetches its own data or renders unrelated
// concerns; stubbing them keeps this test isolated to the page's own
// save/refetch wiring instead of re-testing StackActions, BackupsTab, etc.
vi.mock("@/components/domain/stack/stack-status-badge", () => ({
    StackStatusBadge: () => null,
}));
vi.mock("@/components/domain/stack/log-viewer", () => ({
    LogViewer: () => null,
}));
vi.mock("../../../../src/routes/app/stacks/components/stack-actions", () => ({
    StackActions: () => null,
}));
vi.mock("../../../../src/routes/app/stacks/components/backups-tab", () => ({
    BackupsTab: () => null,
}));
vi.mock("../../../../src/routes/app/stacks/components/services-tab", () => ({
    ServicesTab: () => null,
}));
vi.mock("../../../../src/routes/app/stacks/components/event-log-card", () => ({
    EventLogCard: () => null,
}));
vi.mock("../../../../src/routes/app/stacks/components/status-log-card", () => ({
    StatusLogCard: () => null,
}));

const mockUseStack = vi.mocked(useStack);
const mockGetComposeContent = vi.mocked(getComposeContent);
const mockGetEnvContent = vi.mocked(getEnvContent);
const mockUpdateStack = vi.mocked(updateStack);

function makeStack(overrides: Partial<StackDetail> = {}): StackDetail {
    return {
        id: "my-app",
        displayName: "My App",
        description: null,
        hostPath: "/stacks/my-app",
        status: "RUNNING",
        configChanged: false,
        lastKnownHash: "hash-1",
        createdAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-01-01T00:00:00Z",
        services: [],
        deployments: [],
        statusLogs: [],
        ...overrides,
    };
}

function renderPage(tab: "compose" | "environment" = "compose") {
    return render(
        <SidebarProvider>
            <MemoryRouter initialEntries={[`/stacks/my-app/${tab}`]}>
                <Routes>
                    <Route path="/stacks/:id/:tab" element={<StackDetailPage />} />
                </Routes>
            </MemoryRouter>
        </SidebarProvider>,
    );
}

let refetch: ReturnType<typeof vi.fn>;

beforeEach(() => {
    mockUseStack.mockReset();
    mockGetComposeContent.mockReset();
    mockGetEnvContent.mockReset();
    mockUpdateStack.mockReset();
    refetch = vi.fn();

    mockGetComposeContent.mockResolvedValue({content: "services:\n  web:\n    image: nginx\n"});
    mockGetEnvContent.mockResolvedValue({content: "FOO=bar"});

    mockUseStack.mockReturnValue({
        stack: makeStack(),
        loading: false,
        isRefreshing: false,
        error: null,
        refetch,
    });

    // jsdom does not implement matchMedia; SidebarProvider's mobile-detection
    // hook (used by the Page shell this route renders into) requires it.
    if (typeof window.matchMedia !== "function") {
        window.matchMedia = vi.fn().mockImplementation((query: string) => ({
            matches: false,
            media: query,
            onchange: null,
            addListener: vi.fn(),
            removeListener: vi.fn(),
            addEventListener: vi.fn(),
            removeEventListener: vi.fn(),
            dispatchEvent: vi.fn(),
        }));
    }
});

// Timeouts bumped to 15s: this suite is CPU-bound (userEvent.type + full
// StackDetailPage render) and flakes under this host's full-parallel-suite
// resource contention at the 5s vitest default, even though every test
// passes reliably in isolation or in small groups — the same host-memory-
// pressure class of flake documented for Playwright in
// 05.1-01-SUMMARY.md/STATE.md, not a defect in the assertions themselves.
describe("StackDetailPage — save-triggered refetch (Task 3)", () => {
    it("calls refetch after a successful compose save", async () => {
        mockUpdateStack.mockResolvedValue(makeStack({configChanged: true}));
        const user = userEvent.setup();

        renderPage("compose");
        const textarea = await screen.findByRole("textbox");
        await user.type(textarea, " ");

        const saveButton = screen.getByRole("button", {name: /save/i});
        await user.click(saveButton);

        await waitFor(() => expect(mockUpdateStack).toHaveBeenCalledTimes(1));
        await waitFor(() => expect(refetch).toHaveBeenCalledTimes(1));
    }, 15000);

    it("does not call refetch when the compose save fails", async () => {
        mockUpdateStack.mockRejectedValue(new Error("save failed"));
        const user = userEvent.setup();

        renderPage("compose");
        const textarea = await screen.findByRole("textbox");
        await user.type(textarea, " ");

        const saveButton = screen.getByRole("button", {name: /save/i});
        await user.click(saveButton);

        await waitFor(() => expect(mockUpdateStack).toHaveBeenCalledTimes(1));
        expect(refetch).not.toHaveBeenCalled();
    }, 15000);

    it("calls refetch after a successful env save", async () => {
        mockUpdateStack.mockResolvedValue(makeStack({configChanged: true}));
        const user = userEvent.setup();

        renderPage("environment");
        const textarea = await screen.findByRole("textbox");
        await user.type(textarea, " ");

        const saveButton = screen.getByRole("button", {name: /save/i});
        await user.click(saveButton);

        await waitFor(() => expect(mockUpdateStack).toHaveBeenCalledTimes(1));
        await waitFor(() => expect(refetch).toHaveBeenCalledTimes(1));
    }, 15000);

    it("does not call refetch when the env save fails", async () => {
        mockUpdateStack.mockRejectedValue(new Error("save failed"));
        const user = userEvent.setup();

        renderPage("environment");
        const textarea = await screen.findByRole("textbox");
        await user.type(textarea, " ");

        const saveButton = screen.getByRole("button", {name: /save/i});
        await user.click(saveButton);

        await waitFor(() => expect(mockUpdateStack).toHaveBeenCalledTimes(1));
        expect(refetch).not.toHaveBeenCalled();
    }, 15000);
});
