import {useState, useEffect} from "react";
import {useNavigate, Link} from "react-router";
import {toast} from "sonner";
import {signIn} from "@/lib/auth-client";
import {checkSetupStatus, completeSetup, submitStep1, submitStep2, submitStep3, submitStep4} from "@/lib/setup-api";
import {WizardStepper} from "@/routes/setup/components/wizard-stepper";
import {Card, CardContent, CardDescription, CardHeader, CardTitle} from "@/components/ui/card";
import {Button} from "@/components/ui/button";
import type {WizardStep1Input, WizardStep2Input, WizardStep3Input, WizardStep4Input} from "@docktor/shared";

import {AccountStep} from "@/routes/setup/components/account-step";
import {SettingsStep} from "@/routes/setup/components/settings-step";
import {BackupStep} from "@/routes/setup/components/backup-step";
import {NotificationsStep} from "@/routes/setup/components/notifications-step";
import {BrownfieldStep} from "@/routes/setup/components/brownfield-step";

export default function SetupPage() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [setupComplete, setSetupComplete] = useState(false);
  // WR-06: a failed status check must not silently fall through to
  // "setup incomplete" — that would render the full wizard (including
  // account creation) on an already-configured instance just because of a
  // transient network blip. Track the failure explicitly and show a
  // dedicated retry state instead.
  const [statusError, setStatusError] = useState(false);
  const [currentStep, setCurrentStep] = useState(1);
  const [completedSteps, setCompletedSteps] = useState<Set<number>>(new Set());
  const [stepLoading, setStepLoading] = useState(false);

  const loadSetupStatus = () => {
    setLoading(true);
    setStatusError(false);
    checkSetupStatus()
      .then((status) => {
        setSetupComplete(status.setupComplete);
        setLoading(false);
      })
      .catch(() => {
        setStatusError(true);
        setLoading(false);
      });
  };

  useEffect(() => {
    loadSetupStatus();
  }, []);

  const markStepComplete = (step: number) => {
    setCompletedSteps((prev) => new Set([...prev, step]));
  };

  const handleStep1 = async (data: WizardStep1Input) => {
    setStepLoading(true);
    try {
      await submitStep1(data);
      // Auto-login using better-auth
      await signIn.email({email: data.email, password: data.password});
      markStepComplete(1);
      setCurrentStep(2);
      toast.success("Account created successfully");
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to create account";
      toast.error(message);
    } finally {
      setStepLoading(false);
    }
  };

  const handleStep2 = async (data: WizardStep2Input) => {
    setStepLoading(true);
    try {
      await submitStep2(data);
      markStepComplete(2);
      setCurrentStep(3);
      toast.success("Settings saved");
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to save settings";
      toast.error(message);
    } finally {
      setStepLoading(false);
    }
  };

  const handleStep3 = async (data: WizardStep3Input) => {
    setStepLoading(true);
    try {
      await submitStep3(data);
      markStepComplete(3);
      setCurrentStep(4);
      toast.success("Backup settings saved");
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to save backup settings";
      toast.error(message);
    } finally {
      setStepLoading(false);
    }
  };

  const handleStep4 = async (data: WizardStep4Input) => {
    setStepLoading(true);
    try {
      await submitStep4(data);
      markStepComplete(4);
      setCurrentStep(5);
      toast.success("Notification settings saved");
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to save notification settings";
      toast.error(message);
    } finally {
      setStepLoading(false);
    }
  };

  // T-05-09: notify the server that the wizard is genuinely finished, so it
  // can permanently close /api/setup/* (beyond /status) again. The user has
  // already completed the wizard UI flow at this point, so a failure here
  // is surfaced but must not block navigation to the dashboard.
  const notifyWizardComplete = async () => {
    try {
      await completeSetup();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to finalize setup";
      toast.error(message);
    }
  };

  const handleSkip = async (step: number) => {
    markStepComplete(step);
    if (step === 5) {
      await notifyWizardComplete();
      navigate("/");
    } else {
      setCurrentStep(step + 1);
    }
  };

  const handleFinish = async () => {
    markStepComplete(5);
    await notifyWizardComplete();
    navigate("/");
  };

  const handleStepClick = (step: number) => {
    if (completedSteps.has(step) || step <= currentStep) {
      setCurrentStep(step);
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-muted-foreground">Loading...</p>
      </div>
    );
  }

  if (statusError) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Card className="w-full max-w-md">
          <CardHeader className="text-center">
            <CardTitle>Unable to Check Setup Status</CardTitle>
            <CardDescription>
              We couldn't reach the server to check whether setup has already
              been completed. Please check your connection and try again.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex justify-center">
            <Button onClick={loadSetupStatus}>Retry</Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (setupComplete) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Card className="w-full max-w-md">
          <CardHeader className="text-center">
            <CardTitle>Setup Complete</CardTitle>
            <CardDescription>
              Setup has already been completed.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex justify-center">
            <Button asChild>
              <Link to="/">Go to Dashboard</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-6">
      <h1 className="text-2xl font-bold mb-6">Setup Wizard</h1>

      <WizardStepper
        currentStep={currentStep}
        completedSteps={completedSteps}
        onStepClick={handleStepClick}
      />

      {currentStep === 1 && (
        <AccountStep onNext={handleStep1} loading={stepLoading} />
      )}
      {currentStep === 2 && (
        <SettingsStep
          onNext={handleStep2}
          onBack={() => setCurrentStep(1)}
          loading={stepLoading}
        />
      )}
      {currentStep === 3 && (
        <BackupStep
          onNext={handleStep3}
          onBack={() => setCurrentStep(2)}
          onSkip={() => handleSkip(3)}
          loading={stepLoading}
        />
      )}
      {currentStep === 4 && (
        <NotificationsStep
          onNext={handleStep4}
          onBack={() => setCurrentStep(3)}
          onSkip={() => handleSkip(4)}
          loading={stepLoading}
        />
      )}
      {currentStep === 5 && (
        <BrownfieldStep
          onBack={() => setCurrentStep(4)}
          onSkip={() => handleSkip(5)}
          onFinish={handleFinish}
        />
      )}
    </div>
  );
}
