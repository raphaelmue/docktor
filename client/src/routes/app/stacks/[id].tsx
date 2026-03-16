import {useEffect, useState} from "react";
import {Link, useNavigate, useParams} from "react-router";
import {toast} from "sonner";
import {useStack} from "@/hooks/use-stack";
import {
    deleteStack,
    deployStack,
    getComposeContent,
    getEnvContent,
    restartStack,
    stopStack,
    updateImages,
    updateStack,
} from "@/lib/stacks-api";
import {StackStatusBadge} from "@/components/domain/stack/stack-status-badge";
import {LogViewer} from "@/components/domain/stack/log-viewer";
import {Button} from "@/components/ui/button";
import {Card, CardContent, CardHeader, CardTitle} from "@/components/ui/card";
import {Textarea} from "@/components/ui/textarea";
import {Table, TableBody, TableCell, TableHead, TableHeader, TableRow,} from "@/components/ui/table";
import {Tabs, TabsContent, TabsList, TabsTrigger} from "@/components/ui/tabs";
import {Alert, AlertDescription} from "@/components/ui/alert";
import {AlertTriangle, FileText, Play, RefreshCw, RotateCcw, Save, Square, Trash2,} from "lucide-react";
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

interface ServiceStatusBadgeProps {
    containerState: string | null;
    healthStatus: string | null;
}

