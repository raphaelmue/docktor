import {beforeEach, describe, expect, it, vi} from "vitest";
import {render, screen, waitFor} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {ProxySettingsCard} from "@/routes/app/settings/components/proxy-settings-card";
import {deployProxyStack, getProxySettings, saveProxySettings, type ProxyState} from "@/lib/proxy-api";

// jsdom has no ResizeObserver — Radix's Switch (via @radix-ui/react-use-size)
// requires one to measure the thumb on mount.
if (typeof globalThis.ResizeObserver === "undefined") {
    globalThis.ResizeObserver = class {
        observe() {}
        unobserve() {}
        disconnect() {}
    } as unknown as typeof ResizeObserver;
}

vi.mock("@/lib/proxy-api", () => ({
    getProxySettings: vi.fn(),
    saveProxySettings: vi.fn(),
    deployProxyStack: vi.fn(),
}));

vi.mock("sonner", () => ({
    toast: {
        promise: vi.fn((promise: Promise<unknown>, opts: any) => {
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

// Bumped from the 5s default: this suite is CPU-bound (userEvent interactions
// + full ProxySettingsCard render with Form/Switch) and flakes under this
// host's full-parallel-suite resource contention, the same documented class
// of flake as proxy-tab.test.tsx/stack-actions.test.tsx (05.1-01-SUMMARY.md/
// STATE.md) — every test here passes reliably in isolation or in small groups.
vi.setConfig({testTimeout: 15000});

const mockGetProxySettings = vi.mocked(getProxySettings);
const mockSaveProxySettings = vi.mocked(saveProxySettings);
const mockDeployProxyStack = vi.mocked(deployProxyStack);

function makeState(overrides: Partial<ProxyState> = {}): ProxyState {
    return {
        deployed: true,
        status: "RUNNING",
        acmeEmail: "",
        showInDashboard: false,
        ...overrides,
    };
}

beforeEach(() => {
    mockGetProxySettings.mockReset();
    mockSaveProxySettings.mockReset();
    mockDeployProxyStack.mockReset();
});

describe("ProxySettingsCard", () => {
    it('labels the primary submit "Save Proxy Settings"', async () => {
        mockGetProxySettings.mockResolvedValue(makeState());
        render(<ProxySettingsCard />);

        expect(await screen.findByRole("button", {name: "Save Proxy Settings"})).toBeInTheDocument();
    });

    it("shows a Deploy Proxy Stack button when the proxy stack is not deployed", async () => {
        mockGetProxySettings.mockResolvedValue(makeState({deployed: false, status: null}));
        render(<ProxySettingsCard />);

        expect(await screen.findByRole("button", {name: "Deploy Proxy Stack"})).toBeInTheDocument();
    });

    it("does not show a Deploy Proxy Stack button when already deployed", async () => {
        mockGetProxySettings.mockResolvedValue(makeState({deployed: true}));
        render(<ProxySettingsCard />);

        await screen.findByRole("button", {name: "Save Proxy Settings"});
        expect(screen.queryByRole("button", {name: "Deploy Proxy Stack"})).not.toBeInTheDocument();
    });

    it("renders the D-11 alert and the raw deploy error verbatim on a failed deploy", async () => {
        mockGetProxySettings.mockResolvedValue(makeState({deployed: false, status: null}));
        mockDeployProxyStack.mockRejectedValue(
            new Error(
                'Failed to deploy the proxy stack: Host port 80 is already published by container "web-1": bind: address already in use',
            ),
        );
        const user = userEvent.setup();

        render(<ProxySettingsCard />);
        await user.click(await screen.findByRole("button", {name: "Deploy Proxy Stack"}));

        expect(
            await screen.findByText(/could not deploy the proxy stack — ports 80\/443 are already in use/i),
        ).toBeInTheDocument();
        expect(await screen.findByText(/bind: address already in use/)).toBeInTheDocument();
    });

    it("accepts an empty ACME email and calls saveProxySettings", async () => {
        mockGetProxySettings.mockResolvedValue(makeState());
        mockSaveProxySettings.mockResolvedValue(undefined);
        const user = userEvent.setup();

        render(<ProxySettingsCard />);
        await user.click(await screen.findByRole("button", {name: "Save Proxy Settings"}));

        await waitFor(() =>
            expect(mockSaveProxySettings).toHaveBeenCalledWith(
                expect.objectContaining({acmeEmail: ""}),
            ),
        );
    });

    it("leaves saveProxySettings uncalled for an invalid ACME email", async () => {
        mockGetProxySettings.mockResolvedValue(makeState());
        const user = userEvent.setup();

        render(<ProxySettingsCard />);
        const emailInput = await screen.findByLabelText(/acme email/i);
        await user.type(emailInput, "not-an-email");
        await user.click(screen.getByRole("button", {name: "Save Proxy Settings"}));

        expect(await screen.findByText(/email/i)).toBeInTheDocument();
        expect(mockSaveProxySettings).not.toHaveBeenCalled();
    });
});
