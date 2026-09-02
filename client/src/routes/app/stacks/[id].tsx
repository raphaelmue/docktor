import {useEffect, useState} from "react";
import {Link, useNavigate, useParams} from "react-router";
import {toast} from "sonner";
import {useStack} from "@/hooks/use-stack";
import {
    getComposeContent,
    getEnvContent,
    updateStack,
} from "@/lib/stacks-api";
import {StackStatusBadge} from "@/components/domain/stack/stack-status-badge";
import {LogViewer} from "@/components/domain/stack/log-viewer";
import {Card, CardContent, CardHeader, CardTitle} from "@/components/ui/card";
import {Button} from "@/components/ui/button";
import {Textarea} from "@/components/ui/textarea";
import {Table, TableBody, TableCell, TableHead, TableHeader, TableRow,} from "@/components/ui/table";
import {Tabs, TabsContent, TabsList, TabsTrigger} from "@/components/ui/tabs";
import {Alert, AlertDescription} from "@/components/ui/alert";
import {AlertTriangle, RefreshCw, Save,} from "lucide-react";
import {cn} from "@/lib/utils";
import {
    Breadcrumb,
    BreadcrumbItem,
    BreadcrumbLink,
    BreadcrumbList,
    BreadcrumbPage,
    BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import {Page, PageActions, PageContent, PageDescription, PageHeader, PageTitle} from "@/components/common/layout/page";
import {ScrollArea} from "@/components/ui/scroll-area";
import {StackActions} from "./components/stack-actions";
import {BackupsTab} from "./components/backups-tab";
import {ServicesTab} from "./components/services-tab";
import {EventLogCard} from "./components/event-log-card";
import {StatusLogCard} from "./components/status-log-card";

export default function StackDetailPage() {
    const {id = "", tab} = useParams<{ id: string; tab?: string }>();
    const navigate = useNavigate();
    const {stack, loading, isRefreshing, error, refetch} = useStack(id);

    const VALID_TABS = ["overview", "compose", "environment", "logs", "backups"] as const;
    type Tab = typeof VALID_TABS[number];
    const activeTab: Tab = VALID_TABS.includes(tab as Tab) ? (tab as Tab) : "overview";

    const [composeContent, setComposeContent] = useState("");
    const [envContent, setEnvContent] = useState("");
    const [composeDirty, setComposeDirty] = useState(false);
    const [envDirty, setEnvDirty] = useState(false);
    const [logsService, setLogsService] = useState<string | undefined>(undefined);

    useEffect(() => {
        if (!id) return;
        // Only reload compose/env content if user hasn't made local changes
        if (!composeDirty) {
            getComposeContent(id).then((r) => setComposeContent(r.content));
        }
        if (!envDirty) {
            getEnvContent(id).then((r) => setEnvContent(r.content));
        }
    }, [id, stack?.lastKnownHash, composeDirty, envDirty]);

    if (loading && !stack) {
        return (
            <Page>
                <PageHeader
                    breadcrumbs={
                        <Breadcrumb>
                            <BreadcrumbList>
                                <BreadcrumbItem>
                                    <BreadcrumbLink asChild>
                                        <Link to="/stacks">Stacks</Link>
                                    </BreadcrumbLink>
                                </BreadcrumbItem>
                                <BreadcrumbSeparator/>
                                <BreadcrumbItem>
                                    <BreadcrumbPage>Loading...</BreadcrumbPage>
                                </BreadcrumbItem>
                            </BreadcrumbList>
                        </Breadcrumb>
                    }
                >
                    <PageTitle>Loading...</PageTitle>
                </PageHeader>
                <PageContent>
                    <p className="text-muted-foreground">Loading...</p>
                </PageContent>
            </Page>
        );
    }

    if (error || !stack) {
        return (
            <Page>
                <PageHeader
                    breadcrumbs={
                        <Breadcrumb>
                            <BreadcrumbList>
                                <BreadcrumbItem>
                                    <BreadcrumbLink asChild>
                                        <Link to="/stacks">Stacks</Link>
                                    </BreadcrumbLink>
                                </BreadcrumbItem>
                                <BreadcrumbSeparator/>
                                <BreadcrumbItem>
                                    <BreadcrumbPage>Error</BreadcrumbPage>
                                </BreadcrumbItem>
                            </BreadcrumbList>
                        </Breadcrumb>
                    }
                >
                    <PageTitle>Error</PageTitle>
                </PageHeader>
                <PageContent>
                    <Alert variant="destructive">
                        <AlertDescription>{error ?? "Stack not found"}</AlertDescription>
                    </Alert>
                </PageContent>
            </Page>
        );
    }

    function handleSaveCompose() {
        toast.promise(
            (async () => {
                await updateStack(id, {composeContent});
                setComposeDirty(false);
                refetch();
            })(),
            {
                loading: "Saving compose...",
                success: "Save compose completed",
                error: (err: Error) => err?.message ?? "Save compose failed",
            },
        );
    }

    function handleSaveEnv() {
        toast.promise(
            (async () => {
                await updateStack(id, {envContent});
                setEnvDirty(false);
                refetch();
            })(),
            {
                loading: "Saving environment...",
                success: "Save environment completed",
                error: (err: Error) => err?.message ?? "Save environment failed",
            },
        );
    }

    const status = stack.status;

    const tabLabels: Record<Tab, string> = {
        overview: "Overview",
        compose: "Compose",
        environment: "Environment",
        logs: "Logs",
        backups: "Backups",
    };

    return (
        <Page>
            <PageHeader
                breadcrumbs={
                    <Breadcrumb>
                        <BreadcrumbList>
                            <BreadcrumbItem>
                                <BreadcrumbLink asChild>
                                    <Link to="/stacks">Stacks</Link>
                                </BreadcrumbLink>
                            </BreadcrumbItem>
                            <BreadcrumbSeparator/>
                            <BreadcrumbItem>
                                <BreadcrumbLink asChild>
                                    <Link to={`/stacks/${id}${activeTab !== 'overview' ? `?tab=${activeTab}` : ''}`}>{stack.displayName}</Link>
                                </BreadcrumbLink>
                            </BreadcrumbItem>
                            <BreadcrumbSeparator/>
                            <BreadcrumbItem>
                                <BreadcrumbPage>{tabLabels[activeTab]}</BreadcrumbPage>
                            </BreadcrumbItem>
                        </BreadcrumbList>
                    </Breadcrumb>
                }
            >
                <div>
                    <PageTitle>{stack.displayName}</PageTitle>
                    {stack.description && (
                        <PageDescription>{stack.description}</PageDescription>
                    )}
                </div>
                <PageActions>
                    <span
                        className={cn(
                            "flex items-center gap-1 text-xs text-muted-foreground transition-opacity",
                            isRefreshing ? "opacity-100" : "opacity-0",
                        )}
                        aria-hidden={!isRefreshing}
                    >
                        <RefreshCw className="h-3 w-3 animate-spin"/>
                        Refreshing
                    </span>
                    <StackStatusBadge status={status}/>
                    <StackActions
                        stackId={id}
                        stackName={stack.displayName}
                        status={status}
                        onAction={refetch}
                    />
                </PageActions>
            </PageHeader>

            <PageContent>
                {stack.configError && (
                    <Alert variant="destructive">
                        <AlertTriangle className="h-4 w-4"/>
                        <AlertDescription>
                            Configuration file has an error: {stack.configError}
                        </AlertDescription>
                    </Alert>
                )}

                {stack.configChanged && (
                    <Alert className="bg-yellow-100 text-yellow-800 border-yellow-200 dark:bg-yellow-900 dark:text-yellow-200 dark:border-yellow-800">
                        <AlertTriangle className="h-4 w-4"/>
                        <AlertDescription className="text-yellow-800 dark:text-yellow-200">
                            Configuration has changed since last deployment.
                            Re-deploy to apply changes.
                        </AlertDescription>
                    </Alert>
                )}

                <Tabs value={activeTab} onValueChange={(v) => navigate(`/stacks/${id}/${v}`)}>
                    <TabsList>
                        <TabsTrigger value="overview">Overview</TabsTrigger>
                        <TabsTrigger value="compose">Compose</TabsTrigger>
                        <TabsTrigger value="environment">Environment</TabsTrigger>
                        <TabsTrigger value="logs">Logs</TabsTrigger>
                        <TabsTrigger value="backups">Backups</TabsTrigger>
                    </TabsList>

                    <TabsContent value="overview" className="space-y-4 mt-4">
                        <ServicesTab
                            services={stack.services}
                            stackId={id}
                            stackStatus={status}
                            onViewLogs={(serviceName) => {
                                setLogsService(serviceName);
                                navigate(`/stacks/${id}/logs`);
                            }}
                            onUpgraded={refetch}
                        />

                        <Card>
                            <CardHeader>
                                <CardTitle>Recent Deployments</CardTitle>
                            </CardHeader>
                            <CardContent>
                                <ScrollArea className={"h-64"}>
                                    {stack.deployments.length === 0 ? (
                                        <p className="text-muted-foreground">
                                            No deployments yet
                                        </p>
                                    ) : (
                                        <Table>
                                            <TableHeader>
                                                <TableRow>
                                                    <TableHead>Date</TableHead>
                                                    <TableHead>Status</TableHead>
                                                    <TableHead>Error</TableHead>
                                                </TableRow>
                                            </TableHeader>
                                            <TableBody>
                                                {stack.deployments.map((dep) => (
                                                    <TableRow key={dep.id}>
                                                        <TableCell>
                                                            {new Date(
                                                                dep.deployedAt,
                                                            ).toLocaleString()}
                                                        </TableCell>
                                                        <TableCell>
                                                            {dep.success ? (
                                                                <span className="text-green-600">
                                                                Success
                                                            </span>
                                                            ) : (
                                                                <span className="text-red-600">
                                                                Failed
                                                            </span>
                                                            )}
                                                        </TableCell>
                                                        <TableCell
                                                            className="text-sm text-muted-foreground max-w-xs truncate">
                                                            {dep.errorMessage ?? "-"}
                                                        </TableCell>
                                                    </TableRow>
                                                ))}
                                            </TableBody>
                                        </Table>
                                    )}
                                </ScrollArea>
                            </CardContent>
                        </Card>

                        <StatusLogCard statusLogs={stack.statusLogs}/>

                        <EventLogCard stackId={id}/>
                    </TabsContent>

                    <TabsContent value="compose" className="space-y-4 mt-4">
                        <Card>
                            <CardHeader className="flex flex-row items-center justify-between">
                                <CardTitle>docker-compose.yml</CardTitle>
                                <Button
                                    size="sm"
                                    disabled={!composeDirty}
                                    onClick={handleSaveCompose}
                                >
                                    <Save className="h-4 w-4 mr-1"/>
                                    Save
                                </Button>
                            </CardHeader>
                            <CardContent>
                                <Textarea
                                    value={composeContent}
                                    onChange={(e) => {
                                        setComposeContent(e.target.value);
                                        setComposeDirty(true);
                                    }}
                                    className="font-mono text-sm min-h-[400px]"
                                />
                            </CardContent>
                        </Card>
                    </TabsContent>

                    <TabsContent value="environment" className="space-y-4 mt-4">
                        <Card>
                            <CardHeader className="flex flex-row items-center justify-between">
                                <CardTitle>.env</CardTitle>
                                <Button
                                    size="sm"
                                    disabled={!envDirty}
                                    onClick={handleSaveEnv}
                                >
                                    <Save className="h-4 w-4 mr-1"/>
                                    Save
                                </Button>
                            </CardHeader>
                            <CardContent>
                                <Textarea
                                    value={envContent}
                                    onChange={(e) => {
                                        setEnvContent(e.target.value);
                                        setEnvDirty(true);
                                    }}
                                    className="font-mono text-sm min-h-[300px]"
                                />
                            </CardContent>
                        </Card>
                    </TabsContent>

                    <TabsContent value="logs" className="mt-4 w-full max-w-full overflow-hidden">
                        <LogViewer
                            stackId={id}
                            serviceNames={stack.services.map((s) => s.serviceName)}
                            initialService={logsService}
                        />
                    </TabsContent>

                    <TabsContent value="backups" className="mt-4">
                        <BackupsTab
                            stackId={id}
                            stackName={stack.displayName}
                            stackStatus={status}
                        />
                    </TabsContent>
                </Tabs>
            </PageContent>
        </Page>
    );
}
