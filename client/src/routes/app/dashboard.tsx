import {Link} from "react-router";
import {Plus, Layers, Play, Square, AlertTriangle} from "lucide-react";
import {Button} from "@/components/ui/button";
import {Card, CardContent, CardHeader, CardTitle} from "@/components/ui/card";
import {StackStatusBadge} from "@/components/stack-status-badge";
import {useStacks} from "@/hooks/use-stacks";

export default function Dashboard() {
    const {stacks, loading} = useStacks();

    const total = stacks.length;
    const running = stacks.filter(
        (s) => s.status === "RUNNING" || s.status === "HEALTHY",
    ).length;
    const stopped = stacks.filter((s) => s.status === "STOPPED").length;
    const errors = stacks.filter(
        (s) => s.status === "ERROR" || s.status === "UNHEALTHY",
    ).length;

    const recentStacks = stacks.slice(0, 5);

    return (
        <div className="p-6 space-y-6">
            <div className="flex items-center justify-between">
                <h1 className="text-2xl font-bold">Dashboard</h1>
                <Button asChild>
                    <Link to="/stacks/create">
                        <Plus className="h-4 w-4 mr-2" />
                        Create Stack
                    </Link>
                </Button>
            </div>

            <div className="grid gap-4 md:grid-cols-4">
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between pb-2">
                        <CardTitle className="text-sm font-medium">
                            Total Stacks
                        </CardTitle>
                        <Layers className="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">
                            {loading ? "-" : total}
                        </div>
                    </CardContent>
                </Card>
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between pb-2">
                        <CardTitle className="text-sm font-medium">
                            Running
                        </CardTitle>
                        <Play className="h-4 w-4 text-green-600" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold text-green-600">
                            {loading ? "-" : running}
                        </div>
                    </CardContent>
                </Card>
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between pb-2">
                        <CardTitle className="text-sm font-medium">
                            Stopped
                        </CardTitle>
                        <Square className="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">
                            {loading ? "-" : stopped}
                        </div>
                    </CardContent>
                </Card>
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between pb-2">
                        <CardTitle className="text-sm font-medium">
                            Errors
                        </CardTitle>
                        <AlertTriangle className="h-4 w-4 text-red-600" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold text-red-600">
                            {loading ? "-" : errors}
                        </div>
                    </CardContent>
                </Card>
            </div>

            <Card>
                <CardHeader>
                    <CardTitle>Recent Stacks</CardTitle>
                </CardHeader>
                <CardContent>
                    {loading ? (
                        <p className="text-muted-foreground">Loading...</p>
                    ) : recentStacks.length === 0 ? (
                        <div className="text-center py-8 text-muted-foreground">
                            <p>No stacks yet.</p>
                            <Button asChild variant="link">
                                <Link to="/stacks/create">
                                    Create your first stack
                                </Link>
                            </Button>
                        </div>
                    ) : (
                        <div className="space-y-3">
                            {recentStacks.map((stack) => (
                                <Link
                                    key={stack.id}
                                    to={`/stacks/${stack.id}`}
                                    className="flex items-center justify-between p-3 rounded-md border hover:bg-accent transition-colors"
                                >
                                    <div>
                                        <p className="font-medium">
                                            {stack.displayName}
                                        </p>
                                        <p className="text-sm text-muted-foreground">
                                            {stack.services.length} service
                                            {stack.services.length !== 1
                                                ? "s"
                                                : ""}
                                        </p>
                                    </div>
                                    <StackStatusBadge status={stack.status} />
                                </Link>
                            ))}
                            {stacks.length > 5 && (
                                <Button asChild variant="link" className="w-full">
                                    <Link to="/stacks">View all stacks</Link>
                                </Button>
                            )}
                        </div>
                    )}
                </CardContent>
            </Card>
        </div>
    );
}
