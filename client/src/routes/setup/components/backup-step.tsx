import {useState} from "react";
import {Button} from "@/components/ui/button";
import {Input} from "@/components/ui/input";
import {Label} from "@/components/ui/label";
import {Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle} from "@/components/ui/card";
import {Select, SelectContent, SelectItem, SelectTrigger, SelectValue} from "@/components/ui/select";
import {Alert, AlertDescription} from "@/components/ui/alert";
import type {WizardStep3Input} from "@docktor/shared";

interface BackupStepProps {
  onNext: (data: WizardStep3Input) => Promise<void>;
  onBack: () => void;
  onSkip: () => void;
  loading: boolean;
}

export function BackupStep({onNext, onBack, onSkip, loading}: Readonly<BackupStepProps>) {
  const [repoType, setRepoType] = useState<"local" | "sftp" | "s3" | "">("");
  const [repoPath, setRepoPath] = useState("");
  const [sftpHost, setSftpHost] = useState("");
  const [sftpUser, setSftpUser] = useState("");
  const [s3Endpoint, setS3Endpoint] = useState("");
  const [s3Bucket, setS3Bucket] = useState("");
  const [s3AccessKey, setS3AccessKey] = useState("");
  const [s3SecretKey, setS3SecretKey] = useState("");
  const [password, setPassword] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!repoType) {
      onSkip();
      return;
    }
    await onNext({
      repoType: repoType || null,
      repoPath: repoPath || null,
      sftpHost: sftpHost || null,
      sftpUser: sftpUser || null,
      s3Endpoint: s3Endpoint || null,
      s3Bucket: s3Bucket || null,
      s3AccessKey: s3AccessKey || null,
      s3SecretKey: s3SecretKey || null,
      password: password || null,
    });
  };

  return (
    <Card className="w-full max-w-md mx-auto">
      <CardHeader>
        <CardTitle>Backup Configuration</CardTitle>
        <CardDescription>
          Configure restic repository and password for automated backups.
          You can skip this and configure it later in Settings.
        </CardDescription>
      </CardHeader>
      <form onSubmit={handleSubmit}>
        <CardContent className="space-y-4">
          <div className="space-y-1">
            <Label htmlFor="repoType">Repository Type</Label>
            <Select value={repoType} onValueChange={(v) => setRepoType(v as "local" | "sftp" | "s3")}>
              <SelectTrigger id="repoType">
                <SelectValue placeholder="Select type (optional)..." />
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
                Backups are stored in a <code className="text-sm">backups/</code> subdirectory within each stack's directory.
              </AlertDescription>
            </Alert>
          )}

          {repoType === "sftp" && (
            <>
              <div className="space-y-1">
                <Label htmlFor="repoPath">Repository Path</Label>
                <Input id="repoPath" value={repoPath} onChange={(e) => setRepoPath(e.target.value)} placeholder="/backups" />
              </div>
              <div className="space-y-1">
                <Label htmlFor="sftpHost">Host</Label>
                <Input id="sftpHost" value={sftpHost} onChange={(e) => setSftpHost(e.target.value)} placeholder="backup.example.com" />
              </div>
              <div className="space-y-1">
                <Label htmlFor="sftpUser">Username</Label>
                <Input id="sftpUser" value={sftpUser} onChange={(e) => setSftpUser(e.target.value)} placeholder="backup-user" />
              </div>
            </>
          )}

          {repoType === "s3" && (
            <>
              <div className="space-y-1">
                <Label htmlFor="s3Endpoint">Endpoint URL</Label>
                <Input id="s3Endpoint" value={s3Endpoint} onChange={(e) => setS3Endpoint(e.target.value)} placeholder="https://s3.amazonaws.com" />
              </div>
              <div className="space-y-1">
                <Label htmlFor="s3Bucket">Bucket Name</Label>
                <Input id="s3Bucket" value={s3Bucket} onChange={(e) => setS3Bucket(e.target.value)} placeholder="my-backup-bucket" />
              </div>
              <div className="space-y-1">
                <Label htmlFor="s3AccessKey">Access Key ID</Label>
                <Input id="s3AccessKey" value={s3AccessKey} onChange={(e) => setS3AccessKey(e.target.value)} placeholder="AKIAIOSFODNN7EXAMPLE" />
              </div>
              <div className="space-y-1">
                <Label htmlFor="s3SecretKey">Secret Access Key</Label>
                <Input id="s3SecretKey" type="password" value={s3SecretKey} onChange={(e) => setS3SecretKey(e.target.value)} />
              </div>
            </>
          )}

          {repoType && (
            <div className="space-y-1">
              <Label htmlFor="resticPassword">Restic Password</Label>
              <Input id="resticPassword" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Encryption password" />
            </div>
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
    </Card>
  );
}
