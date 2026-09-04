import {useRef, useState} from "react";

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
import {Input} from "@/components/ui/input";

interface RestoreConfirmDialogProps {
    readonly open: boolean;
    readonly onOpenChange: (open: boolean) => void;
    readonly stackName: string;
    readonly snapshotId: string;
    readonly onConfirm: () => void;
}

export function RestoreConfirmDialog({
    open,
    onOpenChange,
    stackName,
    snapshotId,
    onConfirm,
}: RestoreConfirmDialogProps) {
    const [typedValue, setTypedValue] = useState("");
    const inputRef = useRef<HTMLInputElement>(null);

    function handleOpenChange(nextOpen: boolean) {
        if (!nextOpen) {
            setTypedValue("");
        }
        onOpenChange(nextOpen);
    }

    function handleConfirm() {
        onConfirm();
        setTypedValue("");
        onOpenChange(false);
    }

    const shortId = snapshotId.slice(0, 8);

    return (
        <AlertDialog open={open} onOpenChange={handleOpenChange}>
            <AlertDialogContent>
                <AlertDialogHeader>
                    <AlertDialogTitle>
                        Restore {stackName} from snapshot {shortId}?
                    </AlertDialogTitle>
                    <AlertDialogDescription>
                        This will stop the stack, overwrite all files with the snapshot contents, and
                        redeploy. This action cannot be undone. Type{" "}
                        <span className="font-semibold">{stackName}</span> to confirm.
                    </AlertDialogDescription>
                </AlertDialogHeader>

                <Input
                    ref={inputRef}
                    aria-label="Confirm stack name"
                    placeholder="Enter stack name"
                    value={typedValue}
                    onChange={(e) => setTypedValue(e.target.value)}
                    autoFocus
                />

                <AlertDialogFooter>
                    <AlertDialogCancel>Keep stack</AlertDialogCancel>
                    <AlertDialogAction
                        onClick={handleConfirm}
                        disabled={typedValue !== stackName}
                        className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                    >
                        Restore snapshot
                    </AlertDialogAction>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    );
}