function ServiceStatusBadge({containerState, healthStatus}: ServiceStatusBadgeProps) {
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

export default function StackDetailPage() {
    const {id = ""} = useParams<{ id: string }>();
    const navigate = useNavigate();
    const {stack, loading, error, refetch} = useStack(id);

    const [composeContent, setComposeContent] = useState("");
    const [envContent, setEnvContent] = useState("");
    const [composeDirty, setComposeDirty] = useState(false);
    const [envDirty, setEnvDirty] = useState(false);
    const [actionLoading, setActionLoading] = useState(false);
    const [activeTab, setActiveTab] = useState("overview");
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

    if (loading) {
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

    function handleAction(action: () => Promise<unknown>, label: string) {
        setActionLoading(true);
        toast.promise(
            (async () => {
                try {
                    await action();
                    await refetch();
                } finally {
                    setActionLoading(false);
                }
            })(),
            {
                loading: `${label}...`,
                success: `${label} completed`,
                error: (err) => err?.message ?? `${label} failed`,
            },
        );
    }

    function handleSaveCompose() {
        handleAction(async () => {
            await updateStack(id, {composeContent});
            setComposeDirty(false);
        }, "Save compose");
    }

    function handleSaveEnv() {
        handleAction(async () => {
            await updateStack(id, {envContent});
            setEnvDirty(false);
        }, "Save environment");
    }

    function handleDelete() {
        if (!stack || !confirm(`Delete stack "${stack.displayName}"?`)) return;
        handleAction(async () => {
            await deleteStack(id);
            navigate("/stacks");
        }, "Delete");
    }

    const status = stack.status;
    const canDeploy = [
        "DRAFT",
        "STOPPED",
        "ERROR",
        "RUNNING",
        "HEALTHY",
        "UNHEALTHY",
    ].includes(status);
    const canStop = ["RUNNING", "HEALTHY", "UNHEALTHY", "ERROR"].includes(
        status,
    );
    const canRestart = ["RUNNING", "HEALTHY", "UNHEALTHY"].includes(status);
    const canUpdate = ["RUNNING", "HEALTHY", "UNHEALTHY", "STOPPED", "ERROR"].includes(status);
    const canDelete = ["DRAFT", "STOPPED", "ERROR"].includes(status);

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
                                <BreadcrumbPage>{stack.displayName}</BreadcrumbPage>
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
                    <StackStatusBadge status={status}/>
                    {canDeploy && (
                        <Button
                            size="sm"
                            disabled={actionLoading}
                            onClick={() =>
                                handleAction(() => deployStack(id), "Deploy")
                            }
                        >
                            <Play className="h-4 w-4 mr-1"/>
                            Deploy
                        </Button>
                    )}
                    {canStop && (
                        <Button
                            size="sm"
                            variant="outline"
                            disabled={actionLoading}
                            onClick={() =>
                                handleAction(() => stopStack(id), "Stop")
                            }
                        >
                            <Square className="h-4 w-4 mr-1"/>
                            Stop
                        </Button>
                    )}
                    {canRestart && (
                        <Button
                            size="sm"
                            variant="outline"
                            disabled={actionLoading}
                            onClick={() =>
                                handleAction(() => restartStack(id), "Restart")
                            }
                        >
                            <RotateCcw className="h-4 w-4 mr-1"/>
                            Restart
                        </Button>
                    )}
                    {canUpdate && (
                        <Button
                            size="sm"
                            variant="outline"
                            disabled={actionLoading}
                            onClick={() =>
                                handleAction(() => updateImages(id), "Update images")
                            }
                        >
                            <RefreshCw className="h-4 w-4 mr-1"/>
                            Update Images
                        </Button>
                    )}
                    {canDelete && (
                        <Button
                            size="sm"
                            variant="destructive"
                            disabled={actionLoading}
                            onClick={handleDelete}
                        >
                            <Trash2 className="h-4 w-4 mr-1"/>
                            Delete
                        </Button>
                    )}
                </PageActions>
            </PageHeader>

            <PageContent>
                {stack.configChanged && (
                    <Alert>
                        <AlertTriangle className="h-4 w-4"/>
                        <AlertDescription>
                            Configuration has changed since last deployment.
                            Re-deploy to apply changes.
                        </AlertDescription>
                    </Alert>
                )}

                <Tabs value={activeTab} onValueChange={setActiveTab}>
                    <TabsList>
                        <TabsTrigger value="overview">Overview</TabsTrigger>
                        <TabsTrigger value="compose">Compose</TabsTrigger>
                        <TabsTrigger value="environment">Environment</TabsTrigger>
                        <TabsTrigger value="logs">Logs</TabsTrigger>
                    </TabsList>

                    <TabsContent value="overview" className="space-y-4 mt-4">
                        <Card>
                            <CardHeader>
                                <CardTitle>Services</CardTitle>
                            </CardHeader>
                            <CardContent>
                                {stack.services.length === 0 ? (
                                    <p className="text-muted-foreground">
                                        No services defined
                                    </p>
                                ) : (
                                    <Table>
                                        <TableHeader>
                                            <TableRow>
                                                <TableHead>Name</TableHead>
                                                <TableHead>Status</TableHead>
                                                <TableHead>Image</TableHead>
                                                <TableHead>Tag</TableHead>
                                                <TableHead>Ports</TableHead>
                                                <TableHead></TableHead>
                                            </TableRow>
                                        </TableHeader>
                                        <TableBody>
                                            {stack.services.map((svc) => (
                                                <TableRow key={svc.id}>
                                                    <TableCell className="font-medium">
                                                        {svc.serviceName}
                                                    </TableCell>
                                                    <TableCell>
                                                        <ServiceStatusBadge
                                                            containerState={svc.containerState}
                                                            healthStatus={svc.healthStatus}
                                                        />
                                                    </TableCell>
                                                    <TableCell>
                                                        <div className="flex flex-col gap-1">
                                                            <span>{svc.image}</span>
                                                            {svc.updateAvailable && (
                                                                <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200">
                                                                    update available{svc.latestTag ? ` \u2192 ${svc.latestTag}` : ""}
                                                                </span>
                                                            )}
                                                        </div>
                                                    </TableCell>
                                                    <TableCell>
                                                        {svc.imageTag ?? "latest"}
                                                    </TableCell>
                                                    <TableCell className="text-sm text-muted-foreground">
                                                        {svc.ports
                                                            ? JSON.parse(
                                                                svc.ports,
                                                            )
                                                                .map(
                                                                    (p: {
                                                                        host: number;
                                                                        container: number;
                                                                    }) =>
                                                                        `${p.host}:${p.container}`,
                                                                )
                                                                .join(", ")
                                                            : "-"}
                                                    </TableCell>
                                                    <TableCell>
                                                        <Button
                                                            size="sm"
                                                            variant="ghost"
                                                            title={`View logs for ${svc.serviceName}`}
                                                            onClick={() => {
                                                                setLogsService(svc.serviceName);
                                                                setActiveTab("logs");
                                                            }}
                                                        >
                                                            <FileText className="h-4 w-4"/>
                                                        </Button>
                                                    </TableCell>
                                                </TableRow>
                                            ))}
                                        </TableBody>
                                    </Table>
                                )}
                            </CardContent>
                        </Card>

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

                        <Card>
                            <CardHeader>
                                <CardTitle>Status Log</CardTitle>
                            </CardHeader>
                            <CardContent>
                                <ScrollArea className={"h-64"}>
                                    {stack.statusLogs.length === 0 ? (
                                        <p className="text-muted-foreground">
                                            No status changes
                                        </p>
                                    ) : (
                                        <div className="space-y-2">
                                            {stack.statusLogs.map((log) => (
                                                <div
                                                    key={log.id}
                                                    className="flex items-start gap-3 text-sm"
                                                >
                                                <span className="text-muted-foreground whitespace-nowrap">
                                                    {new Date(
                                                        log.createdAt,
                                                    ).toLocaleString()}
                                                </span>
                                                    <span>
                                                    {log.fromStatus && (
                                                        <>
                                                            {log.fromStatus} →{" "}
                                                        </>
                                                    )}
                                                        {log.toStatus}
                                                </span>
                                                    {log.message && (
                                                        <span className="text-muted-foreground">
                                                        — {log.message}
                                                    </span>
                                                    )}
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </ScrollArea>
                            </CardContent>
                        </Card>
                    </TabsContent>

                    <TabsContent value="compose" className="space-y-4 mt-4">
                        <Card>
                            <CardHeader className="flex flex-row items-center justify-between">
                                <CardTitle>docker-compose.yml</CardTitle>
                                <Button
                                    size="sm"
                                    disabled={!composeDirty || actionLoading}
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
                                    disabled={!envDirty || actionLoading}
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
                </Tabs>
            </PageContent>
        </Page>
    );
}
