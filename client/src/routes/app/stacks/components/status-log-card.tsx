import {Card, CardContent, CardDescription, CardHeader, CardTitle} from "@/components/ui/card";
import {ScrollArea} from "@/components/ui/scroll-area";
import type {StackDetail} from "@/lib/stacks-api";

export interface StatusLogCardProps {
    readonly statusLogs: StackDetail["statusLogs"];
}

export function StatusLogCard({statusLogs}: Readonly<StatusLogCardProps>) {
    return (
        <Card>
            <CardHeader>
                <CardTitle role="heading" aria-level={2}>Status Log</CardTitle>
                <CardDescription>The stack's status transitions</CardDescription>
            </CardHeader>
            <CardContent>
                <ScrollArea className={"h-64"}>
                    {statusLogs.length === 0 ? (
                        <p className="text-muted-foreground">
                            No status changes
                        </p>
                    ) : (
                        <div className="space-y-2">
                            {statusLogs.map((log) => (
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
    );
}
