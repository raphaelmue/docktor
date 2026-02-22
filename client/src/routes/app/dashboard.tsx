import {Link} from "react-router";
import {AlertTriangle, Layers, Play, Plus, Square} from "lucide-react";
import {Button} from "@/components/ui/button";
import {Card, CardContent, CardHeader, CardTitle} from "@/components/ui/card";
import {Breadcrumb, BreadcrumbItem, BreadcrumbList, BreadcrumbPage} from "@/components/ui/breadcrumb";
import {Page, PageActions, PageContent, PageHeader, PageTitle} from "@/components/common/layout/page";
import {StackList} from "@/components/domain/stack/stack-list";
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
        <Page>
            <PageHeader
                breadcrumbs={
                    <Breadcrumb>
                        <BreadcrumbList>
                            <BreadcrumbItem>
                                <BreadcrumbPage>Dashboard</BreadcrumbPage>
                            </BreadcrumbItem>
                        </BreadcrumbList>
                    </Breadcrumb>
                }
            >
                <PageTitle>Dashboard</PageTitle>
                <PageActions>
                    <Button asChild>
                        <Link to="/stacks/create">
                            <Plus className="h-4 w-4 mr-2" />
                            Create Stack
                        </Link>
                    </Button>
                </PageActions>
            </PageHeader>

            <PageContent>
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
                        <StackList
                            stacks={recentStacks}
                            loading={loading}
                            pagination={false}
                        />
                        {stacks.length > 5 && (
                            <Button asChild variant="link" className="w-full mt-4">
                                <Link to="/stacks">View all stacks</Link>
                            </Button>
                        )}
                    </CardContent>
                </Card>
            </PageContent>
        </Page>
    );
}
