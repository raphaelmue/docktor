import {Button} from "@/components/ui/button";
import {BrownfieldImport} from "@/components/domain/stack/brownfield-import";
import {scanDirectories, adoptStack, previewMigration, executeMigration} from "@/lib/setup-api";

interface BrownfieldStepProps {
  onBack: () => void;
  onSkip: () => void;
  // 06-06: Import is no longer the wizard's terminal step (Proxy is) — this
  // now advances to step 6 rather than finishing the wizard. Prop kept as
  // onFinish to minimize churn; its contract is simply "proceed past this
  // step."
  onFinish: () => void;
}

// Thin wizard wrapper around the shared BrownfieldImport component, wired to
// setup-api.ts (/api/setup/*, reachable only while the wizard is
// incomplete). Owns only the wizard-specific Back/Skip/Next footer — every
// other behaviour (scan/adopt/migrate) lives in BrownfieldImport.
export function BrownfieldStep({onBack, onSkip, onFinish}: Readonly<BrownfieldStepProps>) {
  return (
    <div className="w-full max-w-3xl mx-auto space-y-4">
      <BrownfieldImport
        api={{scanDirectories, adoptStack, previewMigration, executeMigration}}
      />
      <div className="flex justify-between">
        <Button type="button" variant="outline" onClick={onBack}>
          Back
        </Button>
        <div className="flex gap-2">
          <Button type="button" variant="ghost" onClick={onSkip}>
            Skip
          </Button>
          <Button type="button" onClick={onFinish}>
            Next
          </Button>
        </div>
      </div>
    </div>
  );
}
