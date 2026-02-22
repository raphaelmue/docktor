import {describe, expect, it, vi} from "vitest";
import {render, screen, within} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {MemoryRouter} from "react-router";
import {LoginForm} from "../../../../../src/routes/auth/components/login-form";

// Mock auth-client
vi.mock("@/lib/auth-client", () => ({
    signIn: {
        email: vi.fn().mockResolvedValue({error: null}),
    },
    useSession: vi.fn().mockReturnValue({data: null, isPending: false}),
}));

// Mock react-router navigate
vi.mock("react-router", async () => {
    const actual = await vi.importActual("react-router");
    return {
        ...actual,
        useNavigate: () => vi.fn(),
    };
});

function renderLoginForm() {
    const {container} = render(
        <MemoryRouter>
            <LoginForm />
        </MemoryRouter>,
    );
    return within(container);
}

describe("LoginForm", () => {
    it("renders email and password fields", () => {
        const view = renderLoginForm();

        expect(view.getByLabelText(/email/i)).toBeInTheDocument();
        expect(view.getByLabelText(/password/i)).toBeInTheDocument();
    });

    it("renders the sign in button", () => {
        const view = renderLoginForm();

        expect(view.getByRole("button", {name: /sign in/i})).toBeInTheDocument();
    });

    it("renders a link to sign up", () => {
        const view = renderLoginForm();

        expect(view.getByText(/sign up/i)).toBeInTheDocument();
    });

    it("shows validation errors on empty submit", async () => {
        const user = userEvent.setup();
        const view = renderLoginForm();

        await user.click(view.getByRole("button", {name: /sign in/i}));

        // Wait for validation messages to appear
        expect(await screen.findByText(/valid email/i)).toBeInTheDocument();
    });
});
