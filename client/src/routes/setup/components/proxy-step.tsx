import {useForm} from "react-hook-form";
import {standardSchemaResolver} from "@hookform/resolvers/standard-schema";
import {wizardStep6Schema, type WizardStep6Input} from "@docktor/shared";
import {AlertTriangle} from "lucide-react";
import {Button} from "@/components/ui/button";
import {Input} from "@/components/ui/input";
import {Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle} from "@/components/ui/card";
import {Alert, AlertDescription} from "@/components/ui/alert";
import {Form, FormControl, FormField, FormItem, FormLabel, FormMessage} from "@/components/ui/form";

interface ProxyStepProps {
  onSubmit: (data: WizardStep6Input) => Promise<void>;
  onBack: () => void;
  onSkip: () => void;
  loading: boolean;
  // D-11: a failed deploy is surfaced here (raw server error, unwrapped) and
  // rendered inline rather than as a toast — the user stays on this step.
  deployError: string | null;
}

// Terminal, optional wizard step (D-09/D-10): offers the managed reverse
// proxy at first-run time. Submitting deploys the stack (never "Next" — see
// the primary CTA copy below); skipping deploys nothing and still completes
// the wizard.
export function ProxyStep({onSubmit, onBack, onSkip, loading, deployError}: Readonly<ProxyStepProps>) {
  const form = useForm<WizardStep6Input>({
    resolver: standardSchemaResolver(wizardStep6Schema),
    defaultValues: {acmeEmail: ""},
  });

  return (
    <Card className="w-full max-w-md mx-auto">
      <CardHeader>
        <CardTitle>Proxy</CardTitle>
        <CardDescription>
          Docktor can deploy and manage a reverse proxy that gives your services custom
          domains with automatic HTTPS. This needs host ports 80 and 443 free. You can
          skip this and configure it later in Settings.
        </CardDescription>
      </CardHeader>
      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)}>
          <CardContent className="space-y-4">
            <FormField
              control={form.control}
              name="acmeEmail"
              render={({field}) => (
                <FormItem>
                  <FormLabel className="font-semibold">ACME Email (optional)</FormLabel>
                  <FormControl>
                    <Input {...field} value={field.value ?? ""} type="email" placeholder="admin@example.com" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {deployError && (
              <Alert variant="destructive">
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription className="space-y-2">
                  <p>
                    Could not deploy the proxy stack — ports 80/443 are already in use.
                    Free the ports and try again.
                  </p>
                  <pre className="max-h-32 overflow-auto rounded bg-muted p-2 text-xs font-mono whitespace-pre-wrap">
                    {deployError}
                  </pre>
                </AlertDescription>
              </Alert>
            )}
          </CardContent>
          <CardFooter className="flex justify-between">
            <Button type="button" variant="outline" onClick={onBack}>Back</Button>
            <div className="flex gap-2">
              <Button type="button" variant="ghost" onClick={onSkip}>Skip</Button>
              <Button type="submit" disabled={loading}>
                {loading ? "Deploying..." : "Deploy Proxy Stack"}
              </Button>
            </div>
          </CardFooter>
        </form>
      </Form>
    </Card>
  );
}
