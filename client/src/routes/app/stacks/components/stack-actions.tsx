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
import {Tooltip, TooltipContent, TooltipProvider, TooltipTrigger} from "@/components/ui/tooltip";

interface StackActionsProps {
    readonly stackId: string;
    readonly stackName: string;
    readonly status: string;
    readonly isProtected: boolean;
    readonly onAction: () => void;
}

// D-12: the browser-side mirror of StackService.assertNotProtected — this is
// UX only, the server guard is the actual guarantee (see 06-03-SUMMARY.md).
const PROTECTED_TOOLTIP =
    "This stack is managed by Docktor and cannot be stopped, restarted, or deleted directly.";

const RUNNING_STATES = ["RUNNING", "HEALTHY", "UNHEALTHY"];
const STOPPABLE_STATES = ["RUNNING", "HEALTHY", "UNHEALTHY", "ERROR"];
const DELETABLE_STATES = ["DRAFT", "STOPPED", "ERROR"];
const BLOCKED_STATES = ["BACKING_UP", "RESTORING", "DEPLOYING"];

interface ProtectedMenuItemProps {
    readonly icon: React.ReactNode;
    readonly label: string;
    readonly className?: string;
}

// D-12: a disabled DropdownMenuItem sets pointer-events:none on itself, so
// the Tooltip's hover trigger has to live on a wrapping <span> instead — a
// disabled control inside a Radix tooltip trigger needs the trigger to stay
// focusable/hoverable, which the item itself no longer is once disabled.
function ProtectedMenuItem({icon, label, className}: Readonly<ProtectedMenuItemProps>) {
    return (
        <Tooltip>
            <TooltipTrigger asChild>
                <span className="block">
                    <DropdownMenuItem disabled className={className}>
                        {icon}
                        {label}
                    </DropdownMenuItem>
                </span>
            </TooltipTrigger>
            <TooltipContent>{PROTECTED_TOOLTIP}</TooltipContent>
        </Tooltip>
    );
}

export function StackActions({stackId, stackName, status, isProtected, onAction}: StackActionsProps) {
    const navigate = useNavigate();

    const isRunning = RUNNING_STATES.includes(status);
    const canStop = STOPPABLE_STATES.includes(status) && !isProtected;
    const canRestart = RUNNING_STATES.includes(status) && !isProtected;
    const canDelete = DELETABLE_STATES.includes(status) && !isProtected;
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
                    <TooltipProvider>
                        {isProtected ? (
                            <ProtectedMenuItem icon={<Square className="h-4 w-4" />} label="Stop" />
                        ) : (
                            <DropdownMenuItem onClick={handleStop} disabled={!canStop || isBlocked}>
                                <Square className="h-4 w-4" />
                                Stop
                            </DropdownMenuItem>
                        )}
                        {isProtected ? (
                            <ProtectedMenuItem icon={<RotateCcw className="h-4 w-4" />} label="Restart" />
                        ) : (
                            <DropdownMenuItem onClick={handleRestart} disabled={!canRestart}>
                                <RotateCcw className="h-4 w-4" />
                                Restart
                            </DropdownMenuItem>
                        )}
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
                        {isProtected ? (
                            <ProtectedMenuItem
                                icon={<Trash2 className="h-4 w-4" />}
                                label="Delete"
                                className="text-destructive focus:text-destructive"
                            />
                        ) : (
                            <DropdownMenuItem
                                onClick={handleDelete}
                                disabled={!canDelete}
                                className="text-destructive focus:text-destructive"
                            >
                                <Trash2 className="h-4 w-4" />
                                Delete
                            </DropdownMenuItem>
                        )}
                    </TooltipProvider>
                </DropdownMenuContent>
            </DropdownMenu>
        </div>
    );
}
