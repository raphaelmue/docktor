import {useEffect, useState} from "react";
import {useNavigate, useParams} from "react-router";
import {AlertTriangle, Check, ChevronsUpDown} from "lucide-react";
import {toast} from "sonner";
import {Page, PageContent, PageDescription, PageHeader, PageTitle} from "@/components/common/layout/page";
import {Breadcrumb, BreadcrumbItem, BreadcrumbList, BreadcrumbPage} from "@/components/ui/breadcrumb";
import {Card, CardContent, CardFooter, CardHeader, CardTitle} from "@/components/ui/card";
import {Button} from "@/components/ui/button";
import {Input} from "@/components/ui/input";
import {Label} from "@/components/ui/label";
import {Skeleton} from "@/components/ui/skeleton";
import {Popover, PopoverContent, PopoverTrigger} from "@/components/ui/popover";
import {Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList,} from "@/components/ui/command";
import {Select, SelectContent, SelectItem, SelectTrigger, SelectValue} from "@/components/ui/select";
import {Tabs, TabsContent, TabsList, TabsTrigger} from "@/components/ui/tabs";
import {Switch} from "@/components/ui/switch";
import {Table, TableBody, TableCell, TableHead, TableHeader, TableRow} from "@/components/ui/table";
import {Badge} from "@/components/ui/badge";
import {Alert, AlertDescription} from "@/components/ui/alert";
import {getGeneralSettings, updateGeneralSettings} from "@/lib/settings-api";
import {
    getSmtpSettings, saveSmtpSettings, testSmtp,
    getNotificationTriggers, updateNotificationTriggers,
    getNotifications, type NotificationEntry,
} from "@/lib/notifications-api";
import {
    getBackupSettings, saveBackupSettings,
    getBackupDefaults, saveBackupDefaults,
    getResticStatus,
    type BackupSettings, type BackupDefaults, type ResticStatus,
} from "@/lib/backups-api";
import {ApiError} from "@/lib/api";
import {cn} from "@/lib/utils";
import {useContainerEvents} from "@/hooks/use-container-events";

const TIMEZONES = Intl.supportedValuesOf("timeZone");
const VALID_TABS = ["general", "notifications", "backup"] as const;
type Tab = typeof VALID_TABS[number];

interface TimezoneComboboxProps {
    value: string;
    onChange: (value: string) => void;
}

function TimezoneCombobox({value, onChange}: TimezoneComboboxProps) {
    const [open, setOpen] = useState(false);

    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
                <Button
                    variant="outline"
                    role="combobox"
                    aria-expanded={open}
                    className="w-full justify-between"
                >
                    {value || "Select timezone..."}
                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                </Button>
            </PopoverTrigger>
            <PopoverContent className="w-[300px] p-0">
                <Command>
                    <CommandInput placeholder="Search timezone..." />
                    <CommandList>
                        <CommandEmpty>No timezone found.</CommandEmpty>
                        <CommandGroup>
                            {TIMEZONES.map((tz) => (
                                <CommandItem
                                    key={tz}
                                    value={tz}
                                    onSelect={(val) => {
                                        onChange(val);
                                        setOpen(false);
                                    }}
                                >
                                    <Check
                                        className={cn(
                                            "mr-2 h-4 w-4",
                                            value === tz ? "opacity-100" : "opacity-0",
                                        )}
                                    />
                                    {tz}
                                </CommandItem>
                            ))}
                        </CommandGroup>
                    </CommandList>
                </Command>
            </PopoverContent>
        </Popover>
    );
}

function getTypeBadgeClass(type: string): string {
    switch (type) {
        case "stack_error": return "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200";
        case "stack_unhealthy": return "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200";
        case "disk_warning": return "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200";
        default: return "";
    }
}

function formatType(type: string): string {
    switch (type) {
        case "stack_error": return "Error";
        case "stack_unhealthy": return "Unhealthy";
        case "disk_warning": return "Disk";
        default: return type;
    }
}

