import {useForm, type Resolver} from "react-hook-form";
import {standardSchemaResolver} from "@hookform/resolvers/standard-schema";
import {wizardStep4Schema, type WizardStep4Input} from "@docktor/shared";
import {Button} from "@/components/ui/button";
import {Input} from "@/components/ui/input";
import {Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle} from "@/components/ui/card";
import {Select, SelectContent, SelectItem, SelectTrigger, SelectValue} from "@/components/ui/select";
import {Form, FormControl, FormField, FormItem, FormLabel, FormMessage} from "@/components/ui/form";

interface NotificationsStepProps {
  onNext: (data: WizardStep4Input) => Promise<void>;
  onBack: () => void;
  onSkip: () => void;
  loading: boolean;
}

export function NotificationsStep({onNext, onBack, onSkip, loading}: Readonly<NotificationsStepProps>) {
  // WR-02: use react-hook-form + the shared Zod resolver (matching
  // AccountStep/SettingsStep) so server-side validation failures surface as
  // field-level errors instead of a single generic toast.
  const form = useForm<WizardStep4Input>({
    // Safe: wizardStep4Schema's `port` field uses z.coerce.number(), so the
    // resolver's pre-coercion input type doesn't structurally match
    // WizardStep4Input (the post-coercion output type) at the type level —
    // at runtime the resolver still coerces exactly to WizardStep4Input,
    // matching what the form actually submits.
    resolver: standardSchemaResolver(wizardStep4Schema) as Resolver<WizardStep4Input>,
    defaultValues: {
      host: "",
      port: 587,
      encryption: "starttls",
      username: "",
      password: "",
      from: "",
    },
  });

  return (
    <Card className="w-full max-w-md mx-auto">
      <CardHeader>
        <CardTitle>Email Notifications</CardTitle>
        <CardDescription>
          Set up SMTP settings to receive email alerts for stack errors and system warnings.
          You can skip this and configure it later in Settings.
        </CardDescription>
      </CardHeader>
      <Form {...form}>
        <form onSubmit={form.handleSubmit(onNext)}>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="host"
                render={({field}) => (
                  <FormItem>
                    <FormLabel>SMTP Host</FormLabel>
                    <FormControl>
                      <Input {...field} placeholder="smtp.gmail.com" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="port"
                render={({field}) => (
                  <FormItem>
                    <FormLabel>Port</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        {...field}
                        onChange={(e) => field.onChange(Number(e.target.value))}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="encryption"
                render={({field}) => (
                  <FormItem>
                    <FormLabel>Encryption</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl>
                        <SelectTrigger id="smtpEncryption">
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="none">None</SelectItem>
                        <SelectItem value="starttls">STARTTLS (587)</SelectItem>
                        <SelectItem value="ssl">SSL/TLS (465)</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="from"
                render={({field}) => (
                  <FormItem>
                    <FormLabel>From Address</FormLabel>
                    <FormControl>
                      <Input {...field} placeholder="Docktor <noreply@example.com>" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="username"
                render={({field}) => (
                  <FormItem>
                    <FormLabel>Username</FormLabel>
                    <FormControl>
                      <Input {...field} value={field.value ?? ""} placeholder="user@example.com" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="password"
                render={({field}) => (
                  <FormItem>
                    <FormLabel>Password</FormLabel>
                    <FormControl>
                      <Input type="password" {...field} value={field.value ?? ""} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
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
      </Form>
    </Card>
  );
}
