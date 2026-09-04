import {useState} from "react";
import {useForm} from "react-hook-form";
import {standardSchemaResolver} from "@hookform/resolvers/standard-schema";
import {wizardStep2Schema, type WizardStep2Input} from "@docktor/shared";
import {Check, ChevronsUpDown} from "lucide-react";
import {Button} from "@/components/ui/button";
import {Input} from "@/components/ui/input";
import {Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle} from "@/components/ui/card";
import {Form, FormControl, FormField, FormItem, FormLabel, FormMessage} from "@/components/ui/form";
import {Popover, PopoverContent, PopoverTrigger} from "@/components/ui/popover";
import {Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList} from "@/components/ui/command";
import {cn} from "@/lib/utils";

const TIMEZONES = Intl.supportedValuesOf("timeZone");

interface SettingsStepProps {
  onNext: (data: WizardStep2Input) => Promise<void>;
  onBack: () => void;
  loading: boolean;
}

export function SettingsStep({onNext, onBack, loading}: Readonly<SettingsStepProps>) {
  const [tzOpen, setTzOpen] = useState(false);

  const form = useForm<WizardStep2Input>({
    resolver: standardSchemaResolver(wizardStep2Schema),
    defaultValues: {
      instanceName: "Docktor",
      baseUrl: "",
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    },
  });

  return (
    <Card className="w-full max-w-md mx-auto">
      <CardHeader>
        <CardTitle>Configure Instance</CardTitle>
        <CardDescription>
          Set instance name, base URL, and timezone for your Docktor installation.
        </CardDescription>
      </CardHeader>
      <Form {...form}>
        <form onSubmit={form.handleSubmit(onNext)}>
          <CardContent className="space-y-4">
            <FormField
              control={form.control}
              name="instanceName"
              render={({field}) => (
                <FormItem>
                  <FormLabel>Instance Name</FormLabel>
                  <FormControl>
                    <Input placeholder="Docktor" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="baseUrl"
              render={({field}) => (
                <FormItem>
                  <FormLabel>Base URL (optional)</FormLabel>
                  <FormControl>
                    <Input type="url" placeholder="https://docktor.example.com" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="timezone"
              render={({field}) => (
                <FormItem>
                  <FormLabel>Timezone</FormLabel>
                  <Popover open={tzOpen} onOpenChange={setTzOpen}>
                    <PopoverTrigger asChild>
                      <FormControl>
                        <Button
                          variant="outline"
                          role="combobox"
                          className={cn("w-full justify-between", !field.value && "text-muted-foreground")}
                        >
                          {field.value || "Select timezone..."}
                          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                        </Button>
                      </FormControl>
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
                                onSelect={() => {
                                  form.setValue("timezone", tz);
                                  setTzOpen(false);
                                }}
                              >
                                <Check className={cn("mr-2 h-4 w-4", field.value === tz ? "opacity-100" : "opacity-0")} />
                                {tz}
                              </CommandItem>
                            ))}
                          </CommandGroup>
                        </CommandList>
                      </Command>
                    </PopoverContent>
                  </Popover>
                  <FormMessage />
                </FormItem>
              )}
            />
          </CardContent>
          <CardFooter className="flex justify-between">
            <Button type="button" variant="outline" onClick={onBack}>
              Back
            </Button>
            <Button type="submit" disabled={loading}>
              {loading ? "Saving..." : "Next"}
            </Button>
          </CardFooter>
        </form>
      </Form>
    </Card>
  );
}
