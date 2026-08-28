export interface ServiceStatusBadgeProps {
    readonly containerState: string | null;
    readonly healthStatus: string | null;
}

export function ServiceStatusBadge({containerState, healthStatus}: Readonly<ServiceStatusBadgeProps>) {
    if (!containerState) {
        return <span
            className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-muted text-muted-foreground">unknown</span>;
    }

    let className: string;
    let label: string;

    if (containerState === "running" && healthStatus === "healthy") {
        className = "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200";
        label = "healthy";
    } else if (containerState === "running" && healthStatus === "unhealthy") {
        className = "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200";
        label = "unhealthy";
    } else if (containerState === "running") {
        className = "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200";
        label = "running";
    } else if (containerState === "exited") {
        className = "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-muted text-muted-foreground";
        label = "exited";
    } else if (containerState === "restarting") {
        className = "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200";
        label = "restarting";
    } else {
        className = "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-muted text-muted-foreground";
        label = containerState;
    }

    return <span className={className}>{label}</span>;
}
