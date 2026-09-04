import {useEffect, useState} from "react";
import {Link} from "react-router";
import {useForm, type Resolver} from "react-hook-form";
import {standardSchemaResolver} from "@hookform/resolvers/standard-schema";
import {toast} from "sonner";
import {AlertTriangle, Trash2} from "lucide-react";
import {assignDomainSchema, type AssignDomainInput} from "@docktor/shared";

import {
    assignDomain,
    getProxyConfigs,
    getProxySettings,
    removeDomain,
    type ProxyConfig,
} from "@/lib/proxy-api";
import type {Service} from "@/lib/stacks-api";
import {useProxyStatus} from "@/hooks/use-proxy-status";
import {CertStatusBadge} from "@/components/domain/stack/cert-status-badge";
import {Card, CardContent, CardFooter, CardHeader, CardTitle} from "@/components/ui/card";
import {Button} from "@/components/ui/button";
import {Input} from "@/components/ui/input";
import {Label} from "@/components/ui/label";
import {Switch} from "@/components/ui/switch";
import {Select, SelectContent, SelectItem, SelectTrigger, SelectValue} from "@/components/ui/select";
import {Table, TableBody, TableCell, TableHead, TableHeader, TableRow} from "@/components/ui/table";
import {Skeleton} from "@/components/ui/skeleton";
import {Alert, AlertDescription} from "@/components/ui/alert";
import {Form, FormControl, FormField, FormItem, FormLabel, FormMessage} from "@/components/ui/form";
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from "@/components/ui/alert-dialog";

interface ProxyTabProps {
    readonly stackId: string;
    readonly services: Service[];
}

interface ServicePortBinding {
    host: number;
    container: number;
}

function parsePorts(ports: string | null | undefined): ServicePortBinding[] {
    if (!ports) return [];
    try {
        return JSON.parse(ports) as ServicePortBinding[];
    } catch {
        return [];
    }
}

