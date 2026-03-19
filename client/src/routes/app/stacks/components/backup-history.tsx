import {useEffect, useState} from "react";
import {Link} from "react-router";

import {getBackups, type BackupRecord} from "@/lib/backups-api";
import {BackupStatusBadge} from "@/components/domain/backup/backup-status-badge";
import {Table, TableBody, TableCell, TableHead, TableHeader, TableRow} from "@/components/ui/table";

interface BackupHistoryProps {
    readonly stackId: string;
}

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

export function BackupHistory({stackId}: BackupHistoryProps) {
    const [backups, setBackups] = useState<BackupRecord[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        let cancelled = false;

        getBackups(stackId)
            .then((data) => {
                if (!cancelled) setBackups(data);
            })
            .catch(() => {
                // silently fail
            })
            .finally(() => {
                if (!cancelled) setLoading(false);
            });

        return () => {
            cancelled = true;
        };
    }, [stackId]);

    return (
        <div className="space-y-3">
            <h2 className="text-lg font-semibold">Backup History</h2>

            {loading ? (
                <p className="text-muted-foreground text-sm">Loading...</p>
            ) : backups.length === 0 ? (
                <div className="text-center py-8 space-y-1">
                    <p className="text-sm font-medium">No backups yet</p>
                    <p className="text-sm text-muted-foreground">
                        Trigger your first backup using the Backup Now button above.
                    </p>
                </div>
            ) : (
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead>Status</TableHead>
                            <TableHead>Trigger</TableHead>
                            <TableHead>Started</TableHead>
                            <TableHead>Duration</TableHead>
                            <TableHead>Size</TableHead>
                            <TableHead></TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {backups.map((backup) => (
                            <TableRow key={backup.id}>
                                <TableCell>
                                    <BackupStatusBadge status={backup.status} />
                                </TableCell>
                                <TableCell>
                                    <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-muted text-muted-foreground">
                                        {TRIGGER_LABELS[backup.trigger]}
                                    </span>
                                </TableCell>
                                <TableCell className="text-sm text-muted-foreground">
                                    {new Date(backup.startedAt).toLocaleString()}
                                </TableCell>
                                <TableCell className="text-sm">
                                    {formatDuration(backup.startedAt, backup.completedAt)}
                                </TableCell>
                                <TableCell className="text-sm">
                                    {formatSize(backup.sizeBytes)}
                                </TableCell>
                                <TableCell>
                                    <Link
                                        to={`/stacks/${stackId}/backups/${backup.id}`}
                                        className="text-sm text-primary hover:underline"
                                    >
                                        View details
                                    </Link>
                                </TableCell>
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
            )}
        </div>
    );
}
