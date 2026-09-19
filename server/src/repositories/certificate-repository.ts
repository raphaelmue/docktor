import {prisma} from "../lib/db.js";
import {NotFoundError} from "../lib/errors.js";

export interface CreateCertificateData {
    domainPattern: string;
    privateKey: string;
    certificate: string;
    caBundle?: string | null;
    expiresAt: Date;
}

type CertificateRow = Awaited<ReturnType<typeof prisma.certificate.create>>;

/**
 * Metadata-only shape safe for any API response — never carries privateKey,
 * certificate, or caBundle (T-09-29).
 */
export interface CertificateDto {
    id: string;
    domainPattern: string;
    expiresAt: Date;
    createdAt: Date;
    updatedAt: Date;
}

export class CertificateRepository {
    async create(data: CreateCertificateData) {
        return prisma.certificate.create({data});
    }

    async findById(id: string) {
        return prisma.certificate.findUnique({where: {id}});
    }

    async findByIdOrThrow(id: string) {
        const cert = await prisma.certificate.findUnique({where: {id}});
        if (!cert) {
            throw new NotFoundError(`Certificate "${id}" not found`);
        }
        return cert;
    }

    async findAll() {
        return prisma.certificate.findMany({orderBy: {createdAt: "asc"}});
    }

    /**
     * Resolves the domains still referencing this certificate through the
     * Prisma relation the Certificate row already owns (its back-relation
     * to ProxyConfig), selecting only the referencing rows' domain values.
     * Lives on this repository rather than ProxyRepository so this plan
     * never edits server/src/repositories/proxy-repository.ts (plan
     * 09-07's file). Kept thin and free of business logic per this
     * project's repository rule — the decision to refuse a delete belongs
     * to CertificateService.
     */
    async findReferencingDomains(id: string): Promise<string[]> {
        const cert = await prisma.certificate.findUnique({
            where: {id},
            select: {proxyConfigs: {select: {domain: true}}},
        });
        return (cert?.proxyConfigs ?? []).map((row) => row.domain);
    }

    async delete(id: string) {
        return prisma.certificate.delete({where: {id}});
    }

    /**
     * Constructs the metadata-only DTO field by field rather than spreading
     * the row and deleting keys, so a future schema field cannot leak by
     * default (mirrors BackupRepository.toDto()'s serialisation-safety
     * precedent, T-09-29).
     */
    toDto(row: CertificateRow): CertificateDto {
        return {
            id: row.id,
            domainPattern: row.domainPattern,
            expiresAt: row.expiresAt,
            createdAt: row.createdAt,
            updatedAt: row.updatedAt,
        };
    }
}

export const certificateRepository = new CertificateRepository();
