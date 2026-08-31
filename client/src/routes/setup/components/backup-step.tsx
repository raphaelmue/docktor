import {useForm} from "react-hook-form";
import {standardSchemaResolver} from "@hookform/resolvers/standard-schema";
import {wizardStep3Schema, type WizardStep3Input} from "@docktor/shared";
import {Button} from "@/components/ui/button";
import {Input} from "@/components/ui/input";
import {Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle} from "@/components/ui/card";
import {Select, SelectContent, SelectItem, SelectTrigger, SelectValue} from "@/components/ui/select";
import {Alert, AlertDescription} from "@/components/ui/alert";
import {Form, FormControl, FormField, FormItem, FormLabel, FormMessage} from "@/components/ui/form";

interface BackupStepProps {
  onNext: (data: WizardStep3Input) => Promise<void>;
  onBack: () => void;
  onSkip: () => void;
  loading: boolean;
}

export function BackupStep({onNext, onBack, onSkip, loading}: Readonly<BackupStepProps>) {
  // WR-02: use react-hook-form + the shared Zod resolver (matching
  // AccountStep/SettingsStep) so server-side validation failures surface as
  // field-level errors instead of a single generic toast.
  const form = useForm<WizardStep3Input>({
    resolver: standardSchemaResolver(wizardStep3Schema),
    defaultValues: {
      repoType: "local",
      repoPath: "",
      sftpHost: "",
      sftpUser: "",
      s3Endpoint: "",
      s3Bucket: "",
      s3AccessKey: "",
      s3SecretKey: "",
      password: "",
    },
  });

  const repoType = form.watch("repoType");

  return (
    <Card className="w-full max-w-md mx-auto">
      <CardHeader>
        <CardTitle>Backup Configuration</CardTitle>
        <CardDescription>
          Configure restic repository and password for automated backups.
          You can skip this and configure it later in Settings.
        </CardDescription>
      </CardHeader>
      <Form {...form}>
        <form onSubmit={form.handleSubmit(onNext)}>
          <CardContent className="space-y-4">
            <FormField
              control={form.control}
              name="repoType"
              render={({field}) => (
                <FormItem>
                  <FormLabel>Repository Type</FormLabel>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <FormControl>
                      <SelectTrigger id="repoType">
                        <SelectValue placeholder="Select type..." />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="local">Local</SelectItem>
                      <SelectItem value="sftp">SFTP</SelectItem>
                      <SelectItem value="s3">S3-compatible</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            {repoType === "local" && (
              <Alert>
                <AlertDescription>
                  Backups are stored in a <code className="text-sm">backups/</code> subdirectory within each stack's directory.
                </AlertDescription>
              </Alert>
            )}

            {repoType === "sftp" && (
              <>
                <FormField
                  control={form.control}
                  name="repoPath"
                  render={({field}) => (
                    <FormItem>
                      <FormLabel>Repository Path</FormLabel>
                      <FormControl>
                        <Input {...field} value={field.value ?? ""} placeholder="/backups" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="sftpHost"
                  render={({field}) => (
                    <FormItem>
                      <FormLabel>Host</FormLabel>
                      <FormControl>
                        <Input {...field} value={field.value ?? ""} placeholder="backup.example.com" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="sftpUser"
                  render={({field}) => (
                    <FormItem>
                      <FormLabel>Username</FormLabel>
                      <FormControl>
                        <Input {...field} value={field.value ?? ""} placeholder="backup-user" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </>
            )}

            {repoType === "s3" && (
              <>
                <FormField
                  control={form.control}
                  name="s3Endpoint"
                  render={({field}) => (
                    <FormItem>
                      <FormLabel>Endpoint URL</FormLabel>
                      <FormControl>
                        <Input {...field} value={field.value ?? ""} placeholder="https://s3.amazonaws.com" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="s3Bucket"
                  render={({field}) => (
                    <FormItem>
                      <FormLabel>Bucket Name</FormLabel>
                      <FormControl>
                        <Input {...field} value={field.value ?? ""} placeholder="my-backup-bucket" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="s3AccessKey"
                  render={({field}) => (
                    <FormItem>
                      <FormLabel>Access Key ID</FormLabel>
                      <FormControl>
                        <Input {...field} value={field.value ?? ""} placeholder="AKIAIOSFODNN7EXAMPLE" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="s3SecretKey"
                  render={({field}) => (
                    <FormItem>
                      <FormLabel>Secret Access Key</FormLabel>
                      <FormControl>
                        <Input type="password" {...field} value={field.value ?? ""} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </>
            )}

            {repoType && (
              <FormField
                control={form.control}
                name="password"
                render={({field}) => (
                  <FormItem>
                    <FormLabel>Restic Password</FormLabel>
                    <FormControl>
                      <Input type="password" {...field} value={field.value ?? ""} placeholder="Encryption password" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}
          </CardContent>
          <CardFooter className="flex justify-between">
            <Button type="button" variant="outline" onClick={onBack}>Back</Button>
            <div className="flex gap-2">
              <Button type="button" variant="ghost" onClick={onSkip}>Skip</Button>
              <Button type="submit" disabled={loading}>
                {loading ? "Saving..." : "Next"}
              </Button>
            </div>
          </CardFooter>
        </form>
      </Form>
    </Card>
  );
}
