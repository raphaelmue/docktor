import {prisma} from "../lib/db.js";
import {NotFoundError} from "../lib/errors.js";

export class ProxyRepository {
    async create(data: {
        stackId: string;
        serviceName: string;
        domain: string;
        internalPort: number;
        tlsEnabled: boolean;
        certSource: string;
        certificateId?: string | null;
    }) {
        return prisma.proxyConfig.create({data});
    }

    async findById(id: string) {
        return prisma.proxyConfig.findUnique({where: {id}});
    }

    async findByIdOrThrow(id: string) {
        const config = await prisma.proxyConfig.findUnique({where: {id}});
        if (!config) {
            throw new NotFoundError(`ProxyConfig "${id}" not found`);
        }
        return config;
    }

    async findByStackId(stackId: string) {
        return prisma.proxyConfig.findMany({where: {stackId}, orderBy: {createdAt: "asc"}});
    }

    /**
     * Groups the domains routing to one (stackId, serviceName) pair —
     * nginx-proxy only honours one VIRTUAL_HOST value per service, so every
     * write path must aggregate over this set rather than a single row
     * (the D-08 promote invariant).
     */
    async findByStackAndService(stackId: string, serviceName: string) {
        return prisma.proxyConfig.findMany({
            where: {stackId, serviceName},
            orderBy: {createdAt: "asc"},
        });
    }

    async findAll() {
        return prisma.proxyConfig.findMany({orderBy: {createdAt: "asc"}});
    }

    /**
     * Returns every proxy configuration row together with its linked
     * certificate's domain pattern and expiry date (a thin select through
     * the relation — no filtering, no mapping). This is the shape
     * ProxyCertPoller needs to classify both ACME-sourced and
     * custom-sourced rows without ever deriving a custom certificate's file
     * name from anything but the linked certificate's own domain pattern.
     * findAll() above is left untouched for its existing callers.
     */
    async findAllForCertPolling() {
        return prisma.proxyConfig.findMany({
            orderBy: {createdAt: "asc"},
            include: {
                certificate: {select: {domainPattern: true, expiresAt: true}},
            },
        });
    }

    async updateConfig(
        id: string,
        data: {
            domain?: string;
            internalPort?: number;
            tlsEnabled?: boolean;
            certSource?: string;
            certificateId?: string | null;
        },
    ) {
        return prisma.proxyConfig.update({where: {id}, data});
    }

    /**
     * Written by 06-04's cert poller; declared now so that plan needs no
     * edit to this file.
     */
    async updateCertStatus(
        id: string,
        data: {certStatus: string; certMessage?: string | null; certCheckedAt?: Date | null},
    ) {
        return prisma.proxyConfig.update({where: {id}, data});
    }

    async delete(id: string) {
        return prisma.proxyConfig.delete({where: {id}});
    }
}

export const proxyRepository = new ProxyRepository();
