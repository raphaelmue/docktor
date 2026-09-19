import {useEffect, useRef, useState} from "react";
import {useForm} from "react-hook-form";
import {standardSchemaResolver} from "@hookform/resolvers/standard-schema";
import {toast} from "sonner";
import {AlertTriangle, Trash2} from "lucide-react";
import {
    CERTIFICATE_EXPIRY_WARNING_DAYS,
    createCertificateSchema,
    type CreateCertificateInput,
} from "@docktor/shared";

import {
    deleteCertificate,
    getCertificates,
    uploadCertificate,
    type Certificate,
} from "@/lib/certificates-api";
import {Card, CardContent, CardHeader, CardTitle} from "@/components/ui/card";
import {Button} from "@/components/ui/button";
import {Input} from "@/components/ui/input";
import {Label} from "@/components/ui/label";
import {Badge} from "@/components/ui/badge";
import {Skeleton} from "@/components/ui/skeleton";
import {Alert, AlertDescription} from "@/components/ui/alert";
import {Table, TableBody, TableCell, TableHead, TableHeader, TableRow} from "@/components/ui/table";
import {Form, FormControl, FormField, FormItem, FormLabel, FormMessage} from "@/components/ui/form";
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

function formatExpiry(expiresAt: string | null): string {
    if (!expiresAt) return "Unknown";
    return new Date(expiresAt).toLocaleDateString();
}

function isExpiringSoon(expiresAt: string | null): boolean {
    if (!expiresAt) return false;
    const msUntilExpiry = new Date(expiresAt).getTime() - Date.now();
    const daysUntilExpiry = msUntilExpiry / (1000 * 60 * 60 * 24);
    return daysUntilExpiry <= CERTIFICATE_EXPIRY_WARNING_DAYS;
}

