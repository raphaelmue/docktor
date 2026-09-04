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
import {ServiceStatusBadge} from "@/components/domain/stack/service-status-badge";
import {ServiceUpgradeDialog} from "./service-upgrade-dialog";

// Transitional states that block a new upgrade: the states stack-actions.tsx
// already treats as blocking (BACKING_UP, RESTORING, DEPLOYING), plus
// UPDATING and MIGRATING. This matches the server's authoritative
// TRANSITIONS.UPDATE allow-list in stack-status-machine.ts exactly (the
// complement of that allow-list across all StackStatus values) — the client
// gate exists only so the user isn't invited into a request the server's
// guardTransition would reject anyway.
const UPGRADE_BLOCKED_STATES = ["BACKING_UP", "RESTORING", "DEPLOYING", "UPDATING", "MIGRATING"];

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
    const isUpgradeBlocked = UPGRADE_BLOCKED_STATES.includes(stackStatus);

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
                                        <div className="flex flex-row flex-wrap items-center gap-2">
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
                                                    disabled={isUpgradeBlocked}
                                                    title={
                                                        isUpgradeBlocked
                                                            ? `Cannot upgrade while the stack is ${stackStatus.toLowerCase()}`
                                                            : `Upgrade ${svc.serviceName}`
                                                    }
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
