import {cn} from "@/lib/utils";
import {Check} from "lucide-react";

interface WizardStepperProps {
  currentStep: number;
  completedSteps: Set<number>;
  onStepClick: (step: number) => void;
}

const STEPS = [
  {number: 1, title: "Account", required: true},
  {number: 2, title: "Settings", required: true},
  {number: 3, title: "Backup", required: false},
  {number: 4, title: "Notifications", required: false},
  {number: 5, title: "Import", required: false},
];

export function WizardStepper({currentStep, completedSteps, onStepClick}: Readonly<WizardStepperProps>) {
  return (
    <nav aria-label="Setup wizard progress" className="mb-8">
      <ol className="flex items-center justify-center gap-4">
        {STEPS.map((step, index) => {
          const isCompleted = completedSteps.has(step.number);
          const isCurrent = currentStep === step.number;
          const isClickable = isCompleted || step.number <= currentStep;

          return (
            <li key={step.number} className="flex items-center">
              {index > 0 && (
                <div
                  className={cn(
                    "w-12 h-0.5 mr-4",
                    isCompleted || step.number < currentStep
                      ? "bg-primary"
                      : "bg-border"
                  )}
                  aria-hidden="true"
                />
              )}
              <button
                type="button"
                onClick={() => isClickable && onStepClick(step.number)}
                disabled={!isClickable}
                className={cn(
                  "flex flex-col items-center gap-1 transition-colors",
                  isClickable ? "cursor-pointer" : "cursor-not-allowed opacity-50"
                )}
                aria-current={isCurrent ? "step" : undefined}
                aria-label={`Step ${step.number}: ${step.title}${isCompleted ? " (completed)" : ""}${!step.required ? " (optional)" : ""}`}
              >
                <span
                  className={cn(
                    "flex items-center justify-center w-8 h-8 rounded-full text-sm font-medium transition-colors",
                    isCompleted
                      ? "bg-primary text-primary-foreground"
                      : isCurrent
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted text-muted-foreground"
                  )}
                >
                  {isCompleted ? (
                    <Check className="w-4 h-4" aria-hidden="true" />
                  ) : (
                    step.number
                  )}
                </span>
                <span
                  className={cn(
                    "text-sm",
                    isCurrent ? "font-medium text-foreground" : "text-muted-foreground"
                  )}
                >
                  {step.title}
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
