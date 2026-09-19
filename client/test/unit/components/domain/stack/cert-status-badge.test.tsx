import {describe, expect, it} from "vitest";
import {render, screen} from "@testing-library/react";
import {CertStatusBadge} from "@/components/domain/stack/cert-status-badge";

describe("CertStatusBadge", () => {
    it('renders "Secured" for an issued certificate', () => {
        render(<CertStatusBadge status="issued" />);

        expect(screen.getByText("Secured")).toBeInTheDocument();
    });

    it('renders "Cert pending" for a pending certificate', () => {
        render(<CertStatusBadge status="pending" />);

        expect(screen.getByText("Cert pending")).toBeInTheDocument();
    });

    it('renders "Cert pending" for an unknown status', () => {
        render(<CertStatusBadge status="something-unexpected" />);

        expect(screen.getByText("Cert pending")).toBeInTheDocument();
    });

    it('renders "Cert pending" when status is absent', () => {
        render(<CertStatusBadge />);

        expect(screen.getByText("Cert pending")).toBeInTheDocument();
    });

    it('renders "Cert failed" for a failed certificate with no message', () => {
        render(<CertStatusBadge status="failed" />);

        expect(screen.getByText("Cert failed")).toBeInTheDocument();
    });

    it("exposes the failure message in a bounded scrollable monospace block when present", () => {
        render(<CertStatusBadge status="failed" message="acme-companion: DNS challenge failed for example.com" />);

        expect(screen.getByText("Cert failed")).toBeInTheDocument();
        const messageEl = screen.getByText("acme-companion: DNS challenge failed for example.com");
        expect(messageEl).toBeInTheDocument();
        expect(messageEl.className).toContain("font-mono");
    });

    it("does not render a message block for a failed cert with no message", () => {
        render(<CertStatusBadge status="failed" message={null} />);

        expect(screen.queryByRole("region")).not.toBeInTheDocument();
    });

    it('renders a distinct "Expiring soon" badge for the expiring status', () => {
        render(<CertStatusBadge status="expiring" />);

        expect(screen.getByText(/expiring soon/i)).toBeInTheDocument();
        expect(screen.queryByText("Secured")).not.toBeInTheDocument();
        expect(screen.queryByText("Cert failed")).not.toBeInTheDocument();
        expect(screen.queryByText("Cert pending")).not.toBeInTheDocument();
    });

    it("renders the accompanying message on the expiring badge when present", () => {
        render(<CertStatusBadge status="expiring" message="Certificate expires 2026-10-15" />);

        expect(screen.getByText(/expiring soon/i)).toBeInTheDocument();
        expect(screen.getByText("Certificate expires 2026-10-15")).toBeInTheDocument();
    });

    it("does not use the destructive badge variant for the expiring status", () => {
        render(<CertStatusBadge status="expiring" />);

        const badge = screen.getByText(/expiring soon/i);
        // shadcn's Badge stamps a data-variant attribute matching the
        // variant prop it was given — the destructive variant must never
        // appear here, since an expiring certificate is still working.
        expect(badge.getAttribute("data-variant")).not.toBe("destructive");
    });
});
