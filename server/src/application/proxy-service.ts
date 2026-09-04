import {BadRequestError, ConflictError, NotFoundError} from "../lib/errors.js";
import {
    ComposeProxyEditError,
    readServiceProxyEnv,
    removeServiceProxyEnv,
    setServiceProxyEnv,
    type ServiceProxyEnv,
    type ServiceProxyEnvRead,
} from "../lib/compose-proxy-editor.js";
import {withKeyedLock} from "../lib/keyed-mutex.js";
import {Prisma} from "../generated/prisma/client.js";
import type {AssignDomainInput} from "@docktor/shared";
import type {ProxyRepository} from "../repositories/proxy-repository.js";
import type {StackRepository} from "../repositories/stack-repository.js";
import type {StackFilesystem} from "../infrastructure/stack-filesystem.js";
import type {StackService} from "./stack-service.js";

// Fixed id, not user-chosen — the proxy stack is a singleton Docktor-managed
// Stack row (see RESEARCH.md's "proxy stack is a normal Stack row" pattern).
export const PROXY_STACK_ID = "docktor-proxy";

type ProxyConfigRow = Awaited<ReturnType<ProxyRepository["create"]>>;

export class ProxyService {
    constructor(
        private readonly proxyRepo: ProxyRepository,
        private readonly stackRepo: Pick<StackRepository, "findByIdOrThrow" | "findById" | "exists">,
        private readonly fs: Pick<StackFilesystem, "readCompose" | "writeCompose">,
        private readonly stackService: Pick<StackService, "deployStack">,
    ) {}

    async listByStack(stackId: string) {
        await this.stackRepo.findByIdOrThrow(stackId);
        return this.proxyRepo.findByStackId(stackId);
    }

    /**
     * Assigns a domain to one service. Serialized per stack id (T-06-09) —
     * the whole operation, including the proxy-stack guard and the
     * hand-written-domain adoption below, runs inside withKeyedLock so two
     * requests against the same stack's compose file never interleave.
     *
     * Inside the lock: first adopts any hand-written domains already
     * present in the compose file that have no ProxyConfig row (so a
     * user's pre-existing VIRTUAL_HOST entries are never silently
     * dropped), then either updates the row this (stackId, serviceName)
     * pair already owns for the incoming domain in place (PRXY-05
     * idempotency — no duplicate row, no ConflictError) or creates a new
     * one. Either way, the *whole* aggregate domain set for the pair is
     * re-rendered into the compose file (the D-08 promote invariant —
     * never a single-domain fast path) and the stack is redeployed. If the
     * compose write or the redeploy fails after a brand-new row was
     * created, that row is deleted so the database never claims a domain
     * that isn't actually routed anywhere; a re-assign of an existing row
     * is left in place on failure — it was already routed before this
     * call, and rolling it back would be a worse surprise.
     */
    async assignDomain(stackId: string, serviceName: string, input: AssignDomainInput) {
        return withKeyedLock(stackId, async () => {
            await this.stackRepo.findByIdOrThrow(stackId);

            if (!(await this.stackRepo.exists(PROXY_STACK_ID))) {
                throw new BadRequestError(
                    "The Docktor proxy stack is not deployed. Deploy it from Settings > Proxy before assigning domains.",
                );
            }

            await this.adoptUnmanagedDomains(stackId, serviceName, input.internalPort);

            const existingForService = await this.proxyRepo.findByStackAndService(stackId, serviceName);
            const existingRow = existingForService.find((row) => row.domain === input.domain);

            let result: ProxyConfigRow;
            if (existingRow) {
                result = await this.proxyRepo.updateConfig(existingRow.id, {
                    internalPort: input.internalPort,
                    tlsEnabled: input.tlsEnabled,
                });

                // A user's explicit re-assign is the instruction to change
                // the whole service's port — nginx-proxy permits only one
                // VIRTUAL_PORT per container, so every other row for the
                // pair moves to the new port too.
                const rowsToRepoint = existingForService.filter(
                    (row) => row.id !== existingRow.id && row.internalPort !== input.internalPort,
                );
                for (const row of rowsToRepoint) {
                    // eslint-disable-next-line no-await-in-loop
                    await this.proxyRepo.updateConfig(row.id, {internalPort: input.internalPort});
                }
            } else {
                const conflictingPort = existingForService.find((row) => row.internalPort !== input.internalPort);
                if (conflictingPort) {
                    throw new BadRequestError(
                        `Service "${serviceName}" is already proxied on port ${conflictingPort.internalPort} — all domains for one service must share the same internal port`,
                    );
                }

                try {
                    result = await this.proxyRepo.create({
                        stackId,
                        serviceName,
                        domain: input.domain,
                        internalPort: input.internalPort,
                        tlsEnabled: input.tlsEnabled,
                    });
                } catch (err) {
                    throw this.translateProxyConfigError(err, input.domain);
                }
            }

            try {
                await this.syncServiceComposeProxy(stackId, serviceName);
            } catch (err) {
                if (!existingRow) {
                    await this.proxyRepo.delete(result.id).catch(() => {});
                }
                throw err;
            }

            return result;
        });
    }

