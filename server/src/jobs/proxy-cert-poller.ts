import cron from "node-cron"
import {access as fsAccess, readFile as fsReadFile} from "node:fs/promises"
import path from "node:path"
import type {DockerodeClient} from "../infrastructure/dockerode-client.js"
import {dockerodeClient} from "../infrastructure/dockerode-client.js"
import type {StateBroadcaster} from "../lib/state-broadcaster.js"
import {stateEventBroadcaster} from "../lib/state-broadcaster.js"
import {getStackPath} from "../lib/stacks-dir.js"
import {ACME_COMPANION_CONTAINER_NAME, PROXY_CERTS_SUBPATH} from "../lib/proxy-stack-compose.js"
import {certFileBaseName} from "../domain/certificate-naming.js"
import {certificateExpiry, parseCertificate} from "../domain/certificate-validation.js"
import {CERTIFICATE_EXPIRY_WARNING_DAYS} from "@docktor/shared"

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

export type ProxyCertStatus = "pending" | "issued" | "failed" | "expiring"

export interface ProxyConfigCertRow {
    id: string
    stackId: string
    serviceName: string
    domain: string
    tlsEnabled: boolean
    certStatus: string
    // D-11: governs which branch below classifies this row. "acme" keeps
    // exactly the pre-existing file+log-tail logic; anything else (in
    // practice "custom") is classified by file presence and expiry alone,
    // through the linked certificate below.
    certSource: string
    // The linked Certificate's own domain pattern and expiry (null for an
    // ACME-sourced row, which has no linked Certificate). Intentionally the
    // natural shape of the Prisma include this row comes from — never
    // ProxyConfig.domain, which would resolve a wildcard certificate's file
    // to the wrong name (RESEARCH.md Pitfall 3).
    certificate: {domainPattern: string; expiresAt: Date} | null
}

export interface ProxyCertPollerRepo {
    findAllForCertPolling(): Promise<ProxyConfigCertRow[]>
    updateCertStatus(
        id: string,
        data: {certStatus: string; certMessage?: string | null; certCheckedAt?: Date | null},
    ): Promise<unknown>
}

/** The filesystem port — the only capabilities the poller needs. Never given a `.key` path. */
export interface ProxyCertPollerFs {
    access(path: string): Promise<void>
    readFile(path: string): Promise<string>
}

// Re-exported under this job's pre-existing local name so this module's
// public surface (and the test importing it) is unchanged — the single
// source of truth is now @docktor/shared's CERTIFICATE_EXPIRY_WARNING_DAYS,
// which the client's "expiring soon" badge imports too, so the two can never
// drift apart (previously duplicated as two independent literals — see
// 09-REVIEW.md IN-01).
export const CERT_EXPIRY_WARNING_DAYS = CERTIFICATE_EXPIRY_WARNING_DAYS

/**
 * Pure, clock-injectable classification of a certificate's expiry against a
 * warning window — never reads a clock or a file itself, so every boundary
 * (far-future, inside-window, exactly-at-boundary, already-past) is testable
 * without manipulating time. "issued" outside the window, "expiring" once
 * inside it (inclusive of the boundary), "failed" once already past.
 */
