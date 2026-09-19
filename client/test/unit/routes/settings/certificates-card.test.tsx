import {beforeEach, describe, expect, it, vi} from "vitest";
import {render, screen, waitFor} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {CertificatesCard} from "@/routes/app/settings/components/certificates-card";
import {
    deleteCertificate,
    getCertificates,
    uploadCertificate,
    type Certificate,
} from "@/lib/certificates-api";

vi.mock("@/lib/certificates-api", () => ({
    getCertificates: vi.fn(),
    uploadCertificate: vi.fn(),
    deleteCertificate: vi.fn(),
}));

vi.mock("sonner", () => ({
    toast: {
        success: vi.fn(),
        error: vi.fn(),
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

vi.setConfig({testTimeout: 15000});

const mockGetCertificates = vi.mocked(getCertificates);
const mockUploadCertificate = vi.mocked(uploadCertificate);
const mockDeleteCertificate = vi.mocked(deleteCertificate);

function makeCertificate(overrides: Partial<Certificate> = {}): Certificate {
    return {
        id: "cert-1",
        domainPattern: "example.com",
        expiresAt: "2099-01-01T00:00:00.000Z",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        ...overrides,
    };
}

function makeFile(name: string, content = "dummy-pem-content"): File {
    return new File([content], name, {type: "application/x-pem-file"});
}

beforeEach(() => {
    mockGetCertificates.mockReset();
    mockUploadCertificate.mockReset();
    mockDeleteCertificate.mockReset();
});

async function fillValidUpload(user: ReturnType<typeof userEvent.setup>, pattern = "example.com") {
    await user.type(screen.getByLabelText(/domain pattern/i), pattern);
    await user.upload(screen.getByLabelText(/certificate file/i), makeFile("cert.crt"));
    await user.upload(screen.getByLabelText(/private key file/i), makeFile("key.key"));
}

describe("CertificatesCard", () => {
    it("calls the list function once on mount and renders a row per certificate with domain pattern and expiry", async () => {
        const certA = makeCertificate({id: "cert-1", domainPattern: "a.example.com", expiresAt: "2099-01-01T00:00:00.000Z"});
        const certB = makeCertificate({id: "cert-2", domainPattern: "b.example.com", expiresAt: "2099-06-01T00:00:00.000Z"});
        mockGetCertificates.mockResolvedValue([certA, certB]);

        render(<CertificatesCard />);

        await screen.findByText("a.example.com");
        expect(screen.getByText("b.example.com")).toBeInTheDocument();
        expect(screen.getByText(new Date(certA.expiresAt!).toLocaleDateString())).toBeInTheDocument();
        expect(screen.getByText(new Date(certB.expiresAt!).toLocaleDateString())).toBeInTheDocument();
        expect(mockGetCertificates).toHaveBeenCalledTimes(1);
    });

    it("renders an empty state rather than an empty table when there are no certificates", async () => {
        mockGetCertificates.mockResolvedValue([]);

        render(<CertificatesCard />);

        expect(await screen.findByText(/no certificates uploaded yet/i)).toBeInTheDocument();
        expect(screen.queryByRole("table")).not.toBeInTheDocument();
    });

    it("renders a retry affordance rather than the empty state when the initial load fails", async () => {
        mockGetCertificates.mockRejectedValueOnce(new Error("Network error"));

        render(<CertificatesCard />);

        expect(await screen.findByText(/failed to load certificates: network error/i)).toBeInTheDocument();
        expect(screen.queryByText(/no certificates uploaded yet/i)).not.toBeInTheDocument();

        mockGetCertificates.mockResolvedValueOnce([makeCertificate({domainPattern: "recovered.example.com"})]);
        const user = userEvent.setup();
        await user.click(screen.getByRole("button", {name: "Retry"}));

        expect(await screen.findByText("recovered.example.com")).toBeInTheDocument();
        expect(mockGetCertificates).toHaveBeenCalledTimes(2);
    });

    it("shows a warning indicator only for a certificate expiring within the warning window", async () => {
        const soon = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString();
        const later = new Date(Date.now() + 200 * 24 * 60 * 60 * 1000).toISOString();
        mockGetCertificates.mockResolvedValue([
            makeCertificate({id: "cert-1", domainPattern: "soon.example.com", expiresAt: soon}),
            makeCertificate({id: "cert-2", domainPattern: "later.example.com", expiresAt: later}),
        ]);

        render(<CertificatesCard />);

        await screen.findByText("soon.example.com");
        expect(screen.getAllByText(/expiring soon/i)).toHaveLength(1);
    });

    it("shows a validation message and does not upload for an invalid domain pattern", async () => {
        mockGetCertificates.mockResolvedValue([]);
        const user = userEvent.setup();

        render(<CertificatesCard />);
        await screen.findByText(/no certificates uploaded yet/i);

        await user.type(screen.getByLabelText(/domain pattern/i), "not a domain");
        await user.click(screen.getByRole("button", {name: "Upload Certificate"}));

        expect(await screen.findByText(/valid hostname or wildcard pattern/i)).toBeInTheDocument();
        expect(mockUploadCertificate).not.toHaveBeenCalled();
    });

    it("shows a validation message and does not upload when no certificate file is selected", async () => {
        mockGetCertificates.mockResolvedValue([]);
        const user = userEvent.setup();

        render(<CertificatesCard />);
        await screen.findByText(/no certificates uploaded yet/i);

        await user.type(screen.getByLabelText(/domain pattern/i), "example.com");
        await user.click(screen.getByRole("button", {name: "Upload Certificate"}));

        expect(await screen.findByText(/select the certificate file/i)).toBeInTheDocument();
        expect(mockUploadCertificate).not.toHaveBeenCalled();
    });

    it("calls the upload function once with the pattern and both files, and no fourth argument, when valid", async () => {
        mockGetCertificates.mockResolvedValue([]);
        mockUploadCertificate.mockResolvedValue(makeCertificate());
        const user = userEvent.setup();

        render(<CertificatesCard />);
        await screen.findByText(/no certificates uploaded yet/i);

        await fillValidUpload(user);
        await user.click(screen.getByRole("button", {name: "Upload Certificate"}));

        await waitFor(() => expect(mockUploadCertificate).toHaveBeenCalledTimes(1));
        const call = mockUploadCertificate.mock.calls[0];
        expect(call).toHaveLength(3);
        expect(call[0]).toBe("example.com");
        expect(call[1]).toBeInstanceOf(File);
        expect(call[2]).toBeInstanceOf(File);
    });

    it("passes a supplied bundle file as the fourth argument", async () => {
        mockGetCertificates.mockResolvedValue([]);
        mockUploadCertificate.mockResolvedValue(makeCertificate());
        const user = userEvent.setup();

        render(<CertificatesCard />);
        await screen.findByText(/no certificates uploaded yet/i);

        await fillValidUpload(user);
        await user.upload(screen.getByLabelText(/ca bundle/i), makeFile("bundle.crt"));
        await user.click(screen.getByRole("button", {name: "Upload Certificate"}));

        await waitFor(() => expect(mockUploadCertificate).toHaveBeenCalledTimes(1));
        const call = mockUploadCertificate.mock.calls[0];
        expect(call).toHaveLength(4);
        expect(call[3]).toBeInstanceOf(File);
    });

    it("renders the server's rejection reason verbatim on a failed upload", async () => {
        mockGetCertificates.mockResolvedValue([]);
        mockUploadCertificate.mockRejectedValue(new Error("Private key does not match certificate"));
        const user = userEvent.setup();

        render(<CertificatesCard />);
        await screen.findByText(/no certificates uploaded yet/i);

        await fillValidUpload(user);
        await user.click(screen.getByRole("button", {name: "Upload Certificate"}));

        expect(await screen.findByText("Private key does not match certificate")).toBeInTheDocument();
    });

    it("calls the list function again after a successful upload so the new certificate appears", async () => {
        mockGetCertificates
            .mockResolvedValueOnce([])
            .mockResolvedValueOnce([makeCertificate({id: "cert-new", domainPattern: "new.example.com"})]);
        mockUploadCertificate.mockResolvedValue(makeCertificate({id: "cert-new", domainPattern: "new.example.com"}));
        const user = userEvent.setup();

        render(<CertificatesCard />);
        await screen.findByText(/no certificates uploaded yet/i);

        await fillValidUpload(user, "new.example.com");
        await user.click(screen.getByRole("button", {name: "Upload Certificate"}));

        await waitFor(() => expect(mockGetCertificates).toHaveBeenCalledTimes(2));
        expect(await screen.findByText("new.example.com")).toBeInTheDocument();
    });

    it("opens a confirmation dialog and only calls delete after confirming", async () => {
        mockGetCertificates.mockResolvedValue([makeCertificate({id: "cert-1", domainPattern: "example.com"})]);
        mockDeleteCertificate.mockResolvedValue(undefined);
        const user = userEvent.setup();

        render(<CertificatesCard />);
        await screen.findByText("example.com");

        await user.click(screen.getByRole("button", {name: /delete example\.com/i}));

        expect(await screen.findByText(/delete the certificate for example\.com/i)).toBeInTheDocument();
        expect(mockDeleteCertificate).not.toHaveBeenCalled();

        await user.click(screen.getByRole("button", {name: "Delete"}));

        await waitFor(() => expect(mockDeleteCertificate).toHaveBeenCalledWith("cert-1"));
    });

    it("renders the server's conflict message naming the blocking domains on a failed delete", async () => {
        mockGetCertificates.mockResolvedValue([makeCertificate({id: "cert-1", domainPattern: "example.com"})]);
        mockDeleteCertificate.mockRejectedValue(
            new Error("Cannot delete: certificate still referenced by a.example.com, b.example.com"),
        );
        const user = userEvent.setup();

        render(<CertificatesCard />);
        await screen.findByText("example.com");

        await user.click(screen.getByRole("button", {name: /delete example\.com/i}));
        await user.click(screen.getByRole("button", {name: "Delete"}));

        expect(
            await screen.findByText("Cannot delete: certificate still referenced by a.example.com, b.example.com"),
        ).toBeInTheDocument();
    });

    it("never renders certificate body, key, or chain content", async () => {
        mockGetCertificates.mockResolvedValue([makeCertificate()]);

        render(<CertificatesCard />);
        await screen.findByText("example.com");

        expect(document.body.textContent).not.toMatch(/BEGIN (CERTIFICATE|PRIVATE KEY|RSA PRIVATE KEY)/);
    });
});
