import {useState} from "react";
import {toast} from "sonner";
import {AlertTriangle} from "lucide-react";
import {Button} from "@/components/ui/button";
import {Input} from "@/components/ui/input";
import {Label} from "@/components/ui/label";
import {Checkbox} from "@/components/ui/checkbox";
import {Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle} from "@/components/ui/dialog";
import {Alert, AlertDescription} from "@/components/ui/alert";
import {DiffViewer} from "./diff-viewer";
import {previewMigration, type DiscoveredStack, type VolumeSelection} from "@/lib/setup-api";

export interface ConfirmMigrateParams {
  stack: DiscoveredStack;
  displayName: string;
  volumeSelections: VolumeSelection[];
  namedVolumeSelections: Record<string, boolean>;
}

interface MigrationWizardProps {
  stack: DiscoveredStack;
  open: boolean;
  onClose: () => void;
  // WR-09: migration execution (the async fetch + its toasts) now runs in
  // the parent (BrownfieldStep), which stays mounted for the whole
  // background migration — the dialog itself closes immediately on confirm
  // and must never update its own state afterward.
  onConfirmMigrate: (params: ConfirmMigrateParams) => void;
}

export function MigrationWizard({stack, open, onClose, onConfirmMigrate}: Readonly<MigrationWizardProps>) {
  const [step, setStep] = useState<1 | 2>(1);
  const [displayName, setDisplayName] = useState(stack.directory.split("/").pop() || "");
  const [loading, setLoading] = useState(false);

  // Volume selections state
  const [namedVolumeSelections, setNamedVolumeSelections] = useState<Record<string, boolean>>(() => {
    const selections: Record<string, boolean> = {};
    for (const vol of stack.namedVolumes) {
      selections[vol] = true; // Default: convert all named volumes
    }
    return selections;
  });

  const [bindMountSelections, setBindMountSelections] = useState<VolumeSelection[]>(() => {
    // For absolute paths, default to convert
    return stack.absolutePaths.map((path) => ({
      originalPath: path,
      newPath: `./volumes/${path.split("/").pop() || "data"}`,
      convert: true,
    }));
  });

  // Preview state
  const [previewDiff, setPreviewDiff] = useState("");
  const [previewEnv, setPreviewEnv] = useState("");

  const handleVolumeToggle = (volName: string, checked: boolean) => {
    setNamedVolumeSelections((prev) => ({...prev, [volName]: checked}));
  };

  const handleBindMountToggle = (index: number, checked: boolean) => {
    setBindMountSelections((prev) => {
      const updated = [...prev];
      updated[index] = {...updated[index], convert: checked};
      return updated;
    });
  };

  const handleNextToPreview = async () => {
    setLoading(true);
    try {
      const preview = await previewMigration(
        stack.path,
        bindMountSelections,
        namedVolumeSelections,
      );
      setPreviewDiff(preview.diff);
      setPreviewEnv(preview.extractedEnv);
      setStep(2);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to generate preview";
      toast.error(message);
    } finally {
      setLoading(false);
    }
  };

  const handleMigrate = () => {
    // WR-09: hand off to the parent and close immediately — this component
    // is about to unmount, so it must not perform (or await) any work that
    // would try to update its own state afterward. The parent stays mounted
    // for the whole background migration and owns the loading/toast UX.
    onConfirmMigrate({
      stack,
      displayName,
      volumeSelections: bindMountSelections,
      namedVolumeSelections,
    });
    handleClose();
  };

  const handleClose = () => {
    setStep(1);
    onClose();
  };

  // Parse diff for display
  const parseDiffForViewer = () => {
    const lines = previewDiff.split("\n");
    const original = lines.filter(l => l.startsWith("- ") || l.startsWith("  ")).map(l => l.slice(2)).join("\n");
    const modified = lines.filter(l => l.startsWith("+ ") || l.startsWith("  ")).map(l => l.slice(2)).join("\n");
    return {original, modified};
  };

  const {original, modified} = parseDiffForViewer();

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {step === 1 ? "Select Data to Migrate" : "Review Changes"}
          </DialogTitle>
          <DialogDescription>
            {step === 1
              ? "Choose which volumes and bind mounts to copy into Docktor's managed directory. Unchecked items will remain at their current location (not backed up)."
              : "Review the changes to your compose file and environment variables before migration."
            }
          </DialogDescription>
        </DialogHeader>

        {step === 1 && (
          <div className="space-y-6 py-4">
            <div className="space-y-2">
              <Label htmlFor="displayName">Stack Name</Label>
              <Input
                id="displayName"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="my-stack"
              />
            </div>

            {stack.namedVolumes.length > 0 && (
              <div className="space-y-3">
                <Label>Named Volumes</Label>
                {stack.namedVolumes.map((vol) => (
                  <div key={vol} className="flex items-start space-x-3">
                    <Checkbox
                      id={`vol-${vol}`}
                      checked={namedVolumeSelections[vol] ?? true}
                      onCheckedChange={(checked) => handleVolumeToggle(vol, !!checked)}
                    />
                    <div className="space-y-1">
                      <Label htmlFor={`vol-${vol}`} className="font-normal cursor-pointer">
                        {vol}
                      </Label>
                      {!namedVolumeSelections[vol] && (
                        <p className="text-xs text-yellow-600 dark:text-yellow-400 flex items-center gap-1">
                          <AlertTriangle className="h-3 w-3" />
                          This volume will remain a Docker volume (not backed up)
                        </p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {stack.absolutePaths.length > 0 && (
              <div className="space-y-3">
                <Label>Absolute Bind Mounts</Label>
                {bindMountSelections.map((sel, i) => (
                  <div key={sel.originalPath} className="flex items-start space-x-3">
                    <Checkbox
                      id={`bind-${i}`}
                      checked={sel.convert}
                      onCheckedChange={(checked) => handleBindMountToggle(i, !!checked)}
                    />
                    <div className="space-y-1">
                      <Label htmlFor={`bind-${i}`} className="font-normal cursor-pointer">
                        {sel.originalPath}
                      </Label>
                      <Alert className="py-1 px-2">
                        <AlertDescription className="text-xs flex items-center gap-1">
                          <AlertTriangle className="h-3 w-3 text-yellow-600" />
                          Absolute path - not recommended for Docktor
                        </AlertDescription>
                      </Alert>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {stack.inlineEnvVars && (
              <Alert>
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription>
                  This compose file has inline environment variables that will be extracted to a .env file.
                </AlertDescription>
              </Alert>
            )}
          </div>
        )}

        {step === 2 && (
          <div className="space-y-4 py-4">
            <DiffViewer
              originalContent={original || "Loading..."}
              modifiedContent={modified || "Loading..."}
              originalLabel="Original"
              modifiedLabel="Migrated"
            />

            {previewEnv && (
              <div className="space-y-2">
                <Label>New .env File</Label>
                <div className="rounded-md border bg-muted/50 p-4">
                  <pre className="text-xs font-mono whitespace-pre-wrap">{previewEnv}</pre>
                </div>
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          {step === 1 ? (
            <>
              <Button variant="outline" onClick={handleClose}>Cancel</Button>
              <Button onClick={handleNextToPreview} disabled={loading || !displayName}>
                {loading ? "Loading..." : "Next"}
              </Button>
            </>
          ) : (
            <>
              <Button variant="outline" onClick={() => setStep(1)}>Back</Button>
              <Button onClick={handleMigrate} disabled={loading}>
                {loading ? "Migrating..." : "Confirm & Migrate"}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