export function classifyCertificateExpiry(
    validTo: Date,
    now: Date,
    warningDays: number,
): "issued" | "expiring" | "failed" {
    const warningThresholdMs = warningDays * 24 * 60 * 60 * 1000
    const msUntilExpiry = validTo.getTime() - now.getTime()

    if (msUntilExpiry <= 0) return "failed"
    if (msUntilExpiry <= warningThresholdMs) return "expiring"
    return "issued"
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
        this.fs = fs ?? {
            access: (target: string) => fsAccess(target),
            readFile: (target: string) => fsReadFile(target, "utf-8"),
        }
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
     * itself, the two ACME candidate certificate-file paths per domain, and
     * — for a custom-sourced row — the single `.crt` path resolved from its
     * linked certificate's own domain pattern (never the row's routing
     * hostname). ACME-sourced rows are classified exactly as before (file
     * presence, with the container log tail consulted at most once and only
     * when an ACME row is missing its file); custom-sourced rows are
     * classified from file presence and expiry alone — never from the log,
     * since there is no issuance process whose failure it could describe.
     */
    async reconcile(): Promise<void> {
        const repo = await this.getRepo()
        const allRows = await repo.findAllForCertPolling()
        const rows = allRows.filter((row) => row.tlsEnabled)
        if (rows.length === 0) return

        try {
            await this.fs.access(this.certsDir)
        } catch (err) {
            console.error(`[ProxyCertPoller] cannot read certs directory "${this.certsDir}":`, err)
            return
        }

        const acmeRows = rows.filter((row) => row.certSource === "acme")
        const customRows = rows.filter((row) => row.certSource !== "acme")

        await this.reconcileAcmeRows(repo, acmeRows)
        await this.reconcileCustomRows(repo, customRows)
    }

    /** ACME-sourced rows: file presence, with the container log tail consulted at most once — unchanged from before D-11. */
    private async reconcileAcmeRows(repo: ProxyCertPollerRepo, rows: ProxyConfigCertRow[]): Promise<void> {
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

            // eslint-disable-next-line no-await-in-loop
            await this.applyStatus(repo, row, status, message)
        }
    }

    /**
     * Custom-sourced rows: classified from file presence and expiry alone,
     * via the linked certificate's own domain pattern — never the log tail,
     * never the row's routing hostname (D-11/D-13, RESEARCH.md Pitfall 3).
     */
    private async reconcileCustomRows(repo: ProxyCertPollerRepo, rows: ProxyConfigCertRow[]): Promise<void> {
        for (const row of rows) {
            // eslint-disable-next-line no-await-in-loop
            const {status, message} = await this.classifyCustomRow(row)
            // eslint-disable-next-line no-await-in-loop
            await this.applyStatus(repo, row, status, message)
        }
    }

    /**
     * Resolves a custom-sourced row's classification. The base name is
     * always derived from the linked Certificate's own domainPattern via
     * certFileBaseName — the same pure function plan 09-06 used to write
     * the file, so writer and reader cannot disagree. A missing file is
     * "failed", never "pending": there is no issuance process to be
     * waiting for. Prefers the certificate's persisted expiresAt (parsed
     * once at upload and unchanging); reading the file's own PEM content is
     * only used to derive expiry when that persisted value is somehow
     * absent, and remains how file *presence* is confirmed either way.
     */
    private async classifyCustomRow(row: ProxyConfigCertRow): Promise<{status: ProxyCertStatus; message?: string}> {
        if (!row.certificate) {
            return {status: "failed", message: "No certificate is linked to this configuration"}
        }

        const baseName = certFileBaseName(row.certificate.domainPattern)
        const filePath = path.join(this.certsDir, `${baseName}.crt`)

        let fileContent: string
        try {
            await this.fs.access(filePath)
            fileContent = await this.fs.readFile(filePath)
        } catch {
            return {status: "failed", message: `Certificate file "${baseName}.crt" was not found`}
        }

        const expiry = row.certificate.expiresAt ?? this.parseExpiryFromPem(fileContent)
        if (!expiry) {
            return {status: "failed", message: "Certificate expiry could not be determined"}
        }

        const status = classifyCertificateExpiry(expiry, new Date(), CERT_EXPIRY_WARNING_DAYS)
        if (status === "issued") return {status}

        const formattedDate = expiry.toISOString().slice(0, 10)
        const verb = status === "expiring" ? "expires" : "expired"
        return {status, message: `Certificate ${verb} on ${formattedDate}`}
    }

    /** Fallback-only: parses a certificate's not-after date from its PEM content when no persisted expiry is available. */
    private parseExpiryFromPem(pem: string): Date | null {
        const parsed = parseCertificate(pem)
        return parsed.ok ? certificateExpiry(parsed.cert) : null
    }

    /** Writes and publishes only when the computed status differs from what's stored — the single choke point both row-kind loops share. */
    private async applyStatus(
        repo: ProxyCertPollerRepo,
        row: ProxyConfigCertRow,
        status: ProxyCertStatus,
        message: string | undefined,
    ): Promise<void> {
        if (status === row.certStatus) return

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
