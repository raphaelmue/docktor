import {beforeEach, describe, expect, it, vi} from "vitest";
import {render, screen} from "@testing-library/react";
import {MemoryRouter, Route, Routes} from "react-router";
import {FirstRunGate} from "../../../../../src/components/domain/auth/first-run-gate";
import {resetSetupStatusCacheForTests} from "@/hooks/use-setup-status";
import {checkSetupStatus} from "@/lib/setup-api";

vi.mock("@/lib/setup-api", () => ({
    checkSetupStatus: vi.fn(),
}));

const mockCheckSetupStatus = vi.mocked(checkSetupStatus);

beforeEach(() => {
    mockCheckSetupStatus.mockReset();
    // useSetupStatus caches the resolved status at module scope — reset it
    // so each test's mock resolution is actually exercised.
    resetSetupStatusCacheForTests();
});

function renderGate() {
    return render(
        <MemoryRouter initialEntries={["/"]}>
            <Routes>
                <Route
                    path="/"
                    element={
                        <FirstRunGate>
                            <div>login-fallback</div>
                        </FirstRunGate>
                    }
                />
                <Route path="/setup" element={<div>setup-wizard</div>} />
            </Routes>
        </MemoryRouter>,
    );
}

describe("FirstRunGate", () => {
    it("renders the /setup route and not the child when the instance has no users", async () => {
        mockCheckSetupStatus.mockResolvedValue({setupComplete: false});

        renderGate();

        await screen.findByText("setup-wizard");
        expect(screen.queryByText("login-fallback")).not.toBeInTheDocument();
    });

    it("renders the child and not /setup when the instance is already configured", async () => {
        mockCheckSetupStatus.mockResolvedValue({setupComplete: true});

        renderGate();

        await screen.findByText("login-fallback");
        expect(screen.queryByText("setup-wizard")).not.toBeInTheDocument();
    });

    it("fails safe to the child and not /setup when the status check rejects", async () => {
        mockCheckSetupStatus.mockRejectedValue(new Error("Service Unavailable"));

        renderGate();

        await screen.findByText("login-fallback");
        expect(screen.queryByText("setup-wizard")).not.toBeInTheDocument();
    });

    it("renders a loading shell and neither branch while the check is pending", () => {
        mockCheckSetupStatus.mockReturnValue(new Promise(() => {}));

        renderGate();

        expect(screen.getByText("Loading...")).toBeInTheDocument();
        expect(screen.queryByText("login-fallback")).not.toBeInTheDocument();
        expect(screen.queryByText("setup-wizard")).not.toBeInTheDocument();
    });
});