function SmtpCard() {
    const [smtpHost, setSmtpHost] = useState("");
    const [smtpPort, setSmtpPort] = useState(587);
    const [smtpEncryption, setSmtpEncryption] = useState<"none" | "starttls" | "ssl">("starttls");
    const [smtpUsername, setSmtpUsername] = useState("");
    const [smtpPassword, setSmtpPassword] = useState("");
    const [hasExistingPassword, setHasExistingPassword] = useState(false);
    // true while showing the "saved password" dots — cleared as soon as user focuses the field
    const [passwordLocked, setPasswordLocked] = useState(false);
    const [smtpFrom, setSmtpFrom] = useState("");
    const [testRecipient, setTestRecipient] = useState("");
    const [smtpLoading, setSmtpLoading] = useState(true);
    const [smtpSaving, setSmtpSaving] = useState(false);
    const [smtpTesting, setSmtpTesting] = useState(false);
    const [smtpErrors, setSmtpErrors] = useState<Record<string, string>>({});

    useEffect(() => {
        getSmtpSettings()
            .then((data) => {
                setSmtpHost(data.host);
                setSmtpPort(data.port);
                setSmtpEncryption(data.encryption);
                setSmtpUsername(data.username);
                setSmtpFrom(data.from);
                setTestRecipient("");
                setHasExistingPassword(data.hasPassword);
                setPasswordLocked(data.hasPassword);
                setSmtpLoading(false);
            })
            .catch(() => {
                setSmtpLoading(false);
            });
    }, []);

    const handleSaveSmtp = async () => {
        setSmtpErrors({});
        setSmtpSaving(true);
        try {
            await saveSmtpSettings({
                host: smtpHost,
                port: smtpPort,
                encryption: smtpEncryption,
                username: smtpUsername,
                password: passwordLocked ? "" : smtpPassword,
                from: smtpFrom,
            });
            if (!passwordLocked && smtpPassword) {
                setHasExistingPassword(true);
                setPasswordLocked(true);
                setSmtpPassword("");
            }
            toast.success("SMTP settings saved");
        } catch (err) {
            if (err instanceof ApiError && err.status === 400) {
                if (err.fields && Object.keys(err.fields).length > 0) {
                    setSmtpErrors(err.fields);
                } else {
                    setSmtpErrors({general: err.message});
                }
            } else {
                toast.error("Failed to save SMTP settings");
            }
        } finally {
            setSmtpSaving(false);
        }
    };

    const handleTestSmtp = async () => {
        if (!testRecipient) {
            setSmtpErrors({testRecipient: "Recipient is required to send a test email"});
            return;
        }
        setSmtpErrors({});
        setSmtpTesting(true);
        try {
            await testSmtp({
                host: smtpHost,
                port: smtpPort,
                encryption: smtpEncryption,
                username: smtpUsername,
                password: passwordLocked ? "" : smtpPassword,
                from: smtpFrom,
                recipient: testRecipient,
            });
            toast.success("Test email sent successfully");
        } catch (err) {
            const errMsg = err instanceof Error ? err.message : "Unknown error";
            toast.error("Test email failed: " + errMsg);
        } finally {
            setSmtpTesting(false);
        }
    };

    return (
        <Card>
            <CardHeader>
                <CardTitle>SMTP</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
                {smtpLoading ? (
                    <div className="grid grid-cols-2 gap-4">
                        {Array.from({length: 6}).map((_, i) => (
                            <div key={i} className="space-y-1">
                                <Skeleton className="h-4 w-28" />
                                <Skeleton className="h-9 w-full" />
                            </div>
                        ))}
                    </div>
                ) : (
                    <>
                        {smtpErrors.general && (
                            <p className="text-sm text-destructive">{smtpErrors.general}</p>
                        )}
                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-1">
                                <Label htmlFor="smtpHost">SMTP Host</Label>
                                <Input
                                    id="smtpHost"
                                    value={smtpHost}
                                    onChange={(e) => setSmtpHost(e.target.value)}
                                    placeholder="smtp.gmail.com"
                                />
                                {smtpErrors.host && <p className="text-sm text-destructive">{smtpErrors.host}</p>}
                            </div>
                            <div className="space-y-1">
                                <Label htmlFor="smtpPort">Port</Label>
                                <Input
                                    id="smtpPort"
                                    type="number"
                                    value={smtpPort}
                                    onChange={(e) => setSmtpPort(Number(e.target.value))}
                                    placeholder="587"
                                />
                                {smtpErrors.port && <p className="text-sm text-destructive">{smtpErrors.port}</p>}
                            </div>
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-1">
                                <Label htmlFor="smtpEncryption">Encryption</Label>
                                <Select value={smtpEncryption} onValueChange={(v) => setSmtpEncryption(v as "none" | "starttls" | "ssl")}>
                                    <SelectTrigger id="smtpEncryption">
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="none">None</SelectItem>
                                        <SelectItem value="starttls">STARTTLS (port 587)</SelectItem>
                                        <SelectItem value="ssl">SSL/TLS (port 465)</SelectItem>
                                    </SelectContent>
                                </Select>
                                {smtpErrors.encryption && <p className="text-sm text-destructive">{smtpErrors.encryption}</p>}
                            </div>
                            <div className="space-y-1">
                                <Label htmlFor="smtpFrom">From Address</Label>
                                <Input
                                    id="smtpFrom"
                                    value={smtpFrom}
                                    onChange={(e) => setSmtpFrom(e.target.value)}
                                    placeholder="Docktor <noreply@example.com>"
                                />
                                {smtpErrors.from && <p className="text-sm text-destructive">{smtpErrors.from}</p>}
                            </div>
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-1">
                                <Label htmlFor="smtpUsername">Username</Label>
                                <Input
                                    id="smtpUsername"
                                    value={smtpUsername}
                                    onChange={(e) => setSmtpUsername(e.target.value)}
                                    placeholder="user@example.com"
                                />
                            </div>
                            <div className="space-y-1">
                                <Label htmlFor="smtpPassword">Password</Label>
                                <Input
                                    id="smtpPassword"
                                    type="password"
                                    value={passwordLocked ? "locked" : smtpPassword}
                                    onFocus={() => {
                                        if (passwordLocked) {
                                            setPasswordLocked(false);
                                            setSmtpPassword("");
                                        }
                                    }}
                                    onChange={(e) => {
                                        setPasswordLocked(false);
                                        setSmtpPassword(e.target.value);
                                    }}
                                    placeholder="Enter password"
                                />
                            </div>
                        </div>
                    </>
                )}
            </CardContent>
            <CardFooter className="flex-col items-start gap-3">
                <Button onClick={handleSaveSmtp} disabled={smtpSaving || smtpLoading}>
                    {smtpSaving ? "Saving..." : "Save SMTP Settings"}
                </Button>
                <div className="flex items-start gap-2 w-full">
                    <div className="flex-1 space-y-1">
                        <Input
                            type="email"
                            value={testRecipient}
                            onChange={(e) => setTestRecipient(e.target.value)}
                            placeholder="Send test to..."
                            disabled={smtpTesting || smtpLoading}
                        />
                        {smtpErrors.testRecipient && <p className="text-sm text-destructive">{smtpErrors.testRecipient}</p>}
                    </div>
                    <Button variant="outline" onClick={handleTestSmtp} disabled={smtpTesting || smtpLoading}>
                        {smtpTesting ? "Sending..." : "Send Test Email"}
                    </Button>
                </div>
            </CardFooter>
        </Card>
    );
}

