import {Badge} from "@/components/ui/badge";

const statusConfig: Record<
    string,
    {label: string; variant: "default" | "secondary" | "destructive" | "outline"}
> = {
    DRAFT: {label: "Draft", variant: "secondary"},
    DEPLOYING: {label: "Deploying", variant: "default"},
    RUNNING: {label: "Running", variant: "default"},
    HEALTHY: {label: "Healthy", variant: "default"},
    UNHEALTHY: {label: "Unhealthy", variant: "destructive"},
    STOPPED: {label: "Stopped", variant: "secondary"},
    ERROR: {label: "Error", variant: "destructive"},
    UPDATING: {label: "Updating", variant: "default"},
    BACKING_UP: {label: "Backing Up", variant: "outline"},
    RESTORING: {label: "Restoring", variant: "outline"},
    MIGRATING: {label: "Migrating", variant: "outline"},
};

const statusColors: Record<string, string> = {
    RUNNING: "bg-green-500/15 text-green-700 border-green-500/25",
    HEALTHY: "bg-green-500/15 text-green-700 border-green-500/25",
    ERROR: "bg-red-500/15 text-red-700 border-red-500/25",
    UNHEALTHY: "bg-red-500/15 text-red-700 border-red-500/25",
    DEPLOYING: "bg-blue-500/15 text-blue-700 border-blue-500/25 animate-pulse",
    UPDATING: "bg-blue-500/15 text-blue-700 border-blue-500/25 animate-pulse",
    STOPPED: "bg-gray-500/15 text-gray-700 border-gray-500/25",
    DRAFT: "bg-gray-500/15 text-gray-700 border-gray-500/25",
};

export function StackStatusBadge({status}: {status: string}) {
    const config = statusConfig[status] ?? {
        label: status,
        variant: "outline" as const,
    };
    const colorClass = statusColors[status] ?? "";

    return (
        <Badge variant={config.variant} className={colorClass}>
            {config.label}
        </Badge>
    );
}
