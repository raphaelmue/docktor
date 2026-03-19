import {useEffect, useState} from "react";
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

    useEffect(() => {
        let cancelled = false;
        setLoading(true);
        setError(null);

        getBackup(backupId)
            .then((data) => {
                if (!cancelled) setBackup(data);
            })
            .catch((err: unknown) => {
                if (!cancelled) {
                    setError(err instanceof Error ? err.message : "Failed to load backup");
                }
            })
            .finally(() => {
                if (!cancelled) setLoading(false);
            });

        return () => {
            cancelled = true;
        };
    }, [backupId]);

    const displayLines = isStreaming ? streamLines : (backup?.logLines ?? []);
    const isStillStreaming = isStreaming && streamStatus === "streaming";

    const shortId = (backup?.resticSnapshotId ?? backupId).slice(0, 8);
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
                            emptyMessage="No output yet..."
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
