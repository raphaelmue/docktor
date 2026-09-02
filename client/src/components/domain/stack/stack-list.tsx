import {DataTable, type TableColumn} from "@/components/common/data/table";
import {StackStatusBadge} from "@/components/domain/stack/stack-status-badge";
import type {StackWithServices} from "@/lib/stacks-api";

interface StackListProps {
    stacks: StackWithServices[];
    loading?: boolean;
    pagination?: boolean;
}

const columns: TableColumn<StackWithServices>[] = [
    {
        name: "Name",
        isKey: true,
        render: (stack) => (
            <div>
                <span className="font-medium">{stack.displayName}</span>
                {stack.description && (
                    <p className="text-sm text-muted-foreground">
                        {stack.description}
                    </p>
                )}
            </div>
        ),
    },
    {
        name: "Status",
        render: (stack) => (
            <div className="flex flex-wrap items-center gap-1">
                <StackStatusBadge status={stack.status} />
                {stack.configError && (
                    <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200">
                        config error
                    </span>
                )}
                {stack.configChanged && (
                    <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200">
                        config changed
                    </span>
                )}
            </div>
        ),
    },
    {
        name: "Services",
        render: (stack) => <span>{stack.services.length}</span>,
    },
    {
        name: "Created",
        render: (stack) => (
            <span className="text-muted-foreground">
                {new Date(stack.createdAt).toLocaleDateString()}
            </span>
        ),
    },
];

export function StackList({stacks, loading, pagination}: Readonly<StackListProps>) {
    return (
        <DataTable
            data={stacks}
            columns={columns}
            getRowKey={(stack) => stack.id}
            itemRoute={(stack) => `/stacks/${stack.id}`}
            loading={loading}
            emptyMessage="No stacks yet"
            pagination={pagination}
        />
    );
}
