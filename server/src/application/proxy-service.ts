import {BadRequestError, ConflictError, NotFoundError} from "../lib/errors.js";
import {ComposeProxyEditError, setServiceProxyEnv} from "../lib/compose-proxy-editor.js";
import {Prisma} from "../generated/prisma/client.js";
import type {AssignDomainInput} from "@docktor/shared";
import type {ProxyRepository} from "../repositories/proxy-repository.js";
import type {StackRepository} from "../repositories/stack-repository.js";
import type {StackFilesystem} from "../infrastructure/stack-filesystem.js";
import type {StackService} from "./stack-service.js";

// Fixed id, not user-chosen — the proxy stack is a singleton Docktor-managed
// Stack row (see RESEARCH.md's "proxy stack is a normal Stack row" pattern).
export const PROXY_STACK_ID = "docktor-proxy";

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
     * Assigns a domain to one service: creates the ProxyConfig row, then
     * re-renders and writes the *whole* aggregate set of domains for that
     * (stackId, serviceName) pair into the compose file's proxy env vars
     * (the D-08 promote invariant — never a single-domain fast path), and
     * redeploys the target stack so the running container picks up the
     * change. If the compose write or the redeploy fails after the DB row
     * was created, the row is deleted so the database never claims a
     * domain that isn't actually routed anywhere.
     */
    async assignDomain(stackId: string, serviceName: string, input: AssignDomainInput) {
        await this.stackRepo.findByIdOrThrow(stackId);

        if (!(await this.stackRepo.exists(PROXY_STACK_ID))) {
            throw new BadRequestError(
                "The Docktor proxy stack is not deployed. Deploy it from Settings > Proxy before assigning domains.",
            );
        }

        const existingForService = await this.proxyRepo.findByStackAndService(stackId, serviceName);
        const conflictingPort = existingForService.find((row) => row.internalPort !== input.internalPort);
        if (conflictingPort) {
            throw new BadRequestError(
                `Service "${serviceName}" is already proxied on port ${conflictingPort.internalPort} — all domains for one service must share the same internal port`,
            );
        }

        let created;
        try {
            created = await this.proxyRepo.create({
                stackId,
                serviceName,
                domain: input.domain,
                internalPort: input.internalPort,
                tlsEnabled: input.tlsEnabled,
            });
        } catch (err) {
            throw this.translateProxyConfigError(err, input.domain);
        }

        try {
            await this.rewriteServiceProxyEnv(stackId, serviceName);
            await this.stackService.deployStack(stackId);
        } catch (err) {
            // A failed compose write or redeploy must never leave a
            // ProxyConfig row claiming a domain that no compose file
            // actually routes (T-06-06).
            await this.proxyRepo.delete(created.id).catch(() => {});
            throw err;
        }

        return created;
    }

    /**
     * Re-reads every ProxyConfig row for (stackId, serviceName) and writes
     * one comma-joined VIRTUAL_HOST/LETSENCRYPT_HOST pair — the D-08
     * promote invariant. Always called after any row for the pair changes.
     */
    private async rewriteServiceProxyEnv(stackId: string, serviceName: string): Promise<void> {
        const rows = await this.proxyRepo.findByStackAndService(stackId, serviceName);
        if (rows.length === 0) return;

        const virtualHost = rows.map((row) => row.domain).join(",");
        const tlsRows = rows.filter((row) => row.tlsEnabled);
        const letsencryptHost = tlsRows.length > 0 ? tlsRows.map((row) => row.domain).join(",") : null;
        const virtualPort = String(rows[0].internalPort);

        const composeContent = await this.fs.readCompose(stackId);
        let newContent: string;
        try {
            newContent = setServiceProxyEnv(composeContent, serviceName, {
                virtualHost,
                virtualPort,
                letsencryptHost,
            });
        } catch (err) {
            throw this.translateComposeProxyEditError(err);
        }
        await this.fs.writeCompose(stackId, newContent);
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
