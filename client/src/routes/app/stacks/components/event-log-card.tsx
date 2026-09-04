import {Card, CardContent, CardDescription, CardHeader, CardTitle} from "@/components/ui/card";
import {ScrollArea} from "@/components/ui/scroll-area";
import {Badge} from "@/components/ui/badge";
import {Button} from "@/components/ui/button";
import {Alert, AlertDescription} from "@/components/ui/alert";
import {Skeleton} from "@/components/ui/skeleton";
import {useStackEvents} from "@/hooks/use-stack-events";
import type {StackEvent, StackEventType} from "@/lib/stacks-api";

export interface EventLogCardProps {
    readonly stackId: string;
}

type BadgeVariant = "default" | "secondary" | "destructive" | "outline";

interface EventDescription {
    label: string;
    description: string;
    variant: BadgeVariant;
}

const LABELS: Record<StackEventType, string> = {
    config_changed: "Config Changed",
    config_error: "Config Error",
    update_available: "Update Available",
};

const VARIANTS: Record<StackEventType, BadgeVariant> = {
    config_changed: "default",
    config_error: "destructive",
    update_available: "secondary",
};

// The pure entry-description helper: maps a StackEvent to its display label
// and description text. config_error and update_available both carry what
// they need in `message`; config_changed has no message, only a hash
// payload, so its text is fixed with the hashes appended when the payload
// parses cleanly. A malformed, empty or absent payload must never throw —
// it just falls back to the fixed text.
export function describeStackEvent(entry: StackEvent): EventDescription {
    const label = LABELS[entry.type];
    const variant = VARIANTS[entry.type];

    if (entry.type === "config_error") {
        return {label, variant, description: entry.message ?? "Configuration validation failed"};
    }

    if (entry.type === "update_available") {
        return {label, variant, description: entry.message ?? "A newer image is available"};
    }

    let description = "The compose file changed on disk";
    if (entry.payload) {
        try {
            const parsed = JSON.parse(entry.payload) as {oldHash?: string; newHash?: string};
            if (parsed.oldHash && parsed.newHash) {
                description += ` (${parsed.oldHash.slice(0, 7)} → ${parsed.newHash.slice(0, 7)})`;
            }
        } catch {
            // Malformed payload — keep the fixed text, never throw.
        }
    }
    return {label, variant, description};
}

export function EventLogCard({stackId}: Readonly<EventLogCardProps>) {
    const {events, loading, error, refetch} = useStackEvents(stackId);

    return (
        <Card>
            <CardHeader>
                <CardTitle role="heading" aria-level={2}>Event Log</CardTitle>
                <CardDescription>
                    Configuration and image update events detected in the background
                </CardDescription>
            </CardHeader>
            <CardContent>
                {loading && (
                    <div className="space-y-2" role="status" aria-label="Loading events">
                        <Skeleton className="h-4 w-2/3"/>
                        <Skeleton className="h-4 w-1/2"/>
                    </div>
                )}

                {!loading && events === null && (
                    <div className="space-y-3">
                        <Alert variant="destructive">
                            <AlertDescription>{error}</AlertDescription>
                        </Alert>
                        <Button variant="outline" size="sm" onClick={refetch}>
                            Retry
                        </Button>
                    </div>
                )}

                {!loading && events !== null && (
                    <ScrollArea className="h-64">
                        {events.length === 0 ? (
                            <p className="text-muted-foreground">No events recorded</p>
                        ) : (
                            <div className="space-y-2">
                                {events.map((entry) => {
                                    const {label, description, variant} = describeStackEvent(entry);
                                    return (
                                        <div key={entry.id} className="flex items-start gap-3 text-sm">
                                            <span className="text-muted-foreground whitespace-nowrap">
                                                {new Date(entry.createdAt).toLocaleString()}
                                            </span>
                                            <Badge variant={variant}>{label}</Badge>
                                            <span>{description}</span>
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </ScrollArea>
                )}
            </CardContent>
        </Card>
    );
}
