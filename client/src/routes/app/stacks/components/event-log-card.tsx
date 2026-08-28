import {Card, CardContent, CardHeader, CardTitle} from "@/components/ui/card";
import {ScrollArea} from "@/components/ui/scroll-area";
import {useStackEvents} from "@/hooks/use-stack-events";

export interface EventLogCardProps {
    readonly stackId: string;
}

export function EventLogCard({stackId}: Readonly<EventLogCardProps>) {
    const {events} = useStackEvents(stackId);

    return (
        <Card>
            <CardHeader>
                <CardTitle>Event Log</CardTitle>
            </CardHeader>
            <CardContent>
                <ScrollArea className="h-64">
                    <div className="space-y-2">
                        {(events ?? []).map((entry) => (
                            <div key={entry.id} className="flex items-start gap-3 text-sm">
                                <span className="text-muted-foreground whitespace-nowrap">
                                    {new Date(entry.createdAt).toLocaleString()}
                                </span>
                                <span>{entry.type}</span>
                            </div>
                        ))}
                    </div>
                </ScrollArea>
            </CardContent>
        </Card>
    );
}
