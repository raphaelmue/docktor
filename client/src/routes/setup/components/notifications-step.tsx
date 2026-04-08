import {useState} from "react";
import {Button} from "@/components/ui/button";
import {Input} from "@/components/ui/input";
import {Label} from "@/components/ui/label";
import {Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle} from "@/components/ui/card";
import {Select, SelectContent, SelectItem, SelectTrigger, SelectValue} from "@/components/ui/select";
import type {WizardStep4Input} from "@docktor/shared";

interface NotificationsStepProps {
  onNext: (data: WizardStep4Input) => Promise<void>;
  onBack: () => void;
  onSkip: () => void;
  loading: boolean;
}

export function NotificationsStep({onNext, onBack, onSkip, loading}: Readonly<NotificationsStepProps>) {
  const [host, setHost] = useState("");
  const [port, setPort] = useState(587);
  const [encryption, setEncryption] = useState<"none" | "starttls" | "ssl">("starttls");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [from, setFrom] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!host) {
      onSkip();
      return;
    }
    await onNext({host, port, encryption, username, password, from});
  };

  return (
    <Card className="w-full max-w-md mx-auto">
      <CardHeader>
        <CardTitle>Email Notifications</CardTitle>
        <CardDescription>
          Set up SMTP settings to receive email alerts for stack errors and system warnings.
          You can skip this and configure it later in Settings.
        </CardDescription>
      </CardHeader>
      <form onSubmit={handleSubmit}>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <Label htmlFor="smtpHost">SMTP Host</Label>
              <Input id="smtpHost" value={host} onChange={(e) => setHost(e.target.value)} placeholder="smtp.gmail.com" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="smtpPort">Port</Label>
              <Input id="smtpPort" type="number" value={port} onChange={(e) => setPort(Number(e.target.value))} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <Label htmlFor="smtpEncryption">Encryption</Label>
              <Select value={encryption} onValueChange={(v) => setEncryption(v as "none" | "starttls" | "ssl")}>
                <SelectTrigger id="smtpEncryption">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None</SelectItem>
                  <SelectItem value="starttls">STARTTLS (587)</SelectItem>
                  <SelectItem value="ssl">SSL/TLS (465)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="smtpFrom">From Address</Label>
              <Input id="smtpFrom" value={from} onChange={(e) => setFrom(e.target.value)} placeholder="Docktor <noreply@example.com>" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <Label htmlFor="smtpUsername">Username</Label>
              <Input id="smtpUsername" value={username} onChange={(e) => setUsername(e.target.value)} placeholder="user@example.com" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="smtpPassword">Password</Label>
              <Input id="smtpPassword" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
            </div>
          </div>
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
