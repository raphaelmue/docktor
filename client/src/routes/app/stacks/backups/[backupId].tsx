import {useCallback, useEffect, useState} from "react";
import {Link, useParams} from "react-router";

import {getBackup, type BackupRecord} from "@/lib/backups-api";
import {useBackupStream} from "@/hooks/use-backup-stream";
import {BackupStatusBadge} from "@/components/domain/backup/backup-status-badge";
import {LogOutput} from "@/components/common/log-output";
import {Page, PageContent, PageHeader, PageTitle} from "@/components/common/layout/page";
import {Card, CardContent, CardHeader, CardTitle} from "@/components/ui/card";
import {Alert, AlertDescription} from "@/components/ui/alert";
import {
    Breadcrumb,
    BreadcrumbItem,
    BreadcrumbLink,
    BreadcrumbList,
    BreadcrumbPage,
    BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";

function formatDuration(startedAt: string, completedAt: string | null): string {
    if (!completedAt) return "In progress...";
    const ms = new Date(completedAt).getTime() - new Date(startedAt).getTime();
    if (ms < 1000) return "< 1s";
    const totalSeconds = Math.floor(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    if (minutes === 0) return `${seconds}s`;
    return `${minutes}m ${seconds}s`;
}

function formatSize(sizeBytes: string | null): string {
    if (!sizeBytes) return "-";
    const bytes = Number(sizeBytes);
    if (isNaN(bytes)) return "-";
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

const TRIGGER_LABELS: Record<BackupRecord["trigger"], string> = {
    MANUAL: "Manual",
    SCHEDULED: "Scheduled",
    RESTORE: "Restore",
};

// Bounds the disconnected-case poll at five minutes: interval * max = 300s.
const BACKUP_RESYNC_POLL_INTERVAL_MS = 5000;
const BACKUP_RESYNC_MAX_POLLS = 60;

export default function BackupDetailPage() {
    const {id = "", backupId = ""} = useParams<{id: string; backupId: string}>();
    const [backup, setBackup] = useState<BackupRecord | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const isStreaming = backup?.status === "IN_PROGRESS";
    const {lines: streamLines, status: streamStatus} = useBackupStream(
        backupId,
        isStreaming ?? false,
    );

    // A resync (stream reached a terminal state) must never disturb the
    // loading/error branches that swap out the whole mounted tree — only the
    // initial mount load may set them. Mirrors use-stack.ts's initial/background split.
    const loadBackup = useCallback(
        (mode: "initial" | "resync", isCancelled: () => boolean) => {
            if (mode === "initial") {
                setLoading(true);
                setError(null);
            }

            getBackup(backupId)
                .then((data) => {
                    if (isCancelled()) return;
                    setBackup(data);
                })
                .catch((err: unknown) => {
                    if (isCancelled()) return;
                    if (mode === "initial") {
                        setError(err instanceof Error ? err.message : "Failed to load backup");
                    } else {
                        console.warn("Background backup refresh failed", err);
                    }
                })
                .finally(() => {
                    if (isCancelled()) return;
                    if (mode === "initial") setLoading(false);
                });
        },
        [backupId],
    );

    useEffect(() => {
        let cancelled = false;
        loadBackup("initial", () => cancelled);
        return () => {
            cancelled = true;
        };
    }, [backupId, loadBackup]);

    // One-shot resync: fires when the stream reaches a real terminal verdict
    // (completed or failed) while a stream is active. Once the refetched record
    // is terminal, isStreaming goes false and this guard short-circuits — so
    // this cannot become a request loop against GET /api/backups/:id. The
    // "disconnected" case is handled by the poll effect below instead, so the
    // two effects can never both fetch for the same transition.
    useEffect(() => {
        if (!isStreaming || (streamStatus !== "completed" && streamStatus !== "failed")) return;

        let cancelled = false;
        loadBackup("resync", () => cancelled);
        return () => {
            cancelled = true;
        };
    }, [isStreaming, streamStatus, loadBackup]);

    // Bounded poll for the disconnected case: CR-01's answer to a dropped SSE
    // connection permanently freezing the page. Re-reads the record instead of
    // trusting anything the dropped connection implied, and terminates from
    // three independent directions: the record leaving IN_PROGRESS (isStreaming
    // flips false), the hook's reconnect succeeding (streamStatus returns to
    // "streaming"), or the hard BACKUP_RESYNC_MAX_POLLS ceiling.
    useEffect(() => {
        if (!isStreaming || streamStatus !== "disconnected") return;

        let cancelled = false;
        let pollCount = 0;
        loadBackup("resync", () => cancelled);

        const interval = setInterval(() => {
            pollCount += 1;
            if (pollCount >= BACKUP_RESYNC_MAX_POLLS) {
                clearInterval(interval);
                return;
            }
            loadBackup("resync", () => cancelled);
        }, BACKUP_RESYNC_POLL_INTERVAL_MS);

        return () => {
            cancelled = true;
            clearInterval(interval);
        };
    }, [isStreaming, streamStatus, loadBackup]);

    const displayLines = isStreaming ? streamLines : (backup?.logLines ?? []);
    const isStillStreaming = isStreaming && streamStatus === "streaming";
    const outputEmptyMessage =
        backup?.status === "FAILED" && displayLines.length === 0
            ? "No log output was captured for this backup."
            : "No output yet...";

    // initiateBackup persists resticSnapshotId as "" on every new row, and that
    // empty string lasts for the whole time a backup is IN_PROGRESS — precisely
    // when a user most often opens this page. Nullish coalescing alone doesn't
    // catch it, so the fallback must be an OR, not a `??`.
    const shortId = (backup?.resticSnapshotId || backupId).slice(0, 8);
    const titlePrefix = backup?.trigger === "RESTORE" ? "Restore" : "Backup";
    const pageTitle = `${titlePrefix} #${shortId}`;

    if (loading) {
        return (
            <Page>
                <PageHeader
                    breadcrumbs={
                        <Breadcrumb>
                            <BreadcrumbList>
                                <BreadcrumbItem>
                                    <BreadcrumbLink asChild>
                                        <Link to="/stacks">Stacks</Link>
                                    </BreadcrumbLink>
                                </BreadcrumbItem>
                                <BreadcrumbSeparator />
                                <BreadcrumbItem>
                                    <BreadcrumbLink asChild>
                                        <Link to={`/stacks/${id}`}>Stack</Link>
                                    </BreadcrumbLink>
                                </BreadcrumbItem>
                                <BreadcrumbSeparator />
                                <BreadcrumbItem>
                                    <BreadcrumbPage>Loading...</BreadcrumbPage>
                                </BreadcrumbItem>
                            </BreadcrumbList>
                        </Breadcrumb>
                    }
                >
                    <PageTitle>Loading...</PageTitle>
                </PageHeader>
                <PageContent>
                    <p className="text-muted-foreground">Loading backup details...</p>
                </PageContent>
            </Page>
        );
    }

    if (error || !backup) {
        return (
            <Page>
                <PageHeader
                    breadcrumbs={
                        <Breadcrumb>
                            <BreadcrumbList>
                                <BreadcrumbItem>
                                    <BreadcrumbLink asChild>
                                        <Link to="/stacks">Stacks</Link>
                                    </BreadcrumbLink>
                                </BreadcrumbItem>
                                <BreadcrumbSeparator />
                                <BreadcrumbItem>
                                    <BreadcrumbLink asChild>
                                        <Link to={`/stacks/${id}`}>Stack</Link>
                                    </BreadcrumbLink>
                                </BreadcrumbItem>
                                <BreadcrumbSeparator />
                                <BreadcrumbItem>
                                    <BreadcrumbPage>Error</BreadcrumbPage>
                                </BreadcrumbItem>
                            </BreadcrumbList>
                        </Breadcrumb>
                    }
                >
                    <PageTitle>Error</PageTitle>
                </PageHeader>
                <PageContent>
                    <Alert variant="destructive">
                        <AlertDescription>{error ?? "Backup not found"}</AlertDescription>
                    </Alert>
                </PageContent>
            </Page>
        );
    }

    return (
        <Page>
            <PageHeader
                breadcrumbs={
                    <Breadcrumb>
                        <BreadcrumbList>
                            <BreadcrumbItem>
                                <BreadcrumbLink asChild>
                                    <Link to="/stacks">Stacks</Link>
                                </BreadcrumbLink>
                            </BreadcrumbItem>
                            <BreadcrumbSeparator />
                            <BreadcrumbItem>
                                <BreadcrumbLink asChild>
                                    <Link to={`/stacks/${id}`}>{backup.stackId}</Link>
                                </BreadcrumbLink>
                            </BreadcrumbItem>
                            <BreadcrumbSeparator />
                            <BreadcrumbItem>
                                <BreadcrumbLink asChild>
                                    <Link to={`/stacks/${id}?tab=backups`}>Backups</Link>
                                </BreadcrumbLink>
                            </BreadcrumbItem>
                            <BreadcrumbSeparator />
                            <BreadcrumbItem>
                                <BreadcrumbPage>{shortId}</BreadcrumbPage>
                            </BreadcrumbItem>
                        </BreadcrumbList>
                    </Breadcrumb>
                }
            >
                <PageTitle>{pageTitle}</PageTitle>
            </PageHeader>

            <PageContent className="space-y-4">
                {/* Metadata card */}
                <Card>
                    <CardContent className="pt-6">
                        <div className="flex flex-wrap items-center gap-4 text-sm">
                            <BackupStatusBadge status={backup.status} />
                            <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-muted text-muted-foreground">
                                {TRIGGER_LABELS[backup.trigger]}
                            </span>
                            <span className="text-muted-foreground">
                                Started: {new Date(backup.startedAt).toLocaleString()}
                            </span>
                            <span className="text-muted-foreground">
                                Duration: {formatDuration(backup.startedAt, backup.completedAt)}
                            </span>
                            <span className="text-muted-foreground">
                                Size: {formatSize(backup.sizeBytes)}
                            </span>
                        </div>
                    </CardContent>
                </Card>

                {/* Log output card */}
                <Card>
                    <CardHeader>
                        <CardTitle>Output</CardTitle>
                    </CardHeader>
                    <CardContent className="p-0">
                        <LogOutput
                            lines={displayLines}
                            autoScroll={isStillStreaming}
                            emptyMessage={outputEmptyMessage}
                        />
                    </CardContent>
                </Card>

                {/* Error alert */}
                {backup.status === "FAILED" && backup.errorMessage && (
                    <Alert variant="destructive">
                        <AlertDescription>
                            {backup.trigger === "RESTORE"
                                ? `Restore failed: ${backup.errorMessage}. The stack is in ERROR state. You can retry from the Backups tab.`
                                : `Backup failed: ${backup.errorMessage}`}
                        </AlertDescription>
                    </Alert>
                )}
            </PageContent>
        </Page>
    );
}
