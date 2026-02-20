import {useNavigate} from "react-router";
import {useIsMobile} from "@/hooks/use-mobile";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import {Card, CardContent} from "@/components/ui/card";
import type {TableColumn} from "./data-table";

interface TableContentProps<T> {
    data: T[];
    columns: TableColumn<T>[];
    itemRoute?: (item: T) => string;
}

export function TableContent<T>({
    data,
    columns,
    itemRoute,
}: TableContentProps<T>) {
    const isMobile = useIsMobile();
    const navigate = useNavigate();

    if (isMobile) {
        const keyColumn = columns.find((c) => c.isKey) ?? columns[0];
        const otherColumns = columns.filter((c) => c !== keyColumn);

        return (
            <div className="space-y-3">
                {data.map((item, i) => (
                    <Card
                        key={i}
                        className={itemRoute ? "cursor-pointer hover:bg-accent/50 transition-colors" : ""}
                        onClick={itemRoute ? () => navigate(itemRoute(item)) : undefined}
                    >
                        <CardContent className="p-4 space-y-2">
                            <div className="font-medium">
                                {keyColumn.render(item)}
                            </div>
                            {otherColumns.map((col) => (
                                <div
                                    key={col.name}
                                    className="flex items-center justify-between text-sm"
                                >
                                    <span className="text-muted-foreground">
                                        {col.name}
                                    </span>
                                    <span>{col.render(item)}</span>
                                </div>
                            ))}
                        </CardContent>
                    </Card>
                ))}
            </div>
        );
    }

    return (
        <Table>
            <TableHeader>
                <TableRow>
                    {columns.map((col) => (
                        <TableHead key={col.name}>{col.name}</TableHead>
                    ))}
                </TableRow>
            </TableHeader>
            <TableBody>
                {data.map((item, i) => (
                    <TableRow
                        key={i}
                        className={itemRoute ? "cursor-pointer" : ""}
                        onClick={
                            itemRoute
                                ? () => navigate(itemRoute(item))
                                : undefined
                        }
                    >
                        {columns.map((col) => (
                            <TableCell key={col.name}>
                                {col.render(item)}
                            </TableCell>
                        ))}
                    </TableRow>
                ))}
            </TableBody>
        </Table>
    );
}
