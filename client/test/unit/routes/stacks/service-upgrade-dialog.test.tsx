import {beforeEach, describe, expect, it, vi} from "vitest";
import {render, screen, waitFor, within} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {ServiceUpgradeDialog} from "../../../../src/routes/app/stacks/components/service-upgrade-dialog";
import {getServiceTags, upgradeService} from "@/lib/stacks-api";
import {ApiError} from "@/lib/api";

vi.mock("@/lib/stacks-api", () => ({
    getServiceTags: vi.fn(),
    upgradeService: vi.fn(),
}));

// Capture the loading/success/error callbacks toast.promise is invoked with,
// so assertions can read the exact message text without needing a mounted
// <Toaster/> or relying on sonner's internal rendering.
vi.mock("sonner", () => ({
    toast: {
        promise: vi.fn((promise: Promise<unknown>, opts: any) => {
            promise.then(
                (result) => opts.success?.(result),
                (err) => opts.error?.(err),
            );
            return promise;
        }),
    },
}));

// Radix Select needs these in jsdom; jsdom itself doesn't implement them.
if (!Element.prototype.hasPointerCapture) {
    Element.prototype.hasPointerCapture = vi.fn().mockReturnValue(false);
}
if (!Element.prototype.releasePointerCapture) {
    Element.prototype.releasePointerCapture = vi.fn();
}
if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = vi.fn();
}

const mockGetServiceTags = vi.mocked(getServiceTags);
const mockUpgradeService = vi.mocked(upgradeService);

function renderDialog(overrides?: Partial<React.ComponentProps<typeof ServiceUpgradeDialog>>) {
    const onOpenChange = vi.fn();
    const onUpgraded = vi.fn();
    const utils = render(
        <ServiceUpgradeDialog
            stackId="my-stack"
            serviceName="web"
            currentTag="1.25"
            open
            onOpenChange={onOpenChange}
            onUpgraded={onUpgraded}
            {...overrides}
        />,
    );
    return {...utils, onOpenChange, onUpgraded};
}

beforeEach(() => {
    mockGetServiceTags.mockReset();
    mockUpgradeService.mockReset();
});

describe("ServiceUpgradeDialog", () => {
    it("shows a loading state while the tags request is pending", () => {
        mockGetServiceTags.mockReturnValue(new Promise(() => {}));

        renderDialog();

        expect(screen.getByRole("status", {name: /loading available versions/i})).toBeInTheDocument();
    });

    it("renders one option per candidate with the latest preselected", async () => {
        mockGetServiceTags.mockResolvedValue({
            currentTag: "1.25",
            latestTag: "1.27",
            candidates: ["1.27", "1.26"],
        });

        renderDialog();

        const trigger = await screen.findByRole("combobox", {name: /target version/i});
        expect(trigger).toHaveTextContent("1.27");

        await userEvent.click(trigger);
        const listbox = await screen.findByRole("listbox");
        const options = within(listbox).getAllByRole("option");
        expect(options).toHaveLength(2);
        expect(options.map((o) => o.textContent)).toEqual(["1.27", "1.26"]);
    });

    it("renders a distinct message when the service is already on the newest version", async () => {
        mockGetServiceTags.mockResolvedValue({
            currentTag: "1.27",
            latestTag: "1.27",
            candidates: [],
        });

        renderDialog();

        expect(
            await screen.findByText(/already on the newest known version/i),
        ).toBeInTheDocument();
    });

    it("renders a distinct message when the image has never been checked", async () => {
        mockGetServiceTags.mockResolvedValue({
            currentTag: "1.25",
            latestTag: null,
            candidates: [],
        });

        renderDialog();

        expect(
            await screen.findByText(/has not been checked for this image yet/i),
        ).toBeInTheDocument();
    });

    it("asserts the two empty-state messages are distinct strings", async () => {
        mockGetServiceTags.mockResolvedValueOnce({
            currentTag: "1.27",
            latestTag: "1.27",
            candidates: [],
        });
        const {unmount} = renderDialog();
        const upToDateMessage = await screen.findByText(/already on the newest known version/i);
        const upToDateText = upToDateMessage.textContent;
        unmount();

        mockGetServiceTags.mockResolvedValueOnce({
            currentTag: "1.25",
            latestTag: null,
            candidates: [],
        });
        renderDialog();
        const neverCheckedMessage = await screen.findByText(/has not been checked for this image yet/i);

        expect(neverCheckedMessage.textContent).not.toEqual(upToDateText);
    });

    it("renders the error message and a working retry on a failed request", async () => {
        mockGetServiceTags.mockRejectedValueOnce(new ApiError("Registry unreachable", 502));

        renderDialog();

        expect(await screen.findByText("Registry unreachable")).toBeInTheDocument();

        mockGetServiceTags.mockResolvedValueOnce({
            currentTag: "1.25",
            latestTag: "1.27",
            candidates: ["1.27"],
        });
        await userEvent.click(screen.getByRole("button", {name: /retry/i}));

        await screen.findByRole("combobox", {name: /target version/i});
        expect(mockGetServiceTags).toHaveBeenCalledTimes(2);
    });

    it("calls upgradeService with the stack id, service name and selected tag exactly once on confirm", async () => {
        mockGetServiceTags.mockResolvedValue({
            currentTag: "1.25",
            latestTag: "1.27",
            candidates: ["1.27", "1.26"],
        });
        mockUpgradeService.mockResolvedValue({
            success: true,
            changed: true,
            previousTag: "1.25",
            newTag: "1.27",
        });

        const {onUpgraded} = renderDialog();

        await screen.findByRole("combobox", {name: /target version/i});
        await userEvent.click(screen.getByRole("button", {name: /^upgrade$/i}));

        await waitFor(() => expect(mockUpgradeService).toHaveBeenCalledTimes(1));
        expect(mockUpgradeService).toHaveBeenCalledWith("my-stack", "web", "1.27");
        await waitFor(() => expect(onUpgraded).toHaveBeenCalledTimes(1));
    });

    it("shows the no-change message (not the applied-upgrade message) when changed is false", async () => {
        mockGetServiceTags.mockResolvedValue({
            currentTag: "1.25",
            latestTag: "1.26",
            candidates: ["1.26"],
        });
        mockUpgradeService.mockResolvedValue({
            success: true,
            changed: false,
            previousTag: "1.26",
            newTag: "1.26",
        });

        renderDialog();

        await screen.findByRole("combobox", {name: /target version/i});
        await userEvent.click(screen.getByRole("button", {name: /^upgrade$/i}));

        await waitFor(() => expect(mockUpgradeService).toHaveBeenCalledTimes(1));

        const {toast} = await import("sonner");
        const promiseCall = vi.mocked(toast.promise).mock.calls[0];
        const successMessage = promiseCall[1].success({
            success: true,
            changed: false,
            previousTag: "1.26",
            newTag: "1.26",
        });
        expect(successMessage).toMatch(/already on 1\.26/i);
        expect(successMessage).not.toMatch(/upgraded to/i);
    });

    it("fires onUpgraded after a successful confirm", async () => {
        mockGetServiceTags.mockResolvedValue({
            currentTag: "1.25",
            latestTag: "1.27",
            candidates: ["1.27"],
        });
        mockUpgradeService.mockResolvedValue({
            success: true,
            changed: true,
            previousTag: "1.25",
            newTag: "1.27",
        });

        const {onUpgraded} = renderDialog();

        await screen.findByRole("combobox", {name: /target version/i});
        await userEvent.click(screen.getByRole("button", {name: /^upgrade$/i}));

        await waitFor(() => expect(onUpgraded).toHaveBeenCalledTimes(1));
    });
});