// This is a new directory: settings.tsx is a CLAUDE.md-listed refactoring
// target already past 1100 lines — the certificates card is authored as its
// own file from the start, matching proxy-settings-card.tsx's precedent,
// rather than added inline to the monolith.
export function CertificatesCard() {
    const [certificates, setCertificates] = useState<Certificate[] | null>(null);
    const [loading, setLoading] = useState(true);
    const [uploading, setUploading] = useState(false);
    const [uploadError, setUploadError] = useState<string | null>(null);
    const [certFileError, setCertFileError] = useState<string | null>(null);
    const [keyFileError, setKeyFileError] = useState<string | null>(null);
    const [certFile, setCertFile] = useState<File | null>(null);
    const [keyFile, setKeyFile] = useState<File | null>(null);
    const [bundleFile, setBundleFile] = useState<File | null>(null);
    const [deleteTarget, setDeleteTarget] = useState<Certificate | null>(null);
    const [deleteError, setDeleteError] = useState<string | null>(null);
    // Distinct from "certificates === [] " (zero certificates uploaded) — a
    // fetch failure (network error, 401, 500) must not be rendered as the
    // friendly empty-state copy, or a user who genuinely has certificates
    // sees "you have none" instead of a retry affordance (09-REVIEW.md IN-02).
    const [loadError, setLoadError] = useState<string | null>(null);

    const certFileInputRef = useRef<HTMLInputElement>(null);
    const keyFileInputRef = useRef<HTMLInputElement>(null);
    const bundleFileInputRef = useRef<HTMLInputElement>(null);

    const form = useForm<CreateCertificateInput>({
        resolver: standardSchemaResolver(createCertificateSchema),
        defaultValues: {domainPattern: ""},
    });

    async function fetchCertificates(isCancelled: () => boolean = () => false) {
        setLoading(true);
        setLoadError(null);
        try {
            const data = await getCertificates();
            if (isCancelled()) return;
            setCertificates(data);
        } catch (err) {
            if (!isCancelled()) {
                setLoadError(err instanceof Error ? err.message : "Failed to load certificates");
            }
        } finally {
            if (!isCancelled()) setLoading(false);
        }
    }

    useEffect(() => {
        let cancelled = false;
        void fetchCertificates(() => cancelled);
        return () => {
            cancelled = true;
        };
    }, []);

    async function reload() {
        const data = await getCertificates();
        setCertificates(data);
    }

    async function handleUpload(values: CreateCertificateInput) {
        setCertFileError(null);
        setKeyFileError(null);
        setUploadError(null);

        // File inputs are not covered by createCertificateSchema (only
        // domainPattern is), so their presence is validated explicitly here
        // rather than letting the request fail server-side.
        let hasFieldError = false;
        if (!certFile) {
            setCertFileError("Select the certificate file");
            hasFieldError = true;
        }
        if (!keyFile) {
            setKeyFileError("Select the private key file");
            hasFieldError = true;
        }
        if (hasFieldError) return;

        setUploading(true);
        try {
            // The File objects go straight into the upload call — their
            // contents are never read into component state.
            if (bundleFile) {
                await uploadCertificate(values.domainPattern, certFile!, keyFile!, bundleFile);
            } else {
                await uploadCertificate(values.domainPattern, certFile!, keyFile!);
            }
            toast.success("Certificate uploaded");
            form.reset({domainPattern: ""});
            setCertFile(null);
            setKeyFile(null);
            setBundleFile(null);
            if (certFileInputRef.current) certFileInputRef.current.value = "";
            if (keyFileInputRef.current) keyFileInputRef.current.value = "";
            if (bundleFileInputRef.current) bundleFileInputRef.current.value = "";
            await reload();
        } catch (err) {
            // The server rejects with a specific reason (mismatched key,
            // uncovered domain, unparseable content) — rendered verbatim so
            // the user knows exactly which of the three files is wrong.
            setUploadError(err instanceof Error ? err.message : String(err));
        } finally {
            setUploading(false);
        }
    }

    async function handleDelete(target: Certificate) {
        setDeleteError(null);
        try {
            await deleteCertificate(target.id);
            setDeleteTarget(null);
            await reload();
        } catch (err) {
            // A conflict names the domains still referencing this
            // certificate — rendered verbatim, not paraphrased.
            setDeleteError(err instanceof Error ? err.message : String(err));
        }
    }

    return (
        <>
            <Card>
                <CardHeader>
                    <CardTitle>Certificates</CardTitle>
                </CardHeader>
                <CardContent className="space-y-6">
                    {loading ? (
                        <div className="space-y-2">
                            <Skeleton className="h-9 w-full" />
                            <Skeleton className="h-9 w-full" />
                        </div>
                    ) : loadError ? (
                        <Alert variant="destructive">
                            <AlertTriangle className="h-4 w-4" />
                            <AlertDescription className="flex items-center justify-between gap-4">
                                <span>Failed to load certificates: {loadError}</span>
                                <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    onClick={() => void fetchCertificates()}
                                >
                                    Retry
                                </Button>
                            </AlertDescription>
                        </Alert>
                    ) : certificates === null || certificates.length === 0 ? (
                        <p className="text-sm text-muted-foreground">
                            No certificates uploaded yet. Once you upload one here, it becomes available to
                            select as a domain's certificate source when assigning a domain to a service.
                        </p>
                    ) : (
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Domain Pattern</TableHead>
                                    <TableHead>Expires</TableHead>
                                    <TableHead />
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {certificates.map((cert) => (
                                    <TableRow key={cert.id}>
                                        <TableCell>{cert.domainPattern}</TableCell>
                                        <TableCell>
                                            <div className="flex items-center gap-2">
                                                <span>{formatExpiry(cert.expiresAt)}</span>
                                                {isExpiringSoon(cert.expiresAt) && (
                                                    <Badge
                                                        variant="outline"
                                                        className="text-amber-600 border-amber-300"
                                                    >
                                                        Expiring soon
                                                    </Badge>
                                                )}
                                            </div>
                                        </TableCell>
                                        <TableCell>
                                            <Button
                                                variant="ghost"
                                                size="icon"
                                                aria-label={`Delete ${cert.domainPattern}`}
                                                onClick={() => setDeleteTarget(cert)}
                                            >
                                                <Trash2 className="h-4 w-4" />
                                            </Button>
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    )}

                    {deleteError && (
                        <Alert variant="destructive">
                            <AlertTriangle className="h-4 w-4" />
                            <AlertDescription>{deleteError}</AlertDescription>
                        </Alert>
                    )}

                    <Form {...form}>
                        <form onSubmit={form.handleSubmit(handleUpload)} className="space-y-4 border-t pt-4">
                            <FormField
                                control={form.control}
                                name="domainPattern"
                                render={({field}) => (
                                    <FormItem>
                                        <FormLabel className="font-semibold">Domain Pattern</FormLabel>
                                        <FormControl>
                                            <Input {...field} placeholder="*.example.com" />
                                        </FormControl>
                                        <p className="text-xs text-muted-foreground">
                                            A leading wildcard label is allowed — one wildcard certificate
                                            covers every subdomain under it.
                                        </p>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />

                            <div className="space-y-1">
                                <Label htmlFor="certificate-file" className="font-semibold">
                                    Certificate File
                                </Label>
                                <Input
                                    id="certificate-file"
                                    type="file"
                                    ref={certFileInputRef}
                                    onChange={(e) => setCertFile(e.target.files?.[0] ?? null)}
                                />
                                {certFileError && (
                                    <p className="text-sm text-destructive">{certFileError}</p>
                                )}
                            </div>

                            <div className="space-y-1">
                                <Label htmlFor="private-key-file" className="font-semibold">
                                    Private Key File
                                </Label>
                                <Input
                                    id="private-key-file"
                                    type="file"
                                    ref={keyFileInputRef}
                                    onChange={(e) => setKeyFile(e.target.files?.[0] ?? null)}
                                />
                                {keyFileError && (
                                    <p className="text-sm text-destructive">{keyFileError}</p>
                                )}
                            </div>

                            <div className="space-y-1">
                                <Label htmlFor="ca-bundle-file" className="font-semibold">
                                    CA Bundle (optional)
                                </Label>
                                <Input
                                    id="ca-bundle-file"
                                    type="file"
                                    ref={bundleFileInputRef}
                                    onChange={(e) => setBundleFile(e.target.files?.[0] ?? null)}
                                />
                                <p className="text-xs text-muted-foreground">
                                    Only needed when the issuer supplied a separate intermediate/CA chain
                                    file — Docktor combines it with the certificate for you.
                                </p>
                            </div>

                            {uploadError && (
                                <Alert variant="destructive">
                                    <AlertTriangle className="h-4 w-4" />
                                    <AlertDescription>{uploadError}</AlertDescription>
                                </Alert>
                            )}

                            <Button type="submit" disabled={uploading}>
                                {uploading ? "Uploading..." : "Upload Certificate"}
                            </Button>
                        </form>
                    </Form>
                </CardContent>
            </Card>

            <AlertDialog
                open={deleteTarget !== null}
                onOpenChange={(open) => {
                    if (!open) setDeleteTarget(null);
                }}
            >
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Delete certificate</AlertDialogTitle>
                        <AlertDialogDescription>
                            {deleteTarget &&
                                `Delete the certificate for ${deleteTarget.domainPattern}? It will no longer be available to select for any domain assignment.`}
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                            variant="destructive"
                            onClick={() => deleteTarget && handleDelete(deleteTarget)}
                        >
                            Delete
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </>
    );
}
