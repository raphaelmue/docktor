---
phase: 05-onboarding
plan: 04
subsystem: migration-infrastructure
tags: [backend, yaml-rewriting, volume-migration, rollback-safety]
dependency_graph:
  requires: [05-02, 05-03]
  provides: [compose-rewriter, volume-migrator, migration-service]
  affects: [setup-routes]
tech_stack:
  added: []
  patterns: [repository-pattern, dependency-injection, spawn-orchestration]
key_files:
  created:
    - server/src/infrastructure/compose-rewriter.ts
    - server/src/infrastructure/volume-migrator.ts
    - server/src/application/migration-service.ts
  modified:
    - server/src/routes/setup.ts
decisions:
  - "ComposeRewriter uses yaml library parse/stringify for round-trip preservation"
  - "Named volumes converted to ./volumes/[name] bind mounts when selected"
  - "Inline env vars extracted to .env with ${VAR} references in compose"
  - "VolumeMigrator uses docker run alpine cp -a pattern for volume data copy"
  - "MigrationService creates /tmp backup before any destructive operations"
  - "Rollback restores original compose and restarts containers at original location"
  - "Stack creation uses repository pattern (not direct Prisma access)"
  - "z.record requires both key and value types in Zod (z.record(z.string(), z.boolean()))"
metrics:
  duration_minutes: 7
  tasks_completed: 2
  files_created: 3
  files_modified: 1
  commits: 2
  completed_at: "2026-04-08T15:16:43Z"
---

# Phase 05 Plan 04: Migration Infrastructure Summary

**One-liner:** Docker volume migration with YAML rewriting and automatic rollback on failure

## What Was Built

Implemented complete migration infrastructure for brownfield import flow: ComposeRewriter transforms YAML (volume path rewrites + env var extraction), VolumeMigrator copies data from Docker volumes to bind mounts, and MigrationService orchestrates the full stop → backup → copy → rewrite → deploy cycle with automatic rollback on any failure.

### Task 1: ComposeRewriter for YAML Transformation

**Commit:** 756ad81

Created `server/src/infrastructure/compose-rewriter.ts`:
- `rewrite()` method transforms compose YAML based on user volume selections
- Rewrites named volumes to `./volumes/[name]` bind mounts when conversion selected
- Extracts inline environment variables (object form) to .env format
- Replaces object env with array form using `${VAR}` references
- Marks unconverted named volumes as `external: true`
- `generateDiff()` method creates line-by-line diff for user preview
- Singleton export `composeRewriter` for DI

**Key pattern:** Uses `yaml` library (already installed) for parse/stringify round-trip, preserving YAML structure while modifying specific sections.

### Task 2: VolumeMigrator and MigrationService

**Commit:** ffecf69

Created `server/src/infrastructure/volume-migrator.ts`:
- `copyVolumeToBindMount()` uses alpine container pattern: `docker run --rm -v volumeName:/source:ro -v destPath:/dest alpine sh -c "cp -a /source/. /dest/"`
- `copyDirectory()` wraps fs.cp for bind mount data copy
- Singleton export `volumeMigrator`

Created `server/src/application/migration-service.ts`:
- `previewMigration()` returns diff and extracted env without executing
- `migrate()` orchestrates full flow with BF-05 rollback safety:
  1. Create backup of original directory to /tmp
  2. Stop containers at original location
  3. Create new stack directory with volumes/ subdir
  4. Copy named volumes using VolumeMigrator
  5. Copy bind mount data
  6. Rewrite compose file with ComposeRewriter
  7. Create stack record via StackRepository
  8. Deploy new stack with DockerExecutor
- On failure: delete incomplete stack, restore backup, restart original containers
- Constructor DI: DockerExecutor, VolumeMigrator, ComposeRewriter, StackFilesystem, StackRepository
- Singleton export `migrationService`

Updated `server/src/routes/setup.ts`:
- Added `POST /api/setup/migrate/preview` endpoint for diff preview
- Added `POST /api/setup/migrate` endpoint for migration execution
- Both endpoints convert `z.record(z.string(), z.boolean())` to `Map<string, boolean>`

**Repository pattern adherence:** Uses `stackRepository.create()` and `stackRepository.exists()` instead of direct Prisma access (CLAUDE.md compliance).

## Deviations from Plan

None — plan executed exactly as written.

## Requirements Satisfied

- **BF-04:** Full migration wizard infrastructure implemented (stop → copy → convert volumes → rewrite compose → restart)
- **BF-05:** Rollback on failure with backup restoration and original container restart

## Known Issues

None.

## Threat Surface Changes

No new threats beyond plan's threat model:
- **T-05-11 (Tampering):** composePath validated (exists check before migration)
- **T-05-12 (DoS):** Docker volume copy runs in alpine container with implicit limits
- **T-05-13 (Tampering):** Backup created before destructive ops, restore on failure
- **T-05-14 (Info Disclosure):** /tmp backup directory has timestamped unique name

## Integration Points

**Upstream dependencies (completed):**
- 05-02: BrownfieldScanner for compose discovery
- 05-03: OnboardingService for wizard orchestration

**Downstream consumers (to be implemented):**
- 05-06: Migration wizard UI (Step 1 volume selection, Step 2 diff preview)
- 05-07: Frontend setup wizard integration

**API contracts established:**
```typescript
POST /api/setup/migrate/preview
  body: { composePath, volumeSelections, namedVolumeSelections }
  response: { diff: string, extractedEnv: string }

POST /api/setup/migrate
  body: { composePath, displayName, volumeSelections, namedVolumeSelections }
  response: { success: boolean, stackId?: string, error?: string, originalPath: string }
```

## Testing Notes

**Verification performed:**
- TypeScript compilation: `yarn workspace @docktor/server tsc --noEmit` ✅
- All files type-check with strict mode

**Manual testing required:**
- Named volume copy (requires actual Docker volume)
- Bind mount copy (requires existing compose with bind mounts)
- Rollback scenario (simulate failure mid-migration)
- Docker compose stop/start at custom path

**Test coverage gaps:**
- Unit tests for ComposeRewriter (YAML transformation scenarios)
- Unit tests for VolumeMigrator (mock spawn, verify args)
- Integration test for full migration flow
- Integration test for rollback on failure

## Self-Check: PASSED

**Files created:**
- ✅ `server/src/infrastructure/compose-rewriter.ts` exists
- ✅ `server/src/infrastructure/volume-migrator.ts` exists
- ✅ `server/src/application/migration-service.ts` exists

**Files modified:**
- ✅ `server/src/routes/setup.ts` contains migration endpoints

**Commits:**
- ✅ `756ad81` exists: feat(05-04): implement ComposeRewriter for YAML transformation
- ✅ `ffecf69` exists: feat(05-04): implement VolumeMigrator and MigrationService with rollback

**Exports verified:**
- ✅ `composeRewriter` singleton exported
- ✅ `volumeMigrator` singleton exported
- ✅ `migrationService` singleton exported
- ✅ Migration routes registered in setup.ts