export function ProxyTab({stackId, services}: Readonly<ProxyTabProps>) {
    const [configs, setConfigs] = useState<ProxyConfig[] | null>(null);
    const [deployed, setDeployed] = useState<boolean | null>(null);
    const [loading, setLoading] = useState(true);
    const [removeTarget, setRemoveTarget] = useState<ProxyConfig | null>(null);
    const [serviceName, setServiceName] = useState(services[0]?.serviceName ?? "");
    const {statuses} = useProxyStatus(stackId);

    const form = useForm<AssignDomainInput>({
        // Safe: assignDomainSchema's internalPort field uses z.coerce.number(),
        // so the resolver's pre-coercion input type doesn't structurally match
        // AssignDomainInput (the post-coercion output type) at the type level —
        // at runtime the resolver still coerces exactly to AssignDomainInput,
        // matching what the form actually submits. Mirrors notifications-step.tsx.
        resolver: standardSchemaResolver(assignDomainSchema) as Resolver<AssignDomainInput>,
        defaultValues: {domain: "", internalPort: 80, tlsEnabled: true},
    });

    useEffect(() => {
        let cancelled = false;

        async function load() {
            setLoading(true);
            try {
                const [cfgs, settings] = await Promise.all([
                    getProxyConfigs(stackId),
                    getProxySettings(),
                ]);
                if (cancelled) return;
                setConfigs(cfgs);
                setDeployed(settings.deployed);
            } catch {
                // silently fail — mirrors backup-config-card.tsx's load effect
            } finally {
                if (!cancelled) setLoading(false);
            }
        }

        void load();
        return () => {
            cancelled = true;
        };
    }, [stackId]);

    async function reload() {
        const cfgs = await getProxyConfigs(stackId);
        setConfigs(cfgs);
    }

    function handleAssign(data: AssignDomainInput) {
        if (!serviceName) return;
        toast.promise(assignDomain(stackId, serviceName, data).then(() => reload()), {
            loading: "Assigning domain...",
            success: "Domain assigned",
            error: (err: Error) => err?.message ?? "Assign domain failed",
        });
        form.reset({domain: "", internalPort: data.internalPort, tlsEnabled: data.tlsEnabled});
    }

    function handleRemove(target: ProxyConfig) {
        toast.promise(removeDomain(target.id).then(() => reload()), {
            loading: "Removing domain...",
            success: "Domain removed",
            error: (err: Error) => err?.message ?? "Remove domain failed",
        });
        setRemoveTarget(null);
    }

    if (loading || configs === null || deployed === null) {
        return (
            <Card>
                <CardHeader>
                    <CardTitle>Proxy</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                    <Skeleton className="h-24 w-full" />
                    <Skeleton className="h-9 w-full" />
                </CardContent>
            </Card>
        );
    }

    if (!deployed) {
        return (
            <Card>
                <CardHeader>
                    <CardTitle>Proxy stack not deployed</CardTitle>
                </CardHeader>
                <CardContent>
                    <p className="text-sm text-muted-foreground">
                        Deploy the managed proxy stack in Settings before assigning domains to services.
                    </p>
                </CardContent>
                <CardFooter>
                    <Button asChild variant="link" className="px-0">
                        <Link to="/settings/proxy">Go to Settings</Link>
                    </Button>
                </CardFooter>
            </Card>
        );
    }

    const configsByService = new Map<string, ProxyConfig[]>();
    for (const config of configs) {
        const rows = configsByService.get(config.serviceName) ?? [];
        rows.push(config);
        configsByService.set(config.serviceName, rows);
    }

    const selectedService = services.find((svc) => svc.serviceName === serviceName);
    const selectedServicePorts = parsePorts(selectedService?.ports);

    return (
        <div className="space-y-6">
            {configs.length === 0 ? (
                <Card>
                    <CardHeader>
                        <CardTitle>No domains configured</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <p className="text-sm text-muted-foreground">
                            Assign a domain to a service below to make it available at a custom URL with automatic
                            HTTPS.
                        </p>
                    </CardContent>
                </Card>
            ) : (
                <Card>
                    <CardHeader>
                        <CardTitle>Domains</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Domains</TableHead>
                                    <TableHead>Service</TableHead>
                                    <TableHead>Internal Port</TableHead>
                                    <TableHead>TLS</TableHead>
                                    <TableHead>Certificate</TableHead>
                                    <TableHead />
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {Array.from(configsByService.entries()).map(([svcName, rows]) => (
                                    <TableRow key={svcName}>
                                        <TableCell>
                                            <div className="flex flex-col gap-1">
                                                {rows.map((row) => (
                                                    <span
                                                        key={row.id}
                                                        className="max-w-xs truncate"
                                                        title={row.domain}
                                                    >
                                                        {row.domain}
                                                    </span>
                                                ))}
                                            </div>
                                        </TableCell>
                                        <TableCell>{svcName}</TableCell>
                                        <TableCell>{rows[0].internalPort}</TableCell>
                                        <TableCell>
                                            <div className="flex flex-col gap-1">
                                                {rows.map((row) => (
                                                    <span key={row.id}>{row.tlsEnabled ? "On" : "Off"}</span>
                                                ))}
                                            </div>
                                        </TableCell>
                                        <TableCell>
                                            <div className="flex flex-col gap-1">
                                                {rows.map((row) => {
                                                    const live = statuses[row.id];
                                                    return (
                                                        <CertStatusBadge
                                                            key={row.id}
                                                            status={live?.status ?? row.certStatus}
                                                            message={live?.message ?? row.certMessage}
                                                        />
                                                    );
                                                })}
                                            </div>
                                        </TableCell>
                                        <TableCell>
                                            <div className="flex flex-col gap-1">
                                                {rows.map((row) => (
                                                    <Button
                                                        key={row.id}
                                                        variant="ghost"
                                                        size="icon"
                                                        aria-label={`Remove ${row.domain}`}
                                                        onClick={() => setRemoveTarget(row)}
                                                    >
                                                        <Trash2 className="h-4 w-4" />
                                                    </Button>
                                                ))}
                                            </div>
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </CardContent>
                </Card>
            )}

            <Card>
                <CardHeader>
                    <CardTitle>Assign Domain</CardTitle>
                </CardHeader>
                <Form {...form}>
                    <form onSubmit={form.handleSubmit(handleAssign)}>
                        <CardContent className="space-y-4">
                            <div className="space-y-2">
                                <Label htmlFor="proxy-service" className="font-semibold">
                                    Service
                                </Label>
                                <Select value={serviceName} onValueChange={setServiceName}>
                                    <SelectTrigger id="proxy-service">
                                        <SelectValue placeholder="Select a service..." />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {services.map((svc) => (
                                            <SelectItem key={svc.id} value={svc.serviceName}>
                                                {svc.serviceName}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>

                            {selectedServicePorts.length > 0 && (
                                <Alert className="bg-yellow-100 text-yellow-800 border-yellow-200 dark:bg-yellow-900 dark:text-yellow-200 dark:border-yellow-800">
                                    <AlertTriangle className="h-4 w-4" />
                                    <AlertDescription className="text-yellow-800 dark:text-yellow-200">
                                        This service already publishes port {selectedServicePorts[0].host} directly
                                        to the host. Enabling the proxy will not remove that binding — both will
                                        remain active.
                                    </AlertDescription>
                                </Alert>
                            )}

                            <FormField
                                control={form.control}
                                name="domain"
                                render={({field}) => (
                                    <FormItem>
                                        <FormLabel className="font-semibold">Domain</FormLabel>
                                        <FormControl>
                                            <Input {...field} placeholder="cloud.example.com" />
                                        </FormControl>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />

                            <FormField
                                control={form.control}
                                name="internalPort"
                                render={({field}) => (
                                    <FormItem>
                                        <FormLabel className="font-semibold">Internal Port</FormLabel>
                                        <FormControl>
                                            <Input type="number" {...field} />
                                        </FormControl>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />

                            <FormField
                                control={form.control}
                                name="tlsEnabled"
                                render={({field}) => (
                                    <FormItem className="flex items-center gap-3 space-y-0">
                                        <FormControl>
                                            <Switch checked={field.value} onCheckedChange={field.onChange} />
                                        </FormControl>
                                        <FormLabel className="font-semibold">Enable TLS</FormLabel>
                                    </FormItem>
                                )}
                            />
                        </CardContent>
                        <CardFooter>
                            <Button type="submit" disabled={!serviceName}>
                                Assign Domain
                            </Button>
                        </CardFooter>
                    </form>
                </Form>
            </Card>

            <AlertDialog
                open={removeTarget !== null}
                onOpenChange={(open) => {
                    if (!open) setRemoveTarget(null);
                }}
            >
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Remove domain</AlertDialogTitle>
                        <AlertDialogDescription>
                            {removeTarget &&
                                `Remove ${removeTarget.domain} from ${removeTarget.serviceName}? The service will be redeployed without this domain's routing and TLS configuration.`}
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                            variant="destructive"
                            onClick={() => removeTarget && handleRemove(removeTarget)}
                        >
                            Remove
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    );
}
