import {apiFetch} from "./api";
import type {
  WizardStep1Input,
  WizardStep2Input,
  WizardStep3Input,
  WizardStep4Input,
} from "@docktor/shared";
import type {
  MigrationPreview,
  MigrationResult,
  ScanResult,
  VolumeSelection,
} from "./brownfield-types";

export interface SetupStatus {
  setupComplete: boolean;
}

export interface Step1Result {
  user: {id: string; email: string; name: string | null};
  sessionToken: string;
}

export function checkSetupStatus() {
  return apiFetch<SetupStatus>("/api/setup/status");
}

// T-05-09: marks the wizard as fully complete so the server can permanently
// close /api/setup/* (beyond /status) again. Must be called once, at the
// very end of the wizard — see handleFinish/handleSkip(5) in setup.tsx.
export function completeSetup() {
  return apiFetch<{success: boolean}>("/api/setup/complete", {
    method: "POST",
  });
}

export function submitStep1(input: WizardStep1Input) {
  return apiFetch<Step1Result>("/api/setup/step1", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function submitStep2(input: WizardStep2Input) {
  return apiFetch<{success: boolean}>("/api/setup/step2", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function submitStep3(input: WizardStep3Input) {
  return apiFetch<{success: boolean}>("/api/setup/step3", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function submitStep4(input: WizardStep4Input) {
  return apiFetch<{success: boolean}>("/api/setup/step4", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function scanDirectories(directories: string[]) {
  return apiFetch<ScanResult>("/api/setup/scan", {
    method: "POST",
    body: JSON.stringify({directories}),
  });
}

export function adoptStack(composePath: string, displayName: string) {
  return apiFetch<{id: string}>("/api/setup/adopt", {
    method: "POST",
    body: JSON.stringify({composePath, displayName}),
  });
}

export function previewMigration(
  composePath: string,
  volumeSelections: VolumeSelection[],
  namedVolumeSelections: Record<string, boolean>,
) {
  return apiFetch<MigrationPreview>("/api/setup/migrate/preview", {
    method: "POST",
    body: JSON.stringify({composePath, volumeSelections, namedVolumeSelections}),
  });
}

export function executeMigration(
  composePath: string,
  displayName: string,
  volumeSelections: VolumeSelection[],
  namedVolumeSelections: Record<string, boolean>,
) {
  return apiFetch<MigrationResult>("/api/setup/migrate", {
    method: "POST",
    body: JSON.stringify({composePath, displayName, volumeSelections, namedVolumeSelections}),
  });
}
