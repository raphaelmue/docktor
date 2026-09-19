import {apiFetch} from "@/lib/api"

// privateKey/certificate/caBundle are deliberately absent from this
// interface — the server's GET/POST responses never include them (see
// server/src/repositories/certificate-repository.ts's toDto()). An absent
// field in the type is part of the safety guarantee: a component literally
// cannot render secret material it was never given a field to hold.
export interface Certificate {
    id: string
    domainPattern: string
    expiresAt: string | null
    createdAt: string
    updatedAt: string
}

export async function getCertificates(): Promise<Certificate[]> {
    return apiFetch<Certificate[]>("/api/certificates")
}

export async function uploadCertificate(
    domainPattern: string,
    certificate: File,
    privateKey: File,
    caBundle?: File,
): Promise<Certificate> {
    const form = new FormData()
    form.append("domainPattern", domainPattern)
    form.append("certificate", certificate)
    form.append("privateKey", privateKey)
    // Omitted entirely (not appended as an empty value) when absent — the
    // server route reads files.caBundle only if the part was present.
    if (caBundle) {
        form.append("caBundle", caBundle)
    }
    // No Content-Type header set here — apiFetch's FormData handling lets
    // the browser supply the multipart boundary itself.
    return apiFetch<Certificate>("/api/certificates", {method: "POST", body: form})
}

export async function deleteCertificate(id: string): Promise<void> {
    await apiFetch(`/api/certificates/${id}`, {method: "DELETE"})
}
