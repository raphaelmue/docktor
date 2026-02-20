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
        render: (stack) => <StackStatusBadge status={stack.status} />,
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

export function StackList({stacks, loading, pagination}: StackListProps) {
    return (
        <DataTable
            data={stacks}
            columns={columns}
            itemRoute={(stack) => `/stacks/${stack.id}`}
            loading={loading}
            emptyMessage="No stacks yet"
            pagination={pagination}
        />
    );
}
