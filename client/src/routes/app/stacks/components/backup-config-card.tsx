import {useEffect, useState} from "react";
import {useNavigate} from "react-router";
import {toast} from "sonner";
import {AlertTriangle} from "lucide-react";

import {
    getBackupConfig,
    getVolumeWarnings,
    saveBackupConfig,
    triggerBackup,
    type StackBackupConfig,
} from "@/lib/backups-api";
import {Card, CardContent, CardFooter, CardHeader, CardTitle} from "@/components/ui/card";
import {Button} from "@/components/ui/button";
import {Input} from "@/components/ui/input";
import {Label} from "@/components/ui/label";
import {Switch} from "@/components/ui/switch";
import {Alert, AlertDescription} from "@/components/ui/alert";

interface BackupConfigCardProps {
    readonly stackId: string;
    readonly stackStatus: string;
}

export function BackupConfigCard({stackId, stackStatus}: BackupConfigCardProps) {
    const navigate = useNavigate();
    const [config, setConfig] = useState<StackBackupConfig | null>(null);
    const [volumeWarnings, setVolumeWarnings] = useState<string[]>([]);
    const [loading, setLoading] = useState(true);

    // Form state
    const [useGlobalSchedule, setUseGlobalSchedule] = useState(true);
    const [schedule, setSchedule] = useState("");
    const [useGlobalRetention, setUseGlobalRetention] = useState(true);
    const [keepDaily, setKeepDaily] = useState("7");
    const [keepWeekly, setKeepWeekly] = useState("4");
    const [keepMonthly, setKeepMonthly] = useState("12");
    const [preHook, setPreHook] = useState("");
    const [postHook, setPostHook] = useState("");

    const isBackingUp = stackStatus === "BACKING_UP";

    useEffect(() => {
        let cancelled = false;

        async function load() {
            setLoading(true);
            try {
                const [cfg, warnings] = await Promise.all([
                    getBackupConfig(stackId),
                    getVolumeWarnings(stackId),
                ]);
                if (cancelled) return;
                setConfig(cfg);
                setVolumeWarnings(warnings.warnings);

                setUseGlobalSchedule(cfg.useGlobalSchedule);
                setSchedule(cfg.schedule ?? "");
                setUseGlobalRetention(cfg.useGlobalRetention);
                setKeepDaily(String(cfg.retention?.keepDaily ?? 7));
                setKeepWeekly(String(cfg.retention?.keepWeekly ?? 4));
                setKeepMonthly(String(cfg.retention?.keepMonthly ?? 12));
                setPreHook(cfg.preHook ?? "");
                setPostHook(cfg.postHook ?? "");
            } catch {
                // silently fail — config is optional
            } finally {
                if (!cancelled) setLoading(false);
            }
        }

        void load();
        return () => {
            cancelled = true;
        };
    }, [stackId]);

    async function handleBackupNow() {
        try {
            const {backupId} = await triggerBackup(stackId);
            toast.success("Backup started", {
                action: {
                    label: "View progress",
                    onClick: () => navigate(`/stacks/${stackId}/backups/${backupId}`),
                },
            });
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : "Backup failed";
            toast.error(message);
        }
    }

    function handleSave() {
        const data = {
            useGlobalSchedule,
            schedule: useGlobalSchedule ? null : schedule || null,
            useGlobalRetention,
            retention: useGlobalRetention
                ? null
                : {
                      keepDaily: Number(keepDaily),
                      keepWeekly: Number(keepWeekly),
                      keepMonthly: Number(keepMonthly),
                  },
            preHook: preHook || null,
            postHook: postHook || null,
        };

        toast.promise(saveBackupConfig(stackId, data), {
            loading: "Saving configuration...",
            success: "Configuration saved",
            error: (err: Error) => err?.message ?? "Save failed",
        });
    }

    if (loading || !config) {
        return (
            <Card>
                <CardHeader>
                    <CardTitle>Backup Configuration</CardTitle>
                </CardHeader>
                <CardContent>
                    <p className="text-muted-foreground text-sm">Loading...</p>
                </CardContent>
            </Card>
        );
    }

    return (
        <Card>
            <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle>Backup Configuration</CardTitle>
                <Button
                    variant="outline"
                    size="sm"
                    disabled={isBackingUp}
                    onClick={handleBackupNow}
                >
                    {isBackingUp ? "Backup in progress..." : "Backup Now"}
                </Button>
            </CardHeader>

            <CardContent className="space-y-4">
                {/* Schedule */}
                <div className="space-y-2">
                    <div className="flex items-center gap-3">
                        <Switch
                            id={`use-global-schedule-${stackId}`}
                            checked={useGlobalSchedule}
                            onCheckedChange={setUseGlobalSchedule}
                        />
                        <Label htmlFor={`use-global-schedule-${stackId}`}>
                            Use global schedule
                            {config.globalSchedule && (
                                <span className="ml-1 text-muted-foreground text-xs">
                                    ({config.globalSchedule})
                                </span>
                            )}
                        </Label>
                    </div>
                    {!useGlobalSchedule && (
                        <div className="ml-10 space-y-1">
                            <Input
                                id={`schedule-override-${stackId}`}
                                placeholder="0 3 * * *"
                                value={schedule}
                                onChange={(e) => setSchedule(e.target.value)}
                            />
                            <p className="text-xs text-muted-foreground">
                                5-field cron expression (minute hour day month weekday)
                            </p>
                        </div>
                    )}
                </div>

                {/* Retention */}
                <div className="space-y-2">
                    <div className="flex items-center gap-3">
                        <Switch
                            id={`use-global-retention-${stackId}`}
                            checked={useGlobalRetention}
                            onCheckedChange={setUseGlobalRetention}
                        />
                        <Label htmlFor={`use-global-retention-${stackId}`}>
                            Use global retention
                        </Label>
                    </div>
                    {!useGlobalRetention && (
                        <div className="ml-10 grid grid-cols-3 gap-3">
                            <div className="space-y-1">
                                <Label htmlFor={`keep-daily-${stackId}`} className="text-xs">
                                    Keep daily
                                </Label>
                                <Input
                                    id={`keep-daily-${stackId}`}
                                    type="number"
                                    min={0}
                                    value={keepDaily}
                                    onChange={(e) => setKeepDaily(e.target.value)}
                                />
                            </div>
                            <div className="space-y-1">
                                <Label htmlFor={`keep-weekly-${stackId}`} className="text-xs">
                                    Keep weekly
                                </Label>
                                <Input
                                    id={`keep-weekly-${stackId}`}
                                    type="number"
                                    min={0}
                                    value={keepWeekly}
                                    onChange={(e) => setKeepWeekly(e.target.value)}
                                />
                            </div>
                            <div className="space-y-1">
                                <Label htmlFor={`keep-monthly-${stackId}`} className="text-xs">
                                    Keep monthly
                                </Label>
                                <Input
                                    id={`keep-monthly-${stackId}`}
                                    type="number"
                                    min={0}
                                    value={keepMonthly}
                                    onChange={(e) => setKeepMonthly(e.target.value)}
                                />
                            </div>
                        </div>
                    )}
                </div>

                {/* Hooks */}
                <div className="space-y-2">
                    <Label htmlFor={`pre-hook-${stackId}`}>Pre-backup hook</Label>
                    <Input
                        id={`pre-hook-${stackId}`}
                        placeholder="e.g. docker exec mydb pg_dump ..."
                        value={preHook}
                        onChange={(e) => setPreHook(e.target.value)}
                    />
                </div>
                <div className="space-y-2">
                    <Label htmlFor={`post-hook-${stackId}`}>Post-backup hook</Label>
                    <Input
                        id={`post-hook-${stackId}`}
                        placeholder="e.g. /opt/scripts/notify.sh"
                        value={postHook}
                        onChange={(e) => setPostHook(e.target.value)}
                    />
                </div>

                {/* Volume warnings (BCK-07) */}
                {volumeWarnings.length > 0 && (
                    <Alert>
                        <AlertTriangle className="h-4 w-4" />
                        <AlertDescription>
                            <p className="mb-1">
                                The following volumes are outside the stack directory and will not
                                be included in this backup:
                            </p>
                            <ul className="list-disc list-inside space-y-0.5">
                                {volumeWarnings.map((w) => (
                                    <li key={w} className="text-xs font-mono">
                                        {w}
                                    </li>
                                ))}
                            </ul>
                        </AlertDescription>
                    </Alert>
                )}
            </CardContent>

            <CardFooter>
                <Button onClick={handleSave}>Save configuration</Button>
            </CardFooter>
        </Card>
    );
}
