import {beforeEach, describe, expect, it, vi} from "vitest";
import {apiFetch} from "@/lib/api";
import {
    deleteCertificate,
    getCertificates,
    uploadCertificate,
} from "../../../src/lib/certificates-api";

// Mock apiFetch before importing certificates-api
vi.mock("@/lib/api", () => ({
    apiFetch: vi.fn(),
    ApiError: class extends Error {
        constructor(message: string, public status: number, public fields?: Record<string, string>) {
            super(message);
        }
    },
}));

const mockApiFetch = vi.mocked(apiFetch);

function makeFile(name: string, content = "dummy-pem-content"): File {
    return new File([content], name, {type: "application/x-pem-file"});
}

beforeEach(() => {
    mockApiFetch.mockReset();
});

describe("certificates-api", () => {
    it("getCertificates issues a GET to the certificates path and returns the parsed array", async () => {
        const certs = [{id: "1", domainPattern: "example.com", expiresAt: null, createdAt: "x", updatedAt: "x"}];
        mockApiFetch.mockResolvedValue(certs);

        const result = await getCertificates();

        expect(result).toEqual(certs);
        expect(mockApiFetch).toHaveBeenCalledWith("/api/certificates");
    });

    it("uploadCertificate issues a POST whose body is a FormData carrying the pattern and file parts", async () => {
        mockApiFetch.mockResolvedValue({id: "1"});
        const cert = makeFile("cert.crt");
        const key = makeFile("key.key");

        await uploadCertificate("example.com", cert, key);

        expect(mockApiFetch).toHaveBeenCalledWith(
            "/api/certificates",
            expect.objectContaining({method: "POST"}),
        );
        const call = mockApiFetch.mock.calls[0];
        const options = call[1] as RequestInit;
        const body = options.body as FormData;
        expect(body).toBeInstanceOf(FormData);
        expect(body.get("domainPattern")).toBe("example.com");
        expect(body.get("certificate")).toBe(cert);
        expect(body.get("privateKey")).toBe(key);
    });

    it("uploadCertificate omits the bundle part entirely when no bundle file is supplied", async () => {
        mockApiFetch.mockResolvedValue({id: "1"});
        const cert = makeFile("cert.crt");
        const key = makeFile("key.key");

        await uploadCertificate("example.com", cert, key);

        const options = mockApiFetch.mock.calls[0][1] as RequestInit;
        const body = options.body as FormData;
        expect(body.has("caBundle")).toBe(false);
    });

    it("uploadCertificate includes the bundle part when one is supplied", async () => {
        mockApiFetch.mockResolvedValue({id: "1"});
        const cert = makeFile("cert.crt");
        const key = makeFile("key.key");
        const bundle = makeFile("bundle.crt");

        await uploadCertificate("example.com", cert, key, bundle);

        const options = mockApiFetch.mock.calls[0][1] as RequestInit;
        const body = options.body as FormData;
        expect(body.get("caBundle")).toBe(bundle);
    });

    it("uploadCertificate sets no content-type header on the request options", async () => {
        mockApiFetch.mockResolvedValue({id: "1"});

        await uploadCertificate("example.com", makeFile("cert.crt"), makeFile("key.key"));

        const options = mockApiFetch.mock.calls[0][1] as RequestInit;
        expect(options.headers).toBeUndefined();
    });

    it("deleteCertificate issues a DELETE to the per-id path and resolves on a 204", async () => {
        mockApiFetch.mockResolvedValue(undefined);

        await deleteCertificate("cert-1");

        expect(mockApiFetch).toHaveBeenCalledWith("/api/certificates/cert-1", {method: "DELETE"});
    });

    it("surfaces an ApiError whose message carries the server's reason text on a rejected upload", async () => {
        const {ApiError} = await import("@/lib/api");
        mockApiFetch.mockRejectedValue(new ApiError("Private key does not match certificate", 400));

        await expect(
            uploadCertificate("example.com", makeFile("cert.crt"), makeFile("key.key")),
        ).rejects.toThrow("Private key does not match certificate");
    });
});
