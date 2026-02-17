import {Link} from "react-router";
import {Plus} from "lucide-react";
import {Button} from "@/components/ui/button";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import {StackStatusBadge} from "@/components/stack-status-badge";
import {useStacks} from "@/hooks/use-stacks";

export default function StacksPage() {
    const {stacks, loading, error} = useStacks();

    return (
        <div className="p-6 space-y-6">
            <div className="flex items-center justify-between">
                <h1 className="text-2xl font-bold">Stacks</h1>
                <Button asChild>
                    <Link to="/stacks/create">
                        <Plus className="h-4 w-4 mr-2" />
                        Create Stack
                    </Link>
                </Button>
            </div>

            {error && (
                <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
                    {error}
                </div>
            )}

            {loading ? (
                <p className="text-muted-foreground">Loading stacks...</p>
            ) : stacks.length === 0 ? (
                <div className="text-center py-16 text-muted-foreground">
                    <p className="text-lg">No stacks yet</p>
                    <p className="mt-1">
                        Create your first stack to get started.
                    </p>
                    <Button asChild className="mt-4">
                        <Link to="/stacks/create">
                            <Plus className="h-4 w-4 mr-2" />
                            Create Stack
                        </Link>
                    </Button>
                </div>
            ) : (
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead>Name</TableHead>
                            <TableHead>Status</TableHead>
                            <TableHead>Services</TableHead>
                            <TableHead>Created</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {stacks.map((stack) => (
                            <TableRow key={stack.id}>
                                <TableCell>
                                    <Link
                                        to={`/stacks/${stack.id}`}
                                        className="font-medium hover:underline"
                                    >
                                        {stack.displayName}
                                    </Link>
                                    {stack.description && (
                                        <p className="text-sm text-muted-foreground">
                                            {stack.description}
                                        </p>
                                    )}
                                </TableCell>
                                <TableCell>
                                    <StackStatusBadge status={stack.status} />
                                </TableCell>
                                <TableCell>
                                    {stack.services.length}
                                </TableCell>
                                <TableCell className="text-muted-foreground">
                                    {new Date(
                                        stack.createdAt,
                                    ).toLocaleDateString()}
                                </TableCell>
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
            )}
        </div>
    );
}
