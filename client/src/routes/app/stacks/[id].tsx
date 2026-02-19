import {useEffect, useState} from "react";
import {useNavigate, useParams} from "react-router";
import {useStack} from "@/hooks/use-stack";
import {
    deleteStack,
    deployStack,
    getComposeContent,
    getEnvContent,
    restartStack,
    stopStack,
    updateStack,
} from "@/lib/stacks-api";
import {StackStatusBadge} from "@/components/domain/stack/stack-status-badge";
import {Button} from "@/components/ui/button";
import {Card, CardContent, CardHeader, CardTitle} from "@/components/ui/card";
import {Textarea} from "@/components/ui/textarea";
import {Table, TableBody, TableCell, TableHead, TableHeader, TableRow,} from "@/components/ui/table";
import {Tabs, TabsContent, TabsList, TabsTrigger} from "@/components/ui/tabs";
import {Alert, AlertDescription} from "@/components/ui/alert";
import {AlertTriangle, Play, RotateCcw, Save, Square, Trash2,} from "lucide-react";

export default function StackDetailPage() {
    const {id} = useParams<{id: string}>();
    const navigate = useNavigate();
    const {stack, loading, error, refetch} = useStack(id!);

    const [composeContent, setComposeContent] = useState("");
    const [envContent, setEnvContent] = useState("");
    const [composeDirty, setComposeDirty] = useState(false);
    const [envDirty, setEnvDirty] = useState(false);
    const [actionLoading, setActionLoading] = useState(false);
    const [actionError, setActionError] = useState("");

    useEffect(() => {
        if (!id) return;
        getComposeContent(id).then((r) => setComposeContent(r.content));
        getEnvContent(id).then((r) => setEnvContent(r.content));
    }, [id]);

    if (loading) {
        return (
            <div className="p-6">
                <p className="text-muted-foreground">Loading...</p>
            </div>
        );
    }

    if (error || !stack) {
        return (
            <div className="p-6">
                <Alert variant="destructive">
                    <AlertDescription>{error ?? "Stack not found"}</AlertDescription>
                </Alert>
            </div>
        );
    }

    async function handleAction(action: () => Promise<unknown>) {
        setActionError("");
        setActionLoading(true);
        try {
            await action();
            await refetch();
        } catch (err: any) {
            setActionError(err.message ?? "Action failed");
        } finally {
            setActionLoading(false);
        }
    }

    async function handleSaveCompose() {
        await handleAction(async () => {
            await updateStack(id!, {composeContent});
            setComposeDirty(false);
        });
    }

    async function handleSaveEnv() {
        await handleAction(async () => {
            await updateStack(id!, {envContent});
            setEnvDirty(false);
        });
    }

    async function handleDelete() {
        if (!confirm(`Delete stack "${stack!.displayName}"?`)) return;
        await handleAction(async () => {
            await deleteStack(id!);
            navigate("/stacks");
        });
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
    const canDelete = ["DRAFT", "STOPPED", "ERROR"].includes(status);

    return (
        <div className="p-6 space-y-6">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-bold">
                        {stack.displayName}
                    </h1>
                    {stack.description && (
                        <p className="text-muted-foreground">
                            {stack.description}
                        </p>
                    )}
                </div>
                <div className="flex items-center gap-2">
                    <StackStatusBadge status={status} />
                    {canDeploy && (
                        <Button
                            size="sm"
                            disabled={actionLoading}
                            onClick={() =>
                                handleAction(() => deployStack(id!))
                            }
                        >
                            <Play className="h-4 w-4 mr-1" />
                            Deploy
                        </Button>
                    )}
                    {canStop && (
                        <Button
                            size="sm"
                            variant="outline"
                            disabled={actionLoading}
                            onClick={() =>
                                handleAction(() => stopStack(id!))
                            }
                        >
                            <Square className="h-4 w-4 mr-1" />
                            Stop
                        </Button>
                    )}
                    {canRestart && (
                        <Button
                            size="sm"
                            variant="outline"
                            disabled={actionLoading}
                            onClick={() =>
                                handleAction(() => restartStack(id!))
                            }
                        >
                            <RotateCcw className="h-4 w-4 mr-1" />
                            Restart
                        </Button>
                    )}
                    {canDelete && (
                        <Button
                            size="sm"
                            variant="destructive"
                            disabled={actionLoading}
                            onClick={handleDelete}
                        >
                            <Trash2 className="h-4 w-4 mr-1" />
                            Delete
                        </Button>
                    )}
                </div>
            </div>

            {actionError && (
                <Alert variant="destructive">
                    <AlertTriangle className="h-4 w-4" />
                    <AlertDescription>{actionError}</AlertDescription>
                </Alert>
            )}

            {stack.configChanged && (
                <Alert>
                    <AlertTriangle className="h-4 w-4" />
                    <AlertDescription>
                        Configuration has changed since last deployment.
                        Re-deploy to apply changes.
                    </AlertDescription>
                </Alert>
            )}

            <Tabs defaultValue="overview">
                <TabsList>
                    <TabsTrigger value="overview">Overview</TabsTrigger>
                    <TabsTrigger value="compose">Compose</TabsTrigger>
                    <TabsTrigger value="environment">Environment</TabsTrigger>
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
                                            <TableHead>Image</TableHead>
                                            <TableHead>Tag</TableHead>
                                            <TableHead>Ports</TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {stack.services.map((svc) => (
                                            <TableRow key={svc.id}>
                                                <TableCell className="font-medium">
                                                    {svc.serviceName}
                                                </TableCell>
                                                <TableCell>
                                                    {svc.image}
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
                                                <TableCell className="text-sm text-muted-foreground max-w-xs truncate">
                                                    {dep.errorMessage ?? "-"}
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
                            <CardTitle>Status Log</CardTitle>
                        </CardHeader>
                        <CardContent>
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
                                <Save className="h-4 w-4 mr-1" />
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
                                <Save className="h-4 w-4 mr-1" />
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
            </Tabs>
        </div>
    );
}