function NotificationTriggersCard() {
    const [stackError, setStackError] = useState(false);
    const [diskWarning, setDiskWarning] = useState(false);
    const [diskThresholdPercent, setDiskThresholdPercent] = useState(10);
    const [diskThresholdBytes, setDiskThresholdBytes] = useState(2147483648);
    const [backupFailure, setBackupFailure] = useState(false);
    const [triggersLoading, setTriggersLoading] = useState(true);

    useEffect(() => {
        getNotificationTriggers()
            .then((data) => {
                setStackError(data.stackError);
                setDiskWarning(data.diskWarning);
                setDiskThresholdPercent(data.diskThresholdPercent);
                setDiskThresholdBytes(data.diskThresholdBytes);
                setBackupFailure(data.backupFailure);
                setTriggersLoading(false);
            })
            .catch(() => {
                setTriggersLoading(false);
            });
    }, []);

    const handleToggle = async (
        key: "stackError" | "diskWarning" | "backupFailure",
        value: boolean,
    ) => {
        const prev =
            key === "stackError" ? stackError
            : key === "diskWarning" ? diskWarning
            : backupFailure;
        if (key === "stackError") setStackError(value);
        else if (key === "diskWarning") setDiskWarning(value);
        else setBackupFailure(value);
        try {
            await updateNotificationTriggers({[key]: value});
            toast.success("Notification settings saved");
        } catch {
            if (key === "stackError") setStackError(prev);
            else if (key === "diskWarning") setDiskWarning(prev);
            else setBackupFailure(prev);
            toast.error("Failed to update notification settings");
        }
    };

    const handleThresholdUpdate = async (
        key: "diskThresholdPercent" | "diskThresholdBytes",
        value: number,
    ) => {
        const prev = key === "diskThresholdPercent" ? diskThresholdPercent : diskThresholdBytes;
        if (key === "diskThresholdPercent") setDiskThresholdPercent(value);
        else setDiskThresholdBytes(value);
        try {
            await updateNotificationTriggers({[key]: value});
            toast.success("Threshold updated");
        } catch {
            if (key === "diskThresholdPercent") setDiskThresholdPercent(prev);
            else setDiskThresholdBytes(prev);
            toast.error("Failed to update threshold");
        }
    };

    const formatBytes = (bytes: number): string => {
        if (bytes === 0) return "0 B";
        const units = ["B", "KB", "MB", "GB", "TB"];
        const k = 1024;
        let i = 0;
        let value = bytes;
        while (value >= k && i < units.length - 1) {
            value /= k;
            i++;
        }
        return `${Math.round(value)} ${units[i]}`;
    };

    const parseBytes = (input: string): number => {
        const match = input.match(/^(\d+(?:\.\d+)?)\s*(B|KB|MB|GB|TB)?$/i);
        if (!match) return 0;
        const value = Number.parseFloat(match[1]);
        const unit = (match[2] || "B").toUpperCase();
        const multipliers: Record<string, number> = {
            B: 1,
            KB: 1024,
            MB: 1024 ** 2,
            GB: 1024 ** 3,
            TB: 1024 ** 4,
        };
        return Math.round(value * (multipliers[unit] || 1));
    };

    return (
        <Card>
            <CardHeader>
                <CardTitle>Notification Triggers</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
                {triggersLoading ? (
                    <>
                        <div className="flex items-center justify-between">
                            <div className="space-y-1">
                                <Skeleton className="h-4 w-48" />
                                <Skeleton className="h-4 w-64" />
                            </div>
                            <Skeleton className="h-6 w-11" />
                        </div>
                        <div className="flex items-center justify-between">
                            <div className="space-y-1">
                                <Skeleton className="h-4 w-40" />
                                <Skeleton className="h-4 w-72" />
                            </div>
                            <Skeleton className="h-6 w-11" />
                        </div>
                        <div className="flex items-center justify-between">
                            <div className="space-y-1">
                                <Skeleton className="h-4 w-44" />
                                <Skeleton className="h-4 w-68" />
                            </div>
                            <Skeleton className="h-6 w-11" />
                        </div>
                    </>
                ) : (
                    <>
                        <div className="flex items-center justify-between">
                            <div className="space-y-1">
                                <Label className="font-normal">Stack Error / Unhealthy</Label>
                                <p className="text-sm text-muted-foreground">Send an alert when a stack enters ERROR or UNHEALTHY state</p>
                            </div>
                            <Switch checked={stackError} onCheckedChange={(v) => handleToggle("stackError", v)} />
                        </div>
                        <div className="flex items-center justify-between">
                            <div className="space-y-1">
                                <Label className="font-normal">Disk Space Warning</Label>
                                <p className="text-sm text-muted-foreground">Send an alert when disk space drops below configured thresholds</p>
                            </div>
                            <Switch checked={diskWarning} onCheckedChange={(v) => handleToggle("diskWarning", v)} />
                        </div>
                        {diskWarning && (
                            <div className="ml-4 grid grid-cols-2 gap-4 pt-2">
                                <div className="space-y-1">
                                    <Label htmlFor="diskThresholdPercent">Threshold (%)</Label>
                                    <Input
                                        id="diskThresholdPercent"
                                        type="number"
                                        min={1}
                                        max={99}
                                        value={diskThresholdPercent}
                                        onChange={(e) => {
                                            const val = Number(e.target.value);
                                            if (val >= 1 && val <= 99) {
                                                setDiskThresholdPercent(val);
                                            }
                                        }}
                                        onBlur={() => handleThresholdUpdate("diskThresholdPercent", diskThresholdPercent)}
                                        placeholder="10"
                                    />
                                    <p className="text-xs text-muted-foreground">Alert when free space drops below this percentage</p>
                                </div>
                                <div className="space-y-1">
                                    <Label htmlFor="diskThresholdBytes">Threshold (bytes)</Label>
                                    <Input
                                        id="diskThresholdBytes"
                                        type="text"
                                        value={formatBytes(diskThresholdBytes)}
                                        onChange={(e) => {
                                            const bytes = parseBytes(e.target.value);
                                            if (bytes > 0) {
                                                setDiskThresholdBytes(bytes);
                                            }
                                        }}
                                        onBlur={() => handleThresholdUpdate("diskThresholdBytes", diskThresholdBytes)}
                                        placeholder="2 GB"
                                    />
                                    <p className="text-xs text-muted-foreground">Alert when free space drops below this amount (e.g., 2 GB)</p>
                                </div>
                            </div>
                        )}
                        <div className="flex items-center justify-between">
                            <div className="space-y-1">
                                <Label className="font-normal">Backup Failure</Label>
                                <p className="text-sm text-muted-foreground">Send an alert when a scheduled or manual backup fails</p>
                            </div>
                            <Switch checked={backupFailure} onCheckedChange={(v) => handleToggle("backupFailure", v)} />
                        </div>
                    </>
                )}
            </CardContent>
        </Card>
    );
}

