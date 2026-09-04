import cron from "node-cron"
import {access as fsAccess} from "node:fs/promises"
import path from "node:path"
import type {DockerodeClient} from "../infrastructure/dockerode-client.js"
import {dockerodeClient} from "../infrastructure/dockerode-client.js"
import type {StateBroadcaster} from "../lib/state-broadcaster.js"
import {stateEventBroadcaster} from "../lib/state-broadcaster.js"
import {getStackPath} from "../lib/stacks-dir.js"
import {ACME_COMPANION_CONTAINER_NAME, PROXY_CERTS_SUBPATH} from "../lib/proxy-stack-compose.js"

// Fixed id of the Docktor-managed proxy stack — mirrors PROXY_STACK_ID in
// application/proxy-service.ts. Redeclared locally (not imported from that
// module) so this job's module graph stays free of proxy-service.ts's
// heavier dependency chain (compose editor, the Prisma namespace,
// StackService types), matching state-poller.ts/file-watcher.ts's existing
// precedent of keeping job modules testable with plain objects and no
// database client pulled in at import time.
const PROXY_STACK_ID = "docktor-proxy"

// A stored acme-companion log line is trimmed to this length before being
// persisted as certMessage and broadcast — the line is third-party
// container output that ends up rendered as UI text (T-06-21).
const CERT_MESSAGE_MAX_LENGTH = 500

// A line matches only when it also mentions the row's own domain (checked
// separately) — this indicator alone is deliberately broad (RESEARCH.md
// Pitfall 5: a merely-pending first issuance must never read as "failed").
const ERROR_INDICATOR = /error|failed|invalid|unauthorized|rate ?limit/i

export type ProxyCertStatus = "pending" | "issued" | "failed"

export interface ProxyConfigCertRow {
    id: string
    stackId: string
    serviceName: string
    domain: string
    tlsEnabled: boolean
    certStatus: string
}

export interface ProxyCertPollerRepo {
    findAll(): Promise<ProxyConfigCertRow[]>
    updateCertStatus(
        id: string,
        data: {certStatus: string; certMessage?: string | null; certCheckedAt?: Date | null},
    ): Promise<unknown>
}

/** A single-method filesystem port — the only capability the poller needs. */
export interface ProxyCertPollerFs {
    access(path: string): Promise<void>
}

export class ProxyCertPoller {
    private cronTask: cron.ScheduledTask | null = null
    private readonly docker: Pick<DockerodeClient, "listContainers" | "getLogTail">
    private readonly repo: ProxyCertPollerRepo | null
    private readonly broadcaster: Pick<StateBroadcaster, "publish">
    private readonly fs: ProxyCertPollerFs
    private readonly certsDir: string

    constructor(
        docker?: Pick<DockerodeClient, "listContainers" | "getLogTail">,
        repo?: ProxyCertPollerRepo,
        broadcaster?: Pick<StateBroadcaster, "publish">,
        fs?: ProxyCertPollerFs,
    ) {
        this.docker = docker ?? dockerodeClient
        this.repo = repo ?? null
        this.broadcaster = broadcaster ?? stateEventBroadcaster
        this.fs = fs ?? {access: (target: string) => fsAccess(target)}
        this.certsDir = path.join(getStackPath(PROXY_STACK_ID), PROXY_CERTS_SUBPATH)
    }

    private async getRepo(): Promise<ProxyCertPollerRepo> {
        if (this.repo !== null) return this.repo
        // Lazy-load to avoid pulling db.ts into the module graph at test time.
        const {proxyRepository} = await import("../repositories/proxy-repository.js")
        return proxyRepository as unknown as ProxyCertPollerRepo
    }

    async start(): Promise<void> {
        this.cronTask = cron.schedule("*/60 * * * * *", async () => {
            try {
                await this.reconcile()
            } catch (err) {
                console.error("[ProxyCertPoller] reconcile error:", err)
            }
        })
    }

    stop(): void {
        if (this.cronTask) {
            this.cronTask.stop()
            this.cronTask = null
        }
    }

    /**
     * Reconciles certificate state for every TLS-enabled ProxyConfig row
     * into the database and the SSE stream. Never opens a `.key` file: the
     * only paths ever passed to the filesystem port are the certs directory
     * itself and the two candidate certificate-file paths per domain.
     */
    async reconcile(): Promise<void> {
        const repo = await this.getRepo()
        const allRows = await repo.findAll()
        const rows = allRows.filter((row) => row.tlsEnabled)
        if (rows.length === 0) return

        try {
            await this.fs.access(this.certsDir)
        } catch (err) {
            console.error(`[ProxyCertPoller] cannot read certs directory "${this.certsDir}":`, err)
            return
        }

        const hasCertByRowId = new Map<string, boolean>()
        for (const row of rows) {
            // eslint-disable-next-line no-await-in-loop
            hasCertByRowId.set(row.id, await this.hasCertificateFile(row.domain))
        }

        const anyMissing = rows.some((row) => !hasCertByRowId.get(row.id))
        const logTail = anyMissing ? await this.fetchAcmeCompanionLogTail() : ""

        for (const row of rows) {
            const hasCert = hasCertByRowId.get(row.id) ?? false
            let status: ProxyCertStatus
            let message: string | undefined

            if (hasCert) {
                status = "issued"
            } else {
                const errorLine = this.findErrorLine(logTail, row.domain)
                if (errorLine) {
                    status = "failed"
                    message = errorLine.slice(0, CERT_MESSAGE_MAX_LENGTH)
                } else {
                    status = "pending"
                }
            }

            if (status === row.certStatus) continue

            // eslint-disable-next-line no-await-in-loop
            await repo.updateCertStatus(row.id, {
                certStatus: status,
                certMessage: message ?? null,
                certCheckedAt: new Date(),
            })

            this.broadcaster.publish({
                type: "proxy_cert_status",
                proxyConfigId: row.id,
                stackId: row.stackId,
                domain: row.domain,
                status,
                ...(message !== undefined && {message}),
            })
        }
    }

    /** True when either candidate certificate path for the domain exists. */
    private async hasCertificateFile(domain: string): Promise<boolean> {
        const candidates = [
            path.join(this.certsDir, `${domain}.crt`),
            path.join(this.certsDir, domain, "fullchain.pem"),
        ]
        for (const candidate of candidates) {
            try {
                // eslint-disable-next-line no-await-in-loop
                await this.fs.access(candidate)
                return true
            } catch {
                // try the next candidate path
            }
        }
        return false
    }

    /** Fetches acme-companion's log tail once, resolving "" on any failure. */
    private async fetchAcmeCompanionLogTail(): Promise<string> {
        try {
            const containers = await this.docker.listContainers(true)
            const acmeContainer = containers.find((container) =>
                (container.Names ?? []).some((name) => name.replace(/^\//, "") === ACME_COMPANION_CONTAINER_NAME),
            )
            if (!acmeContainer) return ""
            return await this.docker.getLogTail(acmeContainer.Id)
        } catch (err) {
            console.error("[ProxyCertPoller] failed to fetch acme-companion log tail:", err)
            return ""
        }
    }

    /** Returns the first log line mentioning the domain and matching the error indicator, or null. */
    private findErrorLine(logTail: string, domain: string): string | null {
        if (!logTail) return null
        for (const line of logTail.split("\n")) {
            if (line.includes(domain) && ERROR_INDICATOR.test(line)) {
                return line.trim()
            }
        }
        return null
    }
}

export const proxyCertPoller = new ProxyCertPoller()
