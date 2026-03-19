import {useNavigate} from "react-router";
import {toast} from "sonner";
import {Archive, MoreHorizontal, Play, RefreshCw, RotateCcw, Square, Trash2} from "lucide-react";

import {deployStack, stopStack, restartStack, updateImages, deleteStack} from "@/lib/stacks-api";
import {triggerBackup} from "@/lib/backups-api";
import {Button} from "@/components/ui/button";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface StackActionsProps {
    readonly stackId: string;
    readonly stackName: string;
    readonly status: string;
    readonly onAction: () => void;
}

const RUNNING_STATES = ["RUNNING", "HEALTHY", "UNHEALTHY"];
const STOPPABLE_STATES = ["RUNNING", "HEALTHY", "UNHEALTHY", "ERROR"];
const DELETABLE_STATES = ["DRAFT", "STOPPED", "ERROR"];
const BLOCKED_STATES = ["BACKING_UP", "RESTORING", "DEPLOYING"];

export function StackActions({stackId, stackName, status, onAction}: StackActionsProps) {
    const navigate = useNavigate();

    const isRunning = RUNNING_STATES.includes(status);
    const canStop = STOPPABLE_STATES.includes(status);
    const canRestart = RUNNING_STATES.includes(status);
    const canDelete = DELETABLE_STATES.includes(status);
    const isBackingUp = status === "BACKING_UP";
    const isBlocked = BLOCKED_STATES.includes(status);

    const deployLabel = isRunning ? "Redeploy" : "Deploy";

    function handleDeploy() {
        toast.promise(
            (async () => {
                await deployStack(stackId);
                onAction();
            })(),
            {
                loading: "Deploying...",
                success: "Deploy completed",
                error: (err: Error) => err?.message ?? "Deploy failed",
            },
        );
    }

    function handleStop() {
        toast.promise(
            (async () => {
                await stopStack(stackId);
                onAction();
            })(),
            {
                loading: "Stopping...",
                success: "Stack stopped",
                error: (err: Error) => err?.message ?? "Stop failed",
            },
        );
    }

    function handleRestart() {
        toast.promise(
            (async () => {
                await restartStack(stackId);
                onAction();
            })(),
            {
                loading: "Restarting...",
                success: "Stack restarted",
                error: (err: Error) => err?.message ?? "Restart failed",
            },
        );
    }

    function handleUpdateImages() {
        toast.promise(
            (async () => {
                const result = await updateImages(stackId);
                onAction();
                return result;
            })(),
            {
                loading: "Updating images...",
                success: (result) =>
                    result.noUpdates ? "Images are already up to date" : "Images updated successfully",
                error: (err: Error) => err?.message ?? "Update images failed",
            },
        );
    }

    async function handleBackupNow() {
        try {
            const {backupId} = await triggerBackup(stackId);
            onAction();
            toast.success("Backup started", {
                action: {
                    label: "View progress",
                    onClick: () => navigate(`/stacks/${stackId}/backups/${backupId}`),
                },
            });
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : "Backup failed";
            toast.error(message);
        }
    }

    function handleDelete() {
        if (!confirm(`Delete stack "${stackName}"?`)) return;
        toast.promise(
            (async () => {
                await deleteStack(stackId);
                navigate("/stacks");
            })(),
            {
                loading: "Deleting...",
                success: "Stack deleted",
                error: (err: Error) => err?.message ?? "Delete failed",
            },
        );
    }

    return (
        <div className="flex items-center gap-2">
            <Button size="sm" onClick={handleDeploy} disabled={isBlocked}>
                <Play className="h-4 w-4 mr-1" />
                {deployLabel}
            </Button>

            <DropdownMenu>
                <DropdownMenuTrigger asChild>
                    <Button variant="outline" size="icon" aria-label="Stack actions">
                        <MoreHorizontal className="h-4 w-4" />
                    </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                    <DropdownMenuItem
                        onClick={handleStop}
                        disabled={!canStop || isBlocked}
                    >
                        <Square className="h-4 w-4" />
                        Stop
                    </DropdownMenuItem>
                    <DropdownMenuItem
                        onClick={handleRestart}
                        disabled={!canRestart}
                    >
                        <RotateCcw className="h-4 w-4" />
                        Restart
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={handleUpdateImages}>
                        <RefreshCw className="h-4 w-4" />
                        Update Images
                    </DropdownMenuItem>
                    <DropdownMenuItem
                        onClick={handleBackupNow}
                        disabled={isBackingUp}
                    >
                        <Archive className="h-4 w-4" />
                        {isBackingUp ? "Backup in progress..." : "Backup Now"}
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                        onClick={handleDelete}
                        disabled={!canDelete}
                        className="text-destructive focus:text-destructive"
                    >
                        <Trash2 className="h-4 w-4" />
                        Delete
                    </DropdownMenuItem>
                </DropdownMenuContent>
            </DropdownMenu>
        </div>
    );
}
