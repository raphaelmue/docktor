import {useState} from "react";
import {ArrowUpCircle, FileText} from "lucide-react";
import {Button} from "@/components/ui/button";
import {Card, CardContent, CardHeader, CardTitle} from "@/components/ui/card";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import type {Service} from "@/lib/stacks-api";
import {ServiceUpgradeDialog} from "./service-upgrade-dialog";

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

export interface ServicesTabProps {
    readonly services: Service[];
    readonly stackId: string;
    readonly stackStatus: string;
    readonly onViewLogs: (serviceName: string) => void;
    readonly onUpgraded: () => void;
}

export function ServicesTab({
    services,
    stackId,
    stackStatus,
    onViewLogs,
    onUpgraded,
}: Readonly<ServicesTabProps>) {
    const [upgradeTarget, setUpgradeTarget] = useState<Service | null>(null);

    return (
        <Card>
            <CardHeader>
                <CardTitle>Services</CardTitle>
            </CardHeader>
            <CardContent>
                {services.length === 0 ? (
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
                            {services.map((svc) => (
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
                                                    update available{svc.latestTag ? ` → ${svc.latestTag}` : ""}
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
                                        <div className="flex items-center gap-1">
                                            {svc.updateAvailable && (
                                                <Button
                                                    size="sm"
                                                    variant="ghost"
                                                    title={`Upgrade ${svc.serviceName}`}
                                                    onClick={() => setUpgradeTarget(svc)}
                                                >
                                                    <ArrowUpCircle className="h-4 w-4"/>
                                                </Button>
                                            )}
                                            <Button
                                                size="sm"
                                                variant="ghost"
                                                title={`View logs for ${svc.serviceName}`}
                                                onClick={() => onViewLogs(svc.serviceName)}
                                            >
                                                <FileText className="h-4 w-4"/>
                                            </Button>
                                        </div>
                                    </TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                )}
            </CardContent>

            {upgradeTarget && (
                <ServiceUpgradeDialog
                    stackId={stackId}
                    serviceName={upgradeTarget.serviceName}
                    currentTag={upgradeTarget.imageTag ?? "latest"}
                    open={upgradeTarget !== null}
                    onOpenChange={(open) => {
                        if (!open) setUpgradeTarget(null);
                    }}
                    onUpgraded={onUpgraded}
                />
            )}
        </Card>
    );
}
