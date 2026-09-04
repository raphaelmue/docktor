import {beforeEach, describe, expect, it, vi} from "vitest";
import {render, screen} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {MemoryRouter} from "react-router";
import {StackActions} from "@/routes/app/stacks/components/stack-actions";

// jsdom has no ResizeObserver — Radix's Tooltip content (via
// @radix-ui/react-use-size / positioning internals) requires one.
if (typeof globalThis.ResizeObserver === "undefined") {
    globalThis.ResizeObserver = class {
        observe() {}
        unobserve() {}
        disconnect() {}
    } as unknown as typeof ResizeObserver;
}

vi.mock("@/lib/stacks-api", () => ({
    deployStack: vi.fn(),
    stopStack: vi.fn(),
    restartStack: vi.fn(),
    updateImages: vi.fn(),
    deleteStack: vi.fn(),
}));

vi.mock("@/lib/backups-api", () => ({
    triggerBackup: vi.fn(),
}));

vi.mock("sonner", () => ({
    toast: {
        promise: vi.fn(),
        success: vi.fn(),
        error: vi.fn(),
    },
}));

function renderActions(overrides: Partial<React.ComponentProps<typeof StackActions>> = {}) {
    const onAction = overrides.onAction ?? vi.fn();
    render(
        <MemoryRouter>
            <StackActions
                stackId="my-app"
                stackName="My App"
                status={overrides.status ?? "RUNNING"}
                isProtected={overrides.isProtected ?? false}
                onAction={onAction}
            />
        </MemoryRouter>,
    );
    return {onAction};
}

async function openMenu() {
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", {name: "Stack actions"}));
    return user;
}

beforeEach(() => {
    vi.clearAllMocks();
});

describe("StackActions — protected stack (D-12)", () => {
    it("disables Stop and Restart but keeps Deploy and Update Images enabled for a protected running stack", async () => {
        renderActions({isProtected: true, status: "RUNNING"});
        // Radix marks everything outside an open dropdown aria-hidden, so the
        // Deploy button must be queried before the menu opens.
        expect(screen.getByRole("button", {name: /redeploy/i})).not.toBeDisabled();

        await openMenu();

        expect(screen.getByRole("menuitem", {name: /stop/i})).toHaveAttribute("aria-disabled", "true");
        expect(screen.getByRole("menuitem", {name: /restart/i})).toHaveAttribute("aria-disabled", "true");
        expect(screen.getByRole("menuitem", {name: /update images/i})).not.toHaveAttribute("aria-disabled", "true");
    });

    it("disables Delete for a protected stopped stack that would otherwise be deletable", async () => {
        renderActions({isProtected: true, status: "STOPPED"});
        await openMenu();

        expect(screen.getByRole("menuitem", {name: /delete/i})).toHaveAttribute("aria-disabled", "true");
    });

    it("keeps Stop and Restart enabled for a non-protected running stack", async () => {
        renderActions({isProtected: false, status: "RUNNING"});
        await openMenu();

        expect(screen.getByRole("menuitem", {name: /stop/i})).not.toHaveAttribute("aria-disabled", "true");
        expect(screen.getByRole("menuitem", {name: /restart/i})).not.toHaveAttribute("aria-disabled", "true");
    });

    it("keeps Delete enabled for a non-protected stopped stack", async () => {
        renderActions({isProtected: false, status: "STOPPED"});
        await openMenu();

        expect(screen.getByRole("menuitem", {name: /delete/i})).not.toHaveAttribute("aria-disabled", "true");
    });

    it("exposes the protected-stack tooltip text for a disabled control", async () => {
        renderActions({isProtected: true, status: "RUNNING"});
        const user = await openMenu();

        await user.hover(screen.getByRole("menuitem", {name: /stop/i}));

        // Radix's Tooltip.Content renders both the positioned copy and a
        // screen-reader-only duplicate, so two matches is the expected shape.
        const matches = await screen.findAllByText(
            "This stack is managed by Docktor and cannot be stopped, restarted, or deleted directly.",
        );
        expect(matches.length).toBeGreaterThan(0);
    });
});
