import {type ReactNode, useMemo} from "react";
import {useSearchParams} from "react-router";
import {Skeleton} from "@/components/ui/skeleton";
import {TableContent} from "./table-content";
import {TablePagination} from "./table-pagination";

export interface TableColumn<T> {
    name: string;
    render: (item: T) => ReactNode;
    isKey?: boolean;
}

export interface DataTableProps<T> {
    data: T[];
    columns: TableColumn<T>[];
    itemRoute?: (item: T) => string;
    loading?: boolean;
    emptyMessage?: string;
    pagination?: boolean;
    defaultPageSize?: number;
}

export function DataTable<T>({
    data,
    columns,
    itemRoute,
    loading = false,
    emptyMessage = "No data",
    pagination = true,
    defaultPageSize = 10,
}: Readonly<DataTableProps<T>>) {
    const [searchParams] = useSearchParams();

    const page = pagination ? Math.max(1, Number(searchParams.get("page")) || 1) : 1;
    const pageSize = pagination
        ? Number(searchParams.get("pageSize")) || defaultPageSize
        : data.length;
    const totalPages = Math.max(1, Math.ceil(data.length / pageSize));
    const currentPage = Math.min(page, totalPages);

    const pageData = useMemo(() => {
        if (!pagination) return data;
        const start = (currentPage - 1) * pageSize;
        return data.slice(start, start + pageSize);
    }, [data, currentPage, pageSize, pagination]);

    if (loading) {
        return (
            <div className="space-y-3">
                {Array.from({length: 3}).map((_, i) => (
                    <Skeleton key={i} className="h-12 w-full" />
                ))}
            </div>
        );
    }

    if (data.length === 0) {
        return (
            <div className="text-center py-12 text-muted-foreground">
                <p>{emptyMessage}</p>
            </div>
        );
    }

    return (
        <div className="space-y-4">
            <TableContent
                data={pageData}
                columns={columns}
                itemRoute={itemRoute}
            />
            {pagination && data.length > pageSize && (
                <TablePagination
                    currentPage={currentPage}
                    totalPages={totalPages}
                    pageSize={pageSize}
                    totalItems={data.length}
                />
            )}
        </div>
    );
}
