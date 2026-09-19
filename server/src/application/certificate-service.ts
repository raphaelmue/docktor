import {BadRequestError, ConflictError} from "../lib/errors.js";
import {decrypt, encrypt} from "../lib/crypto.js";
import {certFileBaseName} from "../domain/certificate-naming.js";
import {
    certCoversDomainPattern,
    certificateExpiry,
    parseCertificate,
    validateCertKeyPair,
} from "../domain/certificate-validation.js";
import {Prisma} from "../generated/prisma/client.js";
import type {CertificateDto, CertificateRepository} from "../repositories/certificate-repository.js";
import type {CertificateFilesystem} from "../infrastructure/certificate-filesystem.js";

export interface CreateCertificateInput {
    domainPattern: string;
    certificatePem: string;
    privateKeyPem: string;
    caBundlePem?: string | null;
}

export class CertificateService {
    constructor(
        private readonly certRepo: Pick<
            CertificateRepository,
            "create" | "toDto" | "delete" | "findAll" | "findByIdOrThrow" | "findReferencingDomains"
        >,
        private readonly fs: Pick<CertificateFilesystem, "writeCertificateFiles" | "removeCertificateFiles">,
    ) {}

    /**
     * Validates, encrypts, persists, and materialises one certificate
     * (D-12). Order matters: nothing is persisted or written to disk until
     * both validation checks pass. If the file write fails after the row
     * was created, the row is deleted before rethrowing, so the database
     * never claims a certificate that has no file (T-09-36).
     */
    async create(input: CreateCertificateInput): Promise<CertificateDto> {
        const validation = validateCertKeyPair(input.certificatePem, input.privateKeyPem);
        if (!validation.valid) {
            throw new BadRequestError(validation.reason);
        }

        // validateCertKeyPair already proved certificatePem parses; re-parse
        // to obtain the X509Certificate object for the coverage/expiry
        // checks below (parseCertificate is pure and cheap — no I/O).
        const parsed = parseCertificate(input.certificatePem);
        if (!parsed.ok) {
            throw new BadRequestError(parsed.reason);
        }

        if (!certCoversDomainPattern(parsed.cert, input.domainPattern)) {
            throw new BadRequestError(
                `The certificate does not cover the declared domain pattern "${input.domainPattern}"`,
            );
        }

        const expiresAt = certificateExpiry(parsed.cert);

        // The plaintext key is never assigned to a longer-lived variable,
        // logged, or included in an error — it flows straight from the
        // caller's input into encrypt(), and its only other appearance
        // (below) is the single decrypt() call immediately before the file
        // write (T-09-28).
        let row: Awaited<ReturnType<typeof this.certRepo.create>>;
        try {
            row = await this.certRepo.create({
                domainPattern: input.domainPattern,
                privateKey: encrypt(input.privateKeyPem),
                certificate: input.certificatePem,
                caBundle: input.caBundlePem ?? null,
                expiresAt,
            });
        } catch (err) {
            if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
                throw new ConflictError(
                    `A certificate for domain pattern "${input.domainPattern}" already exists`,
                );
            }
            throw err;
        }

        try {
            const baseName = certFileBaseName(input.domainPattern);
            await this.fs.writeCertificateFiles(baseName, {
                certificate: input.certificatePem,
                privateKey: decrypt(row.privateKey),
                caBundle: input.caBundlePem ?? null,
            });
        } catch (err) {
            // Filesystem write failed — the database must never claim a
            // certificate that has no file on disk (T-09-36). Deliberately
            // re-throwing the ORIGINAL error (not a wrapped one) after the
            // rollback, so the caller sees the real cause.
            await this.certRepo.delete(row.id).catch(() => {});
            throw err;
        }

        return this.certRepo.toDto(row);
    }

    /**
     * Returns every certificate's metadata-only serialisation, ordered by
     * creation. Never reads, decrypts, or returns the key, the certificate
     * PEM, or the bundle (T-09-29).
     */
    async listAll(): Promise<CertificateDto[]> {
        const rows = await this.certRepo.findAll();
        return rows.map((row) => this.certRepo.toDto(row));
    }

    /**
     * Deletes a certificate. Refuses — rather than cascading or orphaning —
     * when any proxy configuration still references it (T-09-37): a proxy
     * configuration whose certificate file has just been deleted would
     * leave its domain serving nothing, silently. The database's own
     * restricted relation is a backstop for a race this check misses; that
     * failure is translated into the same client-facing error rather than
     * escaping as a raw database error.
     */
    async delete(id: string): Promise<void> {
        const row = await this.certRepo.findByIdOrThrow(id);

        const referencingDomains = await this.certRepo.findReferencingDomains(id);
        if (referencingDomains.length > 0) {
            throw new ConflictError(
                `Certificate for "${row.domainPattern}" is still referenced by: ${referencingDomains.join(", ")} — detach these domains before deleting it`,
            );
        }

        const baseName = certFileBaseName(row.domainPattern);
        await this.fs.removeCertificateFiles(baseName);

        try {
            await this.certRepo.delete(id);
        } catch (err) {
            throw this.translateCertificateDeleteError(err);
        }
    }

    private translateCertificateDeleteError(err: unknown): Error {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2003") {
            return new ConflictError(
                "Certificate is still referenced by a proxy configuration — refusing to delete it",
            );
        }
        return err instanceof Error ? err : new Error(String(err));
    }
}
