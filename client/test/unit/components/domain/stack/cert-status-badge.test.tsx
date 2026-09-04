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
});
