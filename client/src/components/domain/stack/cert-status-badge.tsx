import {Badge} from "@/components/ui/badge";
import {ScrollArea} from "@/components/ui/scroll-area";
import {cn} from "@/lib/utils";

interface CertStatusBadgeProps {
    readonly status?: string | null;
    readonly message?: string | null;
}

// D-05: the ProxyConfig schema default is literally "pending" — a domain the
// cert poller hasn't reported on yet is indistinguishable from one it has
// classified pending, so both "no status yet" and an explicit "pending"
// render the same badge (no separate "Checking..." state, per the UI-SPEC's
// resolved D-04 assumption).
export function CertStatusBadge({status, message}: Readonly<CertStatusBadgeProps>) {
    if (status === "issued") {
        return (
            <Badge variant="outline" className="text-green-600">
                Secured
            </Badge>
        );
    }

    if (status === "failed") {
        return (
            <div className="space-y-1">
                <Badge variant="destructive">Cert failed</Badge>
                {message && (
                    <ScrollArea className="h-16 w-full max-w-xs rounded border">
                        <pre className="whitespace-pre-wrap p-2 text-xs font-mono">{message}</pre>
                    </ScrollArea>
                )}
            </div>
        );
    }

    return (
        <Badge
            variant="outline"
            className={cn(
                "bg-yellow-100 text-yellow-800 border-yellow-200 dark:bg-yellow-900 dark:text-yellow-200 dark:border-yellow-800",
            )}
        >
            Cert pending
        </Badge>
    );
}
