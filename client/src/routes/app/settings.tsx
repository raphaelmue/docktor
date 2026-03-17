import {useEffect, useRef, useState} from "react";
import {useNavigate, useParams} from "react-router";
import {Check, ChevronsUpDown} from "lucide-react";
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
import {getGeneralSettings, updateGeneralSettings} from "@/lib/settings-api";
import {
    getSmtpSettings, saveSmtpSettings, testSmtp,
    getNotificationTriggers, updateNotificationTriggers,
    getNotifications, type NotificationEntry,
} from "@/lib/notifications-api";
import {ApiError} from "@/lib/api";
import {cn} from "@/lib/utils";

const TIMEZONES = Intl.supportedValuesOf("timeZone");
const VALID_TABS = ["general", "notifications"] as const;
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
    // When hasExistingPassword=true and smtpPassword="", we show a placeholder.
    // On focus we clear the placeholder so the user can type a new password.
    const [smtpPassword, setSmtpPassword] = useState("");
    const [hasExistingPassword, setHasExistingPassword] = useState(false);
    const [passwordIsPlaceholder, setPasswordIsPlaceholder] = useState(false);
    const [smtpFrom, setSmtpFrom] = useState("");
    const [smtpRecipient, setSmtpRecipient] = useState("");
    const [testRecipient, setTestRecipient] = useState("");
    const [smtpLoading, setSmtpLoading] = useState(true);
    const [smtpSaving, setSmtpSaving] = useState(false);
    const [smtpTesting, setSmtpTesting] = useState(false);
    const [smtpErrors, setSmtpErrors] = useState<Record<string, string>>({});
    const passwordRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        getSmtpSettings()
            .then((data) => {
                setSmtpHost(data.host);
                setSmtpPort(data.port);
                setSmtpEncryption(data.encryption);
                setSmtpUsername(data.username);
                setSmtpFrom(data.from);
                setSmtpRecipient(data.recipient);
                setTestRecipient(data.recipient);
                setHasExistingPassword(data.hasPassword);
                setPasswordIsPlaceholder(data.hasPassword);
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
                password: passwordIsPlaceholder ? "" : smtpPassword,
                from: smtpFrom,
                recipient: smtpRecipient || undefined,
            });
            if (!passwordIsPlaceholder && smtpPassword) {
                setHasExistingPassword(true);
                setPasswordIsPlaceholder(true);
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
                password: passwordIsPlaceholder ? "" : smtpPassword,
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
                                    ref={passwordRef}
                                    type="password"
                                    value={passwordIsPlaceholder ? "placeholder" : smtpPassword}
                                    onFocus={() => {
                                        if (passwordIsPlaceholder) {
                                            setPasswordIsPlaceholder(false);
                                            setSmtpPassword("");
                                        }
                                    }}
                                    onChange={(e) => {
                                        setPasswordIsPlaceholder(false);
                                        setSmtpPassword(e.target.value);
                                    }}
                                    placeholder={hasExistingPassword ? "" : "Enter password"}
                                />
                            </div>
                        </div>
                        <div className="space-y-1">
                            <Label htmlFor="smtpRecipient">Recipient</Label>
                            <Input
                                id="smtpRecipient"
                                type="email"
                                value={smtpRecipient}
                                onChange={(e) => setSmtpRecipient(e.target.value)}
                                placeholder="admin@example.com"
                            />
                            <p className="text-xs text-muted-foreground">Where notification emails are sent. Also used as the default test recipient.</p>
                            {smtpErrors.recipient && <p className="text-sm text-destructive">{smtpErrors.recipient}</p>}
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
    const [triggersLoading, setTriggersLoading] = useState(true);

    useEffect(() => {
        getNotificationTriggers()
            .then((data) => {
                setStackError(data.stackError);
                setDiskWarning(data.diskWarning);
                setTriggersLoading(false);
            })
            .catch(() => {
                setTriggersLoading(false);
            });
    }, []);

    const handleToggle = async (key: "stackError" | "diskWarning", value: boolean) => {
        const prev = key === "stackError" ? stackError : diskWarning;
        if (key === "stackError") setStackError(value);
        else setDiskWarning(value);
        try {
            await updateNotificationTriggers({[key]: value});
            toast.success("Notification settings saved");
        } catch {
            if (key === "stackError") setStackError(prev);
            else setDiskWarning(prev);
            toast.error("Failed to update notification settings");
        }
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
                    </>
                )}
            </CardContent>
        </Card>
    );
}

function NotificationLogCard() {
    const [notifications, setNotifications] = useState<NotificationEntry[]>([]);
    const [logLoading, setLogLoading] = useState(true);

    useEffect(() => {
        getNotifications()
            .then((data) => {
                setNotifications(data);
                setLogLoading(false);
            })
            .catch(() => {
                setLogLoading(false);
            });
    }, []);

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
                </Tabs>
            </PageContent>
        </Page>
    );
}
