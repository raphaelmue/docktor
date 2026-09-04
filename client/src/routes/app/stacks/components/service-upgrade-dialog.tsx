import {useEffect, useState} from "react";
import {toast} from "sonner";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import {Button} from "@/components/ui/button";
import {Label} from "@/components/ui/label";
import {Skeleton} from "@/components/ui/skeleton";
import {Alert, AlertDescription} from "@/components/ui/alert";
import {ApiError} from "@/lib/api";
import {getServiceTags, upgradeService, type ServiceTagsResponse} from "@/lib/stacks-api";

export interface ServiceUpgradeDialogProps {
    readonly stackId: string;
    readonly serviceName: string;
    readonly currentTag: string;
    readonly open: boolean;
    readonly onOpenChange: (open: boolean) => void;
    readonly onUpgraded: () => void;
}

type FetchState =
    | {status: "loading"}
    | {status: "error"; message: string}
    | {status: "ready"; data: ServiceTagsResponse};

export function ServiceUpgradeDialog({
    stackId,
    serviceName,
    currentTag,
    open,
    onOpenChange,
    onUpgraded,
}: Readonly<ServiceUpgradeDialogProps>) {
    const [state, setState] = useState<FetchState>({status: "loading"});
    const [selectedTag, setSelectedTag] = useState<string | undefined>(undefined);
    const [submitting, setSubmitting] = useState(false);

    function load() {
        setState({status: "loading"});
        setSelectedTag(undefined);
        getServiceTags(stackId, serviceName)
            .then((data) => {
                setState({status: "ready", data});
                if (data.latestTag && data.candidates.includes(data.latestTag)) {
                    setSelectedTag(data.latestTag);
                } else if (data.candidates.length > 0) {
                    setSelectedTag(data.candidates[0]);
                }
            })
            .catch((err: unknown) => {
                const message =
                    err instanceof ApiError ? err.message : "Failed to load available versions";
                setState({status: "error", message});
            });
    }

    // One fetch per open — no polling, no refetch on re-render.
    useEffect(() => {
        if (open) {
            load();
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open, stackId, serviceName]);

    function handleConfirm() {
        if (state.status !== "ready" || !selectedTag) return;
        setSubmitting(true);
        toast.promise(
            (async () => {
                try {
                    const result = await upgradeService(stackId, serviceName, selectedTag);
                    onOpenChange(false);
                    onUpgraded();
                    return result;
                } finally {
                    setSubmitting(false);
                }
            })(),
            {
                loading: `Upgrading ${serviceName}...`,
                success: (result) =>
                    result.changed
                        ? `${serviceName} upgraded to ${result.newTag}`
                        : `${serviceName} is already on ${result.newTag}`,
                error: (err: Error) => err?.message ?? "Upgrade failed",
            },
        );
    }

    const isConfirmDisabled =
        submitting || state.status !== "ready" || !selectedTag || selectedTag === currentTag;

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Upgrade {serviceName}</DialogTitle>
                    <DialogDescription>
                        Choose a version to upgrade {serviceName} from its current version,{" "}
                        {currentTag}.
                    </DialogDescription>
                </DialogHeader>

                {state.status === "loading" && (
                    <div className="space-y-2" role="status" aria-label="Loading available versions">
                        <Skeleton className="h-4 w-2/3" />
                        <Skeleton className="h-9 w-full" />
                    </div>
                )}

                {state.status === "error" && (
                    <div className="space-y-3">
                        <Alert variant="destructive">
                            <AlertDescription>{state.message}</AlertDescription>
                        </Alert>
                        <Button variant="outline" size="sm" onClick={load}>
                            Retry
                        </Button>
                    </div>
                )}

                {state.status === "ready" && state.data.candidates.length > 0 && (
                    <div className="space-y-2">
                        <Label htmlFor="upgrade-target-tag">Target version</Label>
                        <Select value={selectedTag} onValueChange={setSelectedTag}>
                            <SelectTrigger id="upgrade-target-tag" className="w-full">
                                <SelectValue placeholder="Select a version" />
                            </SelectTrigger>
                            <SelectContent>
                                {state.data.candidates.map((tag) => (
                                    <SelectItem key={tag} value={tag}>
                                        {tag}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                )}

                {state.status === "ready" &&
                    state.data.candidates.length === 0 &&
                    state.data.latestTag && (
                        <p className="text-sm text-muted-foreground">
                            {serviceName} is already on the newest known version (
                            {state.data.latestTag}).
                        </p>
                    )}

                {state.status === "ready" &&
                    state.data.candidates.length === 0 &&
                    !state.data.latestTag && (
                        <p className="text-sm text-muted-foreground">
                            The registry has not been checked for this image yet. Checks run on a
                            staggered schedule — check back later.
                        </p>
                    )}

                <DialogFooter>
                    <Button variant="outline" onClick={() => onOpenChange(false)}>
                        Cancel
                    </Button>
                    <Button onClick={handleConfirm} disabled={isConfirmDisabled}>
                        Upgrade
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
