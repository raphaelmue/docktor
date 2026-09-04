import {useEffect, useState} from "react";
import {useForm} from "react-hook-form";
import {standardSchemaResolver} from "@hookform/resolvers/standard-schema";
import {toast} from "sonner";
import {AlertTriangle} from "lucide-react";
import {proxySettingsSchema, type ProxySettingsInput} from "@docktor/shared";

import {deployProxyStack, getProxySettings, saveProxySettings, type ProxyState} from "@/lib/proxy-api";
import {Card, CardContent, CardFooter, CardHeader, CardTitle} from "@/components/ui/card";
import {Button} from "@/components/ui/button";
import {Input} from "@/components/ui/input";
import {Switch} from "@/components/ui/switch";
import {Skeleton} from "@/components/ui/skeleton";
import {Alert, AlertDescription} from "@/components/ui/alert";
import {ScrollArea} from "@/components/ui/scroll-area";
import {Form, FormControl, FormField, FormItem, FormLabel, FormMessage} from "@/components/ui/form";

// This is a new directory: settings.tsx is a CLAUDE.md-listed refactoring
// target already past 1100 lines with four cards defined inline — the proxy
// card is authored as its own file from the start rather than added to the
// monolith (per 06-PATTERNS.md).
export function ProxySettingsCard() {
    const [state, setState] = useState<ProxyState | null>(null);
    const [loading, setLoading] = useState(true);
    const [deploying, setDeploying] = useState(false);
    const [deployError, setDeployError] = useState<string | null>(null);

    const form = useForm<ProxySettingsInput>({
        resolver: standardSchemaResolver(proxySettingsSchema),
        defaultValues: {acmeEmail: "", showInDashboard: false},
    });

    useEffect(() => {
        let cancelled = false;

        async function load() {
            setLoading(true);
            try {
                const data = await getProxySettings();
                if (cancelled) return;
                setState(data);
                form.reset({acmeEmail: data.acmeEmail, showInDashboard: data.showInDashboard});
            } catch {
                // silently fail — mirrors backup-config-card.tsx's load effect
            } finally {
                if (!cancelled) setLoading(false);
            }
        }

        void load();
        return () => {
            cancelled = true;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    function handleSave(data: ProxySettingsInput) {
        toast.promise(
            saveProxySettings({
                acmeEmail: data.acmeEmail ?? "",
                showInDashboard: data.showInDashboard ?? false,
            }),
            {
                loading: "Saving...",
                success: "Proxy settings saved",
                error: (err: Error) => err?.message ?? "Save failed",
            },
        );
    }

    async function handleDeploy() {
        setDeploying(true);
        setDeployError(null);
        try {
            const next = await deployProxyStack();
            setState(next);
        } catch (err) {
            setDeployError(err instanceof Error ? err.message : String(err));
        } finally {
            setDeploying(false);
        }
    }

    if (loading || state === null) {
        return (
            <Card>
                <CardHeader>
                    <CardTitle>Proxy</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="space-y-1">
                        <Skeleton className="h-4 w-32" />
                        <Skeleton className="h-9 w-full" />
                    </div>
                    <Skeleton className="h-6 w-48" />
                </CardContent>
            </Card>
        );
    }

    return (
        <Card>
            <CardHeader>
                <CardTitle>Proxy</CardTitle>
            </CardHeader>
            <Form {...form}>
                <form onSubmit={form.handleSubmit(handleSave)}>
                    <CardContent className="space-y-4">
                        <FormField
                            control={form.control}
                            name="acmeEmail"
                            render={({field}) => (
                                <FormItem>
                                    <FormLabel className="font-semibold">ACME Email</FormLabel>
                                    <FormControl>
                                        <Input
                                            {...field}
                                            value={field.value ?? ""}
                                            type="email"
                                            placeholder="admin@example.com"
                                        />
                                    </FormControl>
                                    <FormMessage />
                                </FormItem>
                            )}
                        />

                        <FormField
                            control={form.control}
                            name="showInDashboard"
                            render={({field}) => (
                                <FormItem className="flex items-center gap-3 space-y-0">
                                    <FormControl>
                                        <Switch
                                            checked={field.value ?? false}
                                            onCheckedChange={field.onChange}
                                        />
                                    </FormControl>
                                    <FormLabel className="font-semibold">
                                        Show the proxy stack in the dashboard
                                    </FormLabel>
                                </FormItem>
                            )}
                        />

                        <div className="space-y-2">
                            <p className="text-sm text-muted-foreground">
                                {state.deployed
                                    ? `Proxy stack status: ${state.status ?? "unknown"}`
                                    : "The proxy stack is not deployed."}
                            </p>
                            {!state.deployed && (
                                <Button type="button" variant="outline" disabled={deploying} onClick={handleDeploy}>
                                    {deploying ? "Deploying..." : "Deploy Proxy Stack"}
                                </Button>
                            )}
                        </div>

                        {deployError && (
                            <Alert variant="destructive">
                                <AlertTriangle className="h-4 w-4" />
                                <AlertDescription className="space-y-2">
                                    <p>
                                        Could not deploy the proxy stack — ports 80/443 are already in use. Free
                                        the ports and try again.
                                    </p>
                                    <ScrollArea className="h-32 w-full rounded border">
                                        <pre className="whitespace-pre-wrap p-2 text-xs font-mono">
                                            {deployError}
                                        </pre>
                                    </ScrollArea>
                                </AlertDescription>
                            </Alert>
                        )}
                    </CardContent>
                    <CardFooter>
                        <Button type="submit">Save Proxy Settings</Button>
                    </CardFooter>
                </form>
            </Form>
        </Card>
    );
}
