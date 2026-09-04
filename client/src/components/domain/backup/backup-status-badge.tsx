interface BackupStatusBadgeProps {
    readonly status: "IN_PROGRESS" | "COMPLETED" | "FAILED"
}

const STATUS_CONFIG: Record<
    BackupStatusBadgeProps["status"],
    {label: string; className: string}
> = {
    IN_PROGRESS: {
        label: "In Progress",
        className:
            "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
    },
    COMPLETED: {
        label: "Completed",
        className:
            "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
    },
    FAILED: {
        label: "Failed",
        className:
            "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
    },
}

export function BackupStatusBadge({status}: BackupStatusBadgeProps) {
    const config = STATUS_CONFIG[status]

    return (
        <span
            className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${config.className}`}
        >
            {config.label}
        </span>
    )
}
