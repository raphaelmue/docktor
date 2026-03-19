import {useEffect, useRef, useState} from "react";
import {useNavigate} from "react-router";
import {toast} from "sonner";
import {RefreshCw} from "lucide-react";

import {getSnapshots, triggerRestore, type ResticSnapshot} from "@/lib/backups-api";
import {RestoreConfirmDialog} from "@/components/domain/backup/restore-confirm-dialog";
import {Button} from "@/components/ui/button";
import {Alert, AlertDescription} from "@/components/ui/alert";
import {Skeleton} from "@/components/ui/skeleton";
import {Table, TableBody, TableCell, TableHead, TableHeader, TableRow} from "@/components/ui/table";

interface SnapshotsSectionProps {
    readonly stackId: string;
    readonly stackName: string;
    readonly stackStatus: string;
}

const TRANSITIONAL_STATES = ["BACKING_UP", "RESTORING"];

export function SnapshotsSection({stackId, stackName, stackStatus}: SnapshotsSectionProps) {
    const navigate = useNavigate();
    const [snapshots, setSnapshots] = useState<ResticSnapshot[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(false);
    const [dialogOpen, setDialogOpen] = useState(false);
    const [selectedSnapshot, setSelectedSnapshot] = useState<ResticSnapshot | null>(null);

    const prevStatusRef = useRef(stackStatus);

    async function fetchSnapshots() {
        setLoading(true);
        setError(false);
        try {
            const data = await getSnapshots(stackId);
            setSnapshots(data);
        } catch {
            setError(true);
        } finally {
            setLoading(false);
        }
    }

    useEffect(() => {
        void fetchSnapshots();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [stackId]);

    // Refresh snapshots when transitioning OUT of a transitional state
    useEffect(() => {
        const prev = prevStatusRef.current;
        const wasTransitional = TRANSITIONAL_STATES.includes(prev);
        const isTransitional = TRANSITIONAL_STATES.includes(stackStatus);
        if (wasTransitional && !isTransitional) {
            void fetchSnapshots();
        }
        prevStatusRef.current = stackStatus;
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [stackStatus]);

    async function handleConfirmRestore() {
        if (!selectedSnapshot) return;
        try {
            const {backupId} = await triggerRestore(stackId, selectedSnapshot.id);
            toast.success("Restore started", {
                action: {
                    label: "View progress",
                    onClick: () => navigate(`/stacks/${stackId}/backups/${backupId}`),
                },
            });
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : "Restore failed";
            toast.error(message);
        }
    }

    const isLocked = TRANSITIONAL_STATES.includes(stackStatus);

    return (
        <div className="space-y-3">
            <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold">Snapshots</h2>
                <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => void fetchSnapshots()}
                    aria-label="Refresh snapshots"
                >
                    <RefreshCw className="h-4 w-4 mr-1" />
                    Refresh
                </Button>
            </div>

            {isLocked ? (
                <Alert>
                    <AlertDescription>
                        A backup is in progress. Snapshot list will refresh when complete.
                    </AlertDescription>
                </Alert>
            ) : loading ? (
                <div className="space-y-2">
                    <Skeleton className="h-10 w-full" />
                    <Skeleton className="h-10 w-full" />
                    <Skeleton className="h-10 w-full" />
                </div>
            ) : error ? (
                <div className="space-y-3">
                    <Alert variant="destructive">
                        <AlertDescription>
                            Could not load snapshots. The backup repository may be unreachable.
                        </AlertDescription>
                    </Alert>
                    <Button variant="outline" size="sm" onClick={() => void fetchSnapshots()}>
                        Retry
                    </Button>
                </div>
            ) : snapshots.length === 0 ? (
                <div className="text-center py-8 space-y-1">
                    <p className="text-sm font-medium">No snapshots found</p>
                    <p className="text-sm text-muted-foreground">
                        Run a backup to create the first snapshot in this repository.
                    </p>
                </div>
            ) : (
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead>Snapshot ID</TableHead>
                            <TableHead>Date</TableHead>
                            <TableHead>Tags</TableHead>
                            <TableHead></TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {snapshots.map((snapshot) => (
                            <TableRow key={snapshot.id}>
                                <TableCell className="font-mono text-xs">
                                    {snapshot.short_id.slice(0, 8)}
                                </TableCell>
                                <TableCell className="text-sm text-muted-foreground">
                                    {new Date(snapshot.time).toLocaleString()}
                                </TableCell>
                                <TableCell className="text-sm text-muted-foreground">
                                    {snapshot.tags ? snapshot.tags.join(", ") : "-"}
                                </TableCell>
                                <TableCell>
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={() => {
                                            setSelectedSnapshot(snapshot);
                                            setDialogOpen(true);
                                        }}
                                    >
                                        Restore
                                    </Button>
                                </TableCell>
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
            )}

            {selectedSnapshot && (
                <RestoreConfirmDialog
                    open={dialogOpen}
                    onOpenChange={setDialogOpen}
                    stackName={stackName}
                    snapshotId={selectedSnapshot.id}
                    onConfirm={handleConfirmRestore}
                />
            )}
        </div>
    );
}