function NotificationLogCard() {
    const [notifications, setNotifications] = useState<NotificationEntry[]>([]);
    const [logLoading, setLogLoading] = useState(true);

    const loadNotifications = () => {
        getNotifications()
            .then((data) => {
                setNotifications(data);
                setLogLoading(false);
            })
            .catch(() => {
                setLogLoading(false);
            });
    };

    useEffect(() => {
        loadNotifications();
    }, []);

    // Subscribe to SSE events and refresh when new notifications are created
    useContainerEvents((event) => {
        if (event.type === "notification_created") {
            loadNotifications();
        }
    });

    return (
        <Card>
            <CardHeader>
                <CardTitle>Notification Log</CardTitle>
            </CardHeader>
            <CardContent>
                {logLoading ? (
                    <>
                        <Skeleton className="h-10 w-full mb-2" />
                        <Skeleton className="h-10 w-full mb-2" />
                        <Skeleton className="h-10 w-full" />
                    </>
                ) : notifications.length === 0 ? (
                    <div className="text-center py-8">
                        <p className="text-sm font-semibold">No notifications yet</p>
                        <p className="text-sm text-muted-foreground mt-1">
                            Alerts will appear here when notification triggers fire. Enable triggers above to start monitoring.
                        </p>
                    </div>
                ) : (
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>Type</TableHead>
                                <TableHead>Stack</TableHead>
                                <TableHead>Message</TableHead>
                                <TableHead>Email</TableHead>
                                <TableHead>Time</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {notifications.map((n) => (
                                <TableRow key={n.id}>
                                    <TableCell>
                                        <Badge variant="secondary" className={getTypeBadgeClass(n.type)}>
                                            {formatType(n.type)}
                                        </Badge>
                                    </TableCell>
                                    <TableCell>{n.stack?.displayName ?? "—"}</TableCell>
                                    <TableCell className="max-w-xs truncate">{n.message}</TableCell>
                                    <TableCell>
                                        <Badge variant={n.emailSent ? "secondary" : "outline"}>
                                            {n.emailSent ? "Sent" : "UI only"}
                                        </Badge>
                                    </TableCell>
                                    <TableCell className="text-sm text-muted-foreground">
                                        {new Date(n.createdAt).toLocaleString()}
                                    </TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                )}
            </CardContent>
        </Card>
    );
}

function BackupRepositoryCard() {
    const [repoType, setRepoType] = useState<"local" | "sftp" | "s3" | "">("");
    const [repoPath, setRepoPath] = useState("");
    const [sftpHost, setSftpHost] = useState("");
    const [sftpUser, setSftpUser] = useState("");
    const [sftpKey, setSftpKey] = useState("");
    const [s3Endpoint, setS3Endpoint] = useState("");
    const [s3Bucket, setS3Bucket] = useState("");
    const [s3AccessKey, setS3AccessKey] = useState("");
    const [s3SecretKey, setS3SecretKey] = useState("");
    const [password, setPassword] = useState("");
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [resticStatus, setResticStatus] = useState<ResticStatus | null>(null);
    const [settings, setSettings] = useState<BackupSettings | null>(null);

    useEffect(() => {
        Promise.all([getBackupSettings(), getResticStatus()])
            .then(([s, rs]) => {
                setSettings(s);
                setRepoType(s.repoType ?? "");
                setRepoPath(s.repoPath ?? "");
                setSftpHost(s.sftpHost ?? "");
                setSftpUser(s.sftpUser ?? "");
                setS3Endpoint(s.s3Endpoint ?? "");
                setS3Bucket(s.s3Bucket ?? "");
                setS3AccessKey(s.s3AccessKey ?? "");
                setResticStatus(rs);
                setLoading(false);
            })
            .catch(() => {
                setLoading(false);
            });
    }, []);

    const handleSave = () => {
        setSaving(true);
        const data: Record<string, unknown> = {
            repoType: repoType || null,
            repoPath: repoPath || null,
            sftpHost: sftpHost || null,
            sftpUser: sftpUser || null,
            sftpKey: sftpKey || null,
            s3Endpoint: s3Endpoint || null,
            s3Bucket: s3Bucket || null,
            s3AccessKey: s3AccessKey || null,
            s3SecretKey: s3SecretKey || null,
            password: password || null,
        };
        toast.promise(saveBackupSettings(data).finally(() => setSaving(false)), {
            loading: "Saving...",
            success: "Repository settings saved",
            error: "Failed to save",
        });
    };

    return (
        <Card>
            <CardHeader>
                <CardTitle>Backup Repository</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
                {loading ? (
                    <>
                        <div className="space-y-1">
                            <Skeleton className="h-4 w-32" />
                            <Skeleton className="h-9 w-full" />
                        </div>
                        <div className="space-y-1">
                            <Skeleton className="h-4 w-28" />
                            <Skeleton className="h-9 w-full" />
                        </div>
                    </>
                ) : (
                    <>
                        {resticStatus && !resticStatus.available && (
                            <Alert>
                                <AlertTriangle className="h-4 w-4" />
                                <AlertDescription>
                                    restic is not installed on this host. Install restic &gt;= 0.17.0 to enable backups.
                                </AlertDescription>
                            </Alert>
                        )}
                        <div className="space-y-1">
                            <Label htmlFor="repoType">Repository type</Label>
                            <Select
                                value={repoType}
                                onValueChange={(v) => setRepoType(v as "local" | "sftp" | "s3")}
                            >
                                <SelectTrigger id="repoType">
                                    <SelectValue placeholder="Select type..." />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="local">Local</SelectItem>
                                    <SelectItem value="sftp">SFTP</SelectItem>
                                    <SelectItem value="s3">S3-compatible</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                        {repoType === "local" && (
                            <Alert>
                                <AlertDescription>
                                    Backups are stored in a <code className="text-sm">backups/</code> subdirectory within each stack's directory. No separate repository path is needed.
                                </AlertDescription>
                            </Alert>
                        )}
                        {repoType === "sftp" && (
                            <>
                                <div className="space-y-1">
                                    <Label htmlFor="repoPath">Repository path</Label>
                                    <Input
                                        id="repoPath"
                                        value={repoPath}
                                        onChange={(e) => setRepoPath(e.target.value)}
                                        placeholder="/backups"
                                    />
                                </div>
                                <div className="space-y-1">
                                    <Label htmlFor="sftpHost">Host</Label>
                                    <Input
                                        id="sftpHost"
                                        value={sftpHost}
                                        onChange={(e) => setSftpHost(e.target.value)}
                                        placeholder="backup.example.com"
                                    />
                                </div>
                                <div className="space-y-1">
                                    <Label htmlFor="sftpUser">Username</Label>
                                    <Input
                                        id="sftpUser"
                                        value={sftpUser}
                                        onChange={(e) => setSftpUser(e.target.value)}
                                        placeholder="backup-user"
                                    />
                                </div>
                                <div className="space-y-1">
                                    <Label htmlFor="sftpKey">
                                        Private key (PEM)
                                        {settings?.hasSftpKey && (
                                            <span className="ml-2 text-xs text-muted-foreground">(key saved)</span>
                                        )}
                                    </Label>
                                    <textarea
                                        id="sftpKey"
                                        className="flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                                        value={sftpKey}
                                        onChange={(e) => setSftpKey(e.target.value)}
                                        placeholder="-----BEGIN OPENSSH PRIVATE KEY-----"
                                    />
                                </div>
                            </>
                        )}
                        {repoType === "s3" && (
                            <>
                                <div className="space-y-1">
                                    <Label htmlFor="s3Endpoint">Endpoint URL</Label>
                                    <Input
                                        id="s3Endpoint"
                                        value={s3Endpoint}
                                        onChange={(e) => setS3Endpoint(e.target.value)}
                                        placeholder="https://s3.amazonaws.com"
                                    />
                                </div>
                                <div className="space-y-1">
                                    <Label htmlFor="s3Bucket">Bucket name</Label>
                                    <Input
                                        id="s3Bucket"
                                        value={s3Bucket}
                                        onChange={(e) => setS3Bucket(e.target.value)}
                                        placeholder="my-backup-bucket"
                                    />
                                </div>
                                <div className="space-y-1">
                                    <Label htmlFor="s3AccessKey">Access key ID</Label>
                                    <Input
                                        id="s3AccessKey"
                                        value={s3AccessKey}
                                        onChange={(e) => setS3AccessKey(e.target.value)}
                                        placeholder="AKIAIOSFODNN7EXAMPLE"
                                    />
                                </div>
                                <div className="space-y-1">
                                    <Label htmlFor="s3SecretKey">
                                        Secret access key
                                        {settings?.hasS3SecretKey && (
                                            <span className="ml-2 text-xs text-muted-foreground">(key saved)</span>
                                        )}
                                    </Label>
                                    <Input
                                        id="s3SecretKey"
                                        type="password"
                                        value={s3SecretKey}
                                        onChange={(e) => setS3SecretKey(e.target.value)}
                                        placeholder="wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY"
                                    />
                                </div>
                            </>
                        )}
                        <div className="space-y-1">
                            <Label htmlFor="resticPassword">
                                Restic password
                                {settings?.hasPassword && (
                                    <span className="ml-2 text-xs text-muted-foreground">(password saved)</span>
                                )}
                            </Label>
                            <Input
                                id="resticPassword"
                                type="password"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                placeholder="Enter encryption password"
                            />
                        </div>
                    </>
                )}
            </CardContent>
            <CardFooter className="flex items-center gap-4">
                <Button onClick={handleSave} disabled={saving || loading}>
                    {saving ? "Saving..." : "Save repository settings"}
                </Button>
                {resticStatus?.available && resticStatus.version && (
                    <Badge variant="secondary">restic {resticStatus.version}</Badge>
                )}
            </CardFooter>
        </Card>
    );
}

function BackupDefaultsCard() {
    const [defaultSchedule, setDefaultSchedule] = useState("");
    const [keepDaily, setKeepDaily] = useState("7");
    const [keepWeekly, setKeepWeekly] = useState("4");
    const [keepMonthly, setKeepMonthly] = useState("12");
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        getBackupDefaults()
            .then((data: BackupDefaults) => {
                setDefaultSchedule(data.defaultSchedule ?? "");
                if (data.defaultRetention) {
                    setKeepDaily(String(data.defaultRetention.keepDaily));
                    setKeepWeekly(String(data.defaultRetention.keepWeekly));
                    setKeepMonthly(String(data.defaultRetention.keepMonthly));
                }
                setLoading(false);
            })
            .catch(() => {
                setLoading(false);
            });
    }, []);

    const handleSave = () => {
        setSaving(true);
        const data = {
            defaultSchedule: defaultSchedule || null,
            defaultRetention: {
                keepDaily: Number(keepDaily),
                keepWeekly: Number(keepWeekly),
                keepMonthly: Number(keepMonthly),
            },
        };
        toast.promise(saveBackupDefaults(data).finally(() => setSaving(false)), {
            loading: "Saving...",
            success: "Default backup settings saved",
            error: "Failed to save",
        });
    };

    return (
        <Card>
            <CardHeader>
                <CardTitle>Default Backup Settings</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
                {loading ? (
                    <>
                        <div className="space-y-1">
                            <Skeleton className="h-4 w-32" />
                            <Skeleton className="h-9 w-full" />
                        </div>
                        <div className="grid grid-cols-3 gap-4">
                            {Array.from({length: 3}).map((_, i) => (
                                <div key={i} className="space-y-1">
                                    <Skeleton className="h-4 w-20" />
                                    <Skeleton className="h-9 w-full" />
                                </div>
                            ))}
                        </div>
                    </>
                ) : (
                    <>
                        <div className="space-y-1">
                            <Label htmlFor="defaultSchedule">Default schedule</Label>
                            <Input
                                id="defaultSchedule"
                                value={defaultSchedule}
                                onChange={(e) => setDefaultSchedule(e.target.value)}
                                placeholder="0 3 * * *"
                            />
                            <p className="text-xs text-muted-foreground">
                                5-field cron format (minute hour day month weekday)
                            </p>
                        </div>
                        <div className="grid grid-cols-3 gap-4">
                            <div className="space-y-1">
                                <Label htmlFor="keepDaily">Keep daily</Label>
                                <Input
                                    id="keepDaily"
                                    type="number"
                                    value={keepDaily}
                                    onChange={(e) => setKeepDaily(e.target.value)}
                                    placeholder="7"
                                />
                            </div>
                            <div className="space-y-1">
                                <Label htmlFor="keepWeekly">Keep weekly</Label>
                                <Input
                                    id="keepWeekly"
                                    type="number"
                                    value={keepWeekly}
                                    onChange={(e) => setKeepWeekly(e.target.value)}
                                    placeholder="4"
                                />
                            </div>
                            <div className="space-y-1">
                                <Label htmlFor="keepMonthly">Keep monthly</Label>
                                <Input
                                    id="keepMonthly"
                                    type="number"
                                    value={keepMonthly}
                                    onChange={(e) => setKeepMonthly(e.target.value)}
                                    placeholder="12"
                                />
                            </div>
                        </div>
                    </>
                )}
            </CardContent>
            <CardFooter>
                <Button onClick={handleSave} disabled={saving || loading}>
                    {saving ? "Saving..." : "Save defaults"}
                </Button>
            </CardFooter>
        </Card>
    );
}

export default function SettingsPage() {
    const {tab} = useParams<{tab: string}>();
    const navigate = useNavigate();
    const activeTab: Tab = VALID_TABS.includes(tab as Tab) ? (tab as Tab) : "general";

    const [instanceName, setInstanceName] = useState("");
    const [baseUrl, setBaseUrl] = useState("");
    const [timezone, setTimezone] = useState("UTC");
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [errors, setErrors] = useState<Record<string, string>>({});

    useEffect(() => {
        getGeneralSettings()
            .then((data) => {
                setInstanceName(data.instanceName);
                setBaseUrl(data.baseUrl);
                setTimezone(data.timezone);
                setLoading(false);
            })
            .catch(() => {
                setLoading(false);
            });
    }, []);

    const handleSaveGeneral = async () => {
        setErrors({});
        setSaving(true);
        try {
            const updated = await updateGeneralSettings({
                instanceName,
                baseUrl: baseUrl || undefined,
                timezone,
            });
            setInstanceName(updated.instanceName);
            setBaseUrl(updated.baseUrl);
            setTimezone(updated.timezone);
            toast.success("Settings saved");
        } catch (err) {
            if (err instanceof ApiError && err.status === 400) {
                const msg = err.message;
                if (msg.toLowerCase().includes("instance name")) {
                    setErrors({instanceName: msg});
                } else if (msg.toLowerCase().includes("base url") || msg.toLowerCase().includes("url")) {
                    setErrors({baseUrl: msg});
                } else if (msg.toLowerCase().includes("timezone")) {
                    setErrors({timezone: msg});
                } else {
                    setErrors({general: msg});
                }
            } else {
                toast.error("Failed to save settings");
            }
        } finally {
            setSaving(false);
        }
    };

    return (
        <Page>
            <PageHeader
                breadcrumbs={
                    <Breadcrumb>
                        <BreadcrumbList>
                            <BreadcrumbItem>
                                <BreadcrumbPage>Settings</BreadcrumbPage>
                            </BreadcrumbItem>
                        </BreadcrumbList>
                    </Breadcrumb>
                }
            >
                <div>
                    <PageTitle>Settings</PageTitle>
                    <PageDescription>Configure your Docktor instance</PageDescription>
                </div>
            </PageHeader>
            <PageContent>
                <Tabs value={activeTab} onValueChange={(v) => navigate(`/settings/${v}`)}>
                    <TabsList>
                        <TabsTrigger value="general">General</TabsTrigger>
                        <TabsTrigger value="notifications">Notifications</TabsTrigger>
                        <TabsTrigger value="backup">Backup</TabsTrigger>
                    </TabsList>
                    <TabsContent value="general">
                        <Card>
                            <CardHeader>
                                <CardTitle>General</CardTitle>
                            </CardHeader>
                            <CardContent className="space-y-4">
                                {loading ? (
                                    <>
                                        <div className="space-y-1">
                                            <Skeleton className="h-4 w-32" />
                                            <Skeleton className="h-9 w-full" />
                                        </div>
                                        <div className="space-y-1">
                                            <Skeleton className="h-4 w-24" />
                                            <Skeleton className="h-9 w-full" />
                                        </div>
                                        <div className="space-y-1">
                                            <Skeleton className="h-4 w-20" />
                                            <Skeleton className="h-9 w-full" />
                                        </div>
                                    </>
                                ) : (
                                    <>
                                        {errors.general && (
                                            <p className="text-sm text-destructive">{errors.general}</p>
                                        )}
                                        <div className="space-y-1">
                                            <Label htmlFor="instanceName">Instance Name</Label>
                                            <Input
                                                id="instanceName"
                                                value={instanceName}
                                                onChange={(e) => setInstanceName(e.target.value)}
                                                placeholder="Docktor"
                                            />
                                            {errors.instanceName && (
                                                <p className="text-sm text-destructive">{errors.instanceName}</p>
                                            )}
                                        </div>
                                        <div className="space-y-1">
                                            <Label htmlFor="baseUrl">Base URL</Label>
                                            <Input
                                                id="baseUrl"
                                                type="url"
                                                value={baseUrl}
                                                onChange={(e) => setBaseUrl(e.target.value)}
                                                placeholder="https://docktor.example.com"
                                            />
                                            {errors.baseUrl && (
                                                <p className="text-sm text-destructive">{errors.baseUrl}</p>
                                            )}
                                        </div>
                                        <div className="space-y-1">
                                            <Label>Timezone</Label>
                                            <TimezoneCombobox value={timezone} onChange={setTimezone} />
                                            {errors.timezone && (
                                                <p className="text-sm text-destructive">{errors.timezone}</p>
                                            )}
                                        </div>
                                    </>
                                )}
                            </CardContent>
                            <CardFooter>
                                <Button onClick={handleSaveGeneral} disabled={saving || loading}>
                                    {saving ? "Saving..." : "Save"}
                                </Button>
                            </CardFooter>
                        </Card>
                    </TabsContent>
                    <TabsContent value="notifications">
                        <div className="space-y-6">
                            <SmtpCard />
                            <NotificationTriggersCard />
                            <NotificationLogCard />
                        </div>
                    </TabsContent>
                    <TabsContent value="backup" className="space-y-6">
                        <BackupRepositoryCard />
                        <BackupDefaultsCard />
                    </TabsContent>
                </Tabs>
            </PageContent>
        </Page>
    );
}