    /**
     * Removes one domain: deletes its ProxyConfig row, then re-renders the
     * remaining domain set for that service (or clears the proxy env
     * entirely when none remain) and redeploys. A repeat call for an
     * already-deleted id raises NotFoundError before touching the compose
     * file (PRXY-04 idempotency).
     *
     * Serialized per stack id like assignDomain, but the id-to-stack
     * lookup has to happen before the lock can even be taken (the lock key
     * IS the stack id) — so this does an initial findByIdOrThrow outside
     * the lock only to learn which stack to lock on, then re-reads the row
     * inside the lock. That re-read is what makes a concurrent double
     * removal of the same id safe: whichever call's turn comes second sees
     * the row already gone and raises NotFoundError before touching the
     * compose file.
     */
    async removeDomain(proxyConfigId: string) {
        const initial = await this.proxyRepo.findByIdOrThrow(proxyConfigId);

        return withKeyedLock(initial.stackId, async () => {
            const row = await this.proxyRepo.findByIdOrThrow(proxyConfigId);
            await this.proxyRepo.delete(row.id);
            await this.syncServiceComposeProxy(row.stackId, row.serviceName);
        });
    }

    /**
     * Re-reads every ProxyConfig row for (stackId, serviceName) and writes
     * one comma-joined VIRTUAL_HOST/LETSENCRYPT_HOST pair, or clears the
     * proxy env entirely when no rows remain — the D-08 promote invariant.
     * The single call site every compose write for proxy configuration
     * goes through; assignDomain and removeDomain never write the file
     * directly.
     */
    private async syncServiceComposeProxy(stackId: string, serviceName: string): Promise<void> {
        const rendered = await this.renderProxyEnvForService(stackId, serviceName);
        const composeContent = await this.fs.readCompose(stackId);

        let newContent: string;
        try {
            newContent = rendered
                ? setServiceProxyEnv(composeContent, serviceName, rendered)
                : removeServiceProxyEnv(composeContent, serviceName);
        } catch (err) {
            throw this.translateComposeProxyEditError(err);
        }

        await this.fs.writeCompose(stackId, newContent);
        await this.stackService.deployStack(stackId);
    }

    private async renderProxyEnvForService(stackId: string, serviceName: string): Promise<ServiceProxyEnv | null> {
        const rows = await this.proxyRepo.findByStackAndService(stackId, serviceName);
        if (rows.length === 0) return null;

        const virtualHost = rows.map((row) => row.domain).join(",");
        const tlsRows = rows.filter((row) => row.tlsEnabled);
        const letsencryptHost = tlsRows.length > 0 ? tlsRows.map((row) => row.domain).join(",") : null;
        const virtualPort = String(rows[0].internalPort);

        return {virtualHost, virtualPort, letsencryptHost};
    }

    /**
     * Adopts domains a user hand-wrote into this service's VIRTUAL_HOST
     * before Docktor managed it: any domain present in the file with no
     * matching ProxyConfig row for this (stackId, serviceName) pair
     * becomes a row, inheriting the file's VIRTUAL_PORT (falling back to
     * the incoming assign request's internalPort when the file's value is
     * absent or unparseable) and tlsEnabled from whether it also appears
     * in the file's LETSENCRYPT_HOST. A domain that collides with a row
     * owned by another (stackId, serviceName) pair is skipped with a
     * warning rather than aborting the whole assign — the file is
     * pre-existing state the user already had, not something this call
     * should fail on.
     */
    private async adoptUnmanagedDomains(stackId: string, serviceName: string, fallbackPort: number): Promise<void> {
        const composeContent = await this.fs.readCompose(stackId);

        let fileEnv: ServiceProxyEnvRead;
        try {
            fileEnv = readServiceProxyEnv(composeContent, serviceName);
        } catch (err) {
            throw this.translateComposeProxyEditError(err);
        }
        if (!fileEnv.virtualHost) return;

        const existingRows = await this.proxyRepo.findByStackAndService(stackId, serviceName);
        const existingDomains = new Set(existingRows.map((row) => row.domain));
        const fileDomains = fileEnv.virtualHost
            .split(",")
            .map((domain) => domain.trim())
            .filter(Boolean);
        const letsencryptDomains = new Set(
            (fileEnv.letsencryptHost ?? "")
                .split(",")
                .map((domain) => domain.trim())
                .filter(Boolean),
        );
        const parsedPort = fileEnv.virtualPort ? Number.parseInt(fileEnv.virtualPort, 10) : Number.NaN;
        const internalPort = Number.isFinite(parsedPort) && parsedPort > 0 ? parsedPort : fallbackPort;

        for (const domain of fileDomains) {
            if (existingDomains.has(domain)) continue;

            try {
                // eslint-disable-next-line no-await-in-loop
                await this.proxyRepo.create({
                    stackId,
                    serviceName,
                    domain,
                    internalPort,
                    tlsEnabled: letsencryptDomains.has(domain),
                });
            } catch (err) {
                if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
                    console.warn(
                        `[ProxyService] skipped adopting domain "${domain}" for ${stackId}/${serviceName} — already assigned to another service`,
                    );
                    continue;
                }
                throw err;
            }
        }
    }

    private translateProxyConfigError(err: unknown, domain: string): Error {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
            return new ConflictError(`Domain "${domain}" is already assigned to another service`);
        }
        return err instanceof Error ? err : new Error(String(err));
    }

    // Mirrors stack-service.ts's translateComposeEditError shape.
    private translateComposeProxyEditError(err: unknown): Error {
        if (err instanceof ComposeProxyEditError) {
            if (err.reason === "service-not-found") {
                return new NotFoundError(err.message);
            }
            return new BadRequestError(err.message);
        }
        return err instanceof Error ? err : new Error(String(err));
    }
}
