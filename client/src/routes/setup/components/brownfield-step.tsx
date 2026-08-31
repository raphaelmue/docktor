import {useState} from "react";
import {useNavigate} from "react-router";
import {toast} from "sonner";
import {Search, FolderOpen} from "lucide-react";
import {Button} from "@/components/ui/button";
import {Input} from "@/components/ui/input";
import {Label} from "@/components/ui/label";
import {Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle} from "@/components/ui/card";
import {Table, TableBody, TableCell, TableHead, TableHeader, TableRow} from "@/components/ui/table";
import {Skeleton} from "@/components/ui/skeleton";
import {CompatibilityBadge} from "./compatibility-badge";
import {MigrationWizard, type ConfirmMigrateParams} from "./migration-wizard";
import {scanDirectories, adoptStack, executeMigration, type DiscoveredStack} from "@/lib/setup-api";

interface BrownfieldStepProps {
  onBack: () => void;
  onSkip: () => void;
  onFinish: () => void;
}

export function BrownfieldStep({onBack, onSkip, onFinish}: Readonly<BrownfieldStepProps>) {
  const navigate = useNavigate();
  const [directories, setDirectories] = useState("/home, /opt, /srv");
  const [scanning, setScanning] = useState(false);
  const [scanned, setScanned] = useState(false);
  const [stacks, setStacks] = useState<DiscoveredStack[]>([]);
  const [skippedDirs, setSkippedDirs] = useState(0);
  const [adoptingId, setAdoptingId] = useState<string | null>(null);
  const [migratingStack, setMigratingStack] = useState<DiscoveredStack | null>(null);
  const [adoptedIds, setAdoptedIds] = useState<Set<string>>(new Set());

  const handleScan = async () => {
    const dirs = directories
      .split(",")
      .map((d) => d.trim())
      .filter((d) => d.length > 0);

    if (dirs.length === 0) {
      toast.error("Please enter at least one directory to scan");
      return;
    }

    setScanning(true);
    try {
      const result = await scanDirectories(dirs);
      setStacks(result.stacks);
      setSkippedDirs(result.skippedDirectories);
      setScanned(true);

      if (result.stacks.length === 0) {
        toast.info("No compose files found in the specified directories");
      } else {
        toast.success(`Found ${result.stacks.length} stack(s)`);
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Scan failed";
      toast.error(message);
    } finally {
      setScanning(false);
    }
  };

  const handleAdopt = async (stack: DiscoveredStack) => {
    const displayName = stack.directory.split("/").pop() || "imported-stack";
    setAdoptingId(stack.path);

    try {
      const result = await adoptStack(stack.path, displayName);
      toast.success(`${displayName} adopted successfully`, {
        action: {
          label: "View stack",
          onClick: () => navigate(`/stacks/${result.id}`),
        },
      });
      setAdoptedIds((prev) => new Set([...prev, stack.path]));
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to adopt stack";
      toast.error(message);
    } finally {
      setAdoptingId(null);
    }
  };

  // WR-09: migration execution now runs here (in the parent, which stays
  // mounted for the whole background migration) instead of inside
  // MigrationWizard, which closes/unmounts as soon as the user confirms.
  const handleConfirmMigrate = ({stack, displayName, volumeSelections, namedVolumeSelections}: ConfirmMigrateParams) => {
    toast.info(`Migrating ${displayName}...`);

    executeMigration(stack.path, displayName, volumeSelections, namedVolumeSelections)
      .then((result) => {
        if (result.success && result.stackId) {
          toast.success(`Migration complete! ${displayName} is now managed by Docktor`, {
            action: {
              label: "View stack",
              onClick: () => navigate(`/stacks/${result.stackId}`),
            },
          });
          setAdoptedIds((prev) => new Set([...prev, stack.path]));
        } else {
          toast.error(result.error || "Migration failed");
        }
      })
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : "Migration failed";
        toast.error(message);
      });
  };

  return (
    <>
      <Card className="w-full max-w-3xl mx-auto">
        <CardHeader>
          <CardTitle>Import Existing Stacks</CardTitle>
          <CardDescription>
            Scan your filesystem for existing Docker Compose stacks and adopt them into Docktor.
            You can skip this and import stacks later.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-2">
            <Label htmlFor="directories">Directories to Scan</Label>
            <div className="flex gap-2">
              <Input
                id="directories"
                value={directories}
                onChange={(e) => setDirectories(e.target.value)}
                placeholder="/home, /opt, /srv"
                className="flex-1"
              />
              <Button onClick={handleScan} disabled={scanning}>
                {scanning ? (
                  "Scanning..."
                ) : (
                  <>
                    <Search className="h-4 w-4 mr-2" />
                    Scan
                  </>
                )}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Enter comma-separated paths. System directories (/proc, /sys, /dev) are automatically excluded.
            </p>
          </div>

          {scanning && (
            <div className="space-y-2">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          )}

          {scanned && !scanning && stacks.length === 0 && (
            <div className="text-center py-8 border rounded-md">
              <FolderOpen className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
              <p className="text-sm font-semibold">No stacks found</p>
              <p className="text-sm text-muted-foreground mt-1">
                We couldn't find any docker-compose.yml files in the directories you specified.
                Check the paths and try again, or skip this step to set up stacks manually later.
              </p>
            </div>
          )}

          {scanned && !scanning && stacks.length > 0 && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-medium">Discovered Stacks ({stacks.length})</h3>
                {skippedDirs > 0 && (
                  <p className="text-xs text-muted-foreground">
                    {skippedDirs} director{skippedDirs === 1 ? "y" : "ies"} skipped (permission denied)
                  </p>
                )}
              </div>
              <div className="border rounded-md">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Directory</TableHead>
                      <TableHead>Services</TableHead>
                      <TableHead>Compatibility</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {stacks.map((stack) => {
                      const isAdopted = adoptedIds.has(stack.path);
                      const isAdopting = adoptingId === stack.path;

                      return (
                        <TableRow key={stack.path}>
                          <TableCell className="font-mono text-sm">
                            {stack.directory}
                          </TableCell>
                          <TableCell>{stack.serviceCount}</TableCell>
                          <TableCell>
                            <CompatibilityBadge
                              compatibility={stack.compatibility}
                              unsupportedFeatures={stack.unsupportedFeatures}
                            />
                          </TableCell>
                          <TableCell className="text-right">
                            {isAdopted ? (
                              <span className="text-sm text-green-600 dark:text-green-400">
                                Imported
                              </span>
                            ) : (
                              <div className="flex justify-end gap-2">
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => setMigratingStack(stack)}
                                  disabled={isAdopting}
                                >
                                  Migrate
                                </Button>
                                <Button
                                  size="sm"
                                  onClick={() => handleAdopt(stack)}
                                  disabled={isAdopting}
                                >
                                  {isAdopting ? "Adopting..." : "Adopt"}
                                </Button>
                              </div>
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
              <p className="text-xs text-muted-foreground">
                <strong>Green</strong> stacks can be adopted in-place safely.
                <strong> Yellow/red</strong> stacks should be migrated for full Docktor compatibility (backups, env editing).
              </p>
            </div>
          )}
        </CardContent>
        <CardFooter className="flex justify-between">
          <Button type="button" variant="outline" onClick={onBack}>
            Back
          </Button>
          <div className="flex gap-2">
            <Button type="button" variant="ghost" onClick={onSkip}>
              Skip
            </Button>
            <Button type="button" onClick={onFinish}>
              Finish Setup
            </Button>
          </div>
        </CardFooter>
      </Card>

      {migratingStack && (
        <MigrationWizard
          stack={migratingStack}
          open={true}
          onClose={() => setMigratingStack(null)}
          onConfirmMigrate={handleConfirmMigrate}
        />
      )}
    </>
  );
}
