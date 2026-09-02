import {apiFetch} from "./api";
import type {
  MigrationPreview,
  MigrationResult,
  ScanResult,
  VolumeSelection,
} from "./brownfield-types";

// Authenticated, post-setup counterpart of setup-api.ts's brownfield
// functions — drives /api/stacks/import/* (server/src/routes/imports.ts)
// instead of /api/setup/* (which 410s once the wizard is complete).

export function scanDirectories(directories: string[]) {
  return apiFetch<ScanResult>("/api/stacks/import/scan", {
    method: "POST",
    body: JSON.stringify({directories}),
  });
}

export function adoptStack(composePath: string, displayName: string) {
  return apiFetch<{id: string}>("/api/stacks/import/adopt", {
    method: "POST",
    body: JSON.stringify({composePath, displayName}),
  });
}

export function previewMigration(
  composePath: string,
  volumeSelections: VolumeSelection[],
  namedVolumeSelections: Record<string, boolean>,
) {
  return apiFetch<MigrationPreview>("/api/stacks/import/migrate/preview", {
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
  return apiFetch<MigrationResult>("/api/stacks/import/migrate", {
    method: "POST",
    body: JSON.stringify({composePath, displayName, volumeSelections, namedVolumeSelections}),
  });
}
