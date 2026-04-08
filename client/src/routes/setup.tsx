import {useState, useEffect} from "react";
import {useNavigate, Link} from "react-router";
import {toast} from "sonner";
import {signIn} from "@/lib/auth-client";
import {checkSetupStatus, submitStep1, submitStep2, submitStep3, submitStep4} from "@/lib/setup-api";
import {WizardStepper} from "@/routes/setup/components/wizard-stepper";
import {Card, CardContent, CardDescription, CardHeader, CardTitle} from "@/components/ui/card";
import {Button} from "@/components/ui/button";
import type {WizardStep1Input, WizardStep2Input, WizardStep3Input, WizardStep4Input} from "@docktor/shared";

import {AccountStep} from "@/routes/setup/components/account-step";
import {SettingsStep} from "@/routes/setup/components/settings-step";
import {BackupStep} from "@/routes/setup/components/backup-step";
import {NotificationsStep} from "@/routes/setup/components/notifications-step";
// BrownfieldStep will be added by Plan 05-06
// import {BrownfieldStep} from "@/routes/setup/components/brownfield-step";

export default function SetupPage() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [setupComplete, setSetupComplete] = useState(false);
  const [currentStep, setCurrentStep] = useState(1);
  const [completedSteps, setCompletedSteps] = useState<Set<number>>(new Set());
  const [stepLoading, setStepLoading] = useState(false);

  useEffect(() => {
    checkSetupStatus()
      .then((status) => {
        setSetupComplete(status.setupComplete);
        setLoading(false);
      })
      .catch(() => {
        setLoading(false);
      });
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
    } catch (err: any) {
      toast.error(err.message || "Failed to create account");
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
    } catch (err: any) {
      toast.error(err.message || "Failed to save settings");
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
    } catch (err: any) {
      toast.error(err.message || "Failed to save backup settings");
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
    } catch (err: any) {
      toast.error(err.message || "Failed to save notification settings");
    } finally {
      setStepLoading(false);
    }
  };

  const handleSkip = (step: number) => {
    markStepComplete(step);
    if (step === 5) {
      navigate("/");
    } else {
      setCurrentStep(step + 1);
    }
  };

  const handleFinish = () => {
    markStepComplete(5);
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
        <Card className="w-full max-w-md mx-auto">
          <CardHeader>
            <CardTitle>Import Existing Stacks</CardTitle>
            <CardDescription>
              Brownfield import will be available after Plan 05-06 is complete.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setCurrentStep(4)}>Back</Button>
              <Button variant="ghost" onClick={() => handleSkip(5)}>Skip</Button>
              <Button onClick={handleFinish}>Finish Setup</Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
