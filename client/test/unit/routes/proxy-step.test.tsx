import {describe, expect, it, vi} from "vitest";
import {render, screen} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {ProxyStep} from "../../../src/routes/setup/components/proxy-step";

function renderProxyStep(overrides: Partial<React.ComponentProps<typeof ProxyStep>> = {}) {
    const onSubmit = overrides.onSubmit ?? vi.fn().mockResolvedValue(undefined);
    const onBack = overrides.onBack ?? vi.fn();
    const onSkip = overrides.onSkip ?? vi.fn();
    const loading = overrides.loading ?? false;
    const deployError = overrides.deployError ?? null;

    render(
        <ProxyStep onSubmit={onSubmit} onBack={onBack} onSkip={onSkip} loading={loading} deployError={deployError} />,
    );

    return {onSubmit, onBack, onSkip};
}

describe("ProxyStep", () => {
    it("renders an optional ACME email field", () => {
        renderProxyStep();

        expect(screen.getByLabelText(/acme email/i)).toBeInTheDocument();
    });

    it("renders Back, Skip, and a 'Deploy Proxy Stack' primary submit button — never 'Next'", () => {
        renderProxyStep();

        expect(screen.getByRole("button", {name: "Back"})).toBeInTheDocument();
        expect(screen.getByRole("button", {name: "Skip"})).toBeInTheDocument();
        expect(screen.getByRole("button", {name: "Deploy Proxy Stack"})).toBeInTheDocument();
        expect(screen.queryByRole("button", {name: "Next"})).not.toBeInTheDocument();
    });

    it("calls onSubmit with an empty acmeEmail when the field is left blank", async () => {
        const user = userEvent.setup();
        const {onSubmit} = renderProxyStep();

        await user.click(screen.getByRole("button", {name: "Deploy Proxy Stack"}));

        expect(await screen.findByRole("button", {name: "Deploy Proxy Stack"})).toBeInTheDocument();
        expect(onSubmit).toHaveBeenCalledTimes(1);
        expect(onSubmit.mock.calls[0][0]).toEqual({acmeEmail: ""});
    });

    it("shows a validation message and does not call onSubmit for a malformed email", async () => {
        const user = userEvent.setup();
        const {onSubmit} = renderProxyStep();

        await user.type(screen.getByLabelText(/acme email/i), "not-an-email");
        await user.click(screen.getByRole("button", {name: "Deploy Proxy Stack"}));

        expect(await screen.findByText(/email/i)).toBeInTheDocument();
        expect(onSubmit).not.toHaveBeenCalled();
    });

    it("calls onBack when Back is clicked", async () => {
        const user = userEvent.setup();
        const {onBack} = renderProxyStep();

        await user.click(screen.getByRole("button", {name: "Back"}));

        expect(onBack).toHaveBeenCalledTimes(1);
    });

    it("calls onSkip when Skip is clicked", async () => {
        const user = userEvent.setup();
        const {onSkip} = renderProxyStep();

        await user.click(screen.getByRole("button", {name: "Skip"}));

        expect(onSkip).toHaveBeenCalledTimes(1);
    });

    it("renders the D-11 destructive alert copy and the raw deploy error verbatim when a deployError is passed", () => {
        renderProxyStep({
            deployError: 'Host port 80 is already published by container "web-1". Free the port and try again.',
        });

        expect(
            screen.getByText(/could not deploy the proxy stack — ports 80\/443 are already in use/i),
        ).toBeInTheDocument();
        expect(
            screen.getByText('Host port 80 is already published by container "web-1". Free the port and try again.'),
        ).toBeInTheDocument();
    });

    it("renders no alert when deployError is null", () => {
        renderProxyStep({deployError: null});

        expect(screen.queryByText(/could not deploy the proxy stack/i)).not.toBeInTheDocument();
    });

    it("disables the submit button and shows a loading label while loading", () => {
        renderProxyStep({loading: true});

        expect(screen.getByRole("button", {name: "Deploying..."})).toBeDisabled();
    });
});
