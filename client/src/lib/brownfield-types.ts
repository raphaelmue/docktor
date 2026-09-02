// Shared DTOs for the brownfield scan/adopt/migrate flow. Both the setup
// wizard (client/src/lib/setup-api.ts, driving /api/setup/*) and the
// post-setup import page (client/src/lib/import-api.ts, driving
// /api/stacks/import/*) depend on these — this module has no opinion about
// which endpoints produced them.

export interface ScanResult {
  stacks: DiscoveredStack[];
  skippedDirectories: number;
}

export interface DiscoveredStack {
  path: string;
  directory: string;
  compatibility: "green" | "yellow" | "red";
  serviceCount: number;
  namedVolumes: string[];
  absolutePaths: string[];
  inlineEnvVars: boolean;
  unsupportedFeatures: string[];
}

export interface VolumeSelection {
  originalPath: string;
  newPath: string;
  convert: boolean;
}

export interface MigrationPreview {
  diff: string;
  extractedEnv: string;
}

export interface MigrationResult {
  success: boolean;
  stackId?: string;
  error?: string;
  originalPath: string;
}
