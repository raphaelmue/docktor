---
phase: 05-onboarding
plan: 05
subsystem: wizard-ui
tags: [wizard, api-client, stepper, routing]
dependency_graph:
  requires: [05-01-wizard-schemas, 05-03-onboarding-service]
  provides: [setup-api-client, wizard-stepper-ui, setup-page-shell]
  affects: [client-routing]
tech_stack:
  added: []
  patterns: [react-state-management, better-auth-integration, api-client-pattern]
key_files:
  created:
    - client/src/lib/setup-api.ts
    - client/src/routes/setup/components/wizard-stepper.tsx
    - client/src/routes/setup.tsx
  modified:
    - client/src/main.tsx
decisions:
  - title: "Custom WizardStepper component"
    rationale: "Built custom numbered stepper following UI-SPEC design system instead of third-party dependency to avoid registry safety vetting gate and ensure full control over accessibility patterns"
    alternatives: ["shadcn community registry stepper (would require safety review)"]
  - title: "Placeholder step rendering"
    rationale: "Setup page shell ready with state management and navigation, but actual step form components deferred to Plan 05-07 for clear separation of concerns"
    alternatives: ["Implement all steps in this plan (violates single-responsibility)"]
  - title: "Auto-login after step 1"
    rationale: "User automatically logged in via better-auth after account creation to enable authenticated steps 2-5 without separate login flow"
    alternatives: ["Require manual login after account creation (poor UX)"]
metrics:
  duration_minutes: 7
  tasks_completed: 2
  files_created: 3
  files_modified: 1
  commits: 2
  loc_added: 399
---

# Phase 05 Plan 05: Setup Page Foundation

**One-liner:** Setup wizard API client, numbered stepper component, and page shell with state management and route registration ready for step components

## What Was Built

### Setup API Client (`client/src/lib/setup-api.ts`)
Complete TypeScript API client for all wizard endpoints following established `apiFetch` pattern from `stacks-api.ts`:

**Core wizard endpoints:**
- `checkSetupStatus()` — returns `{setupComplete: boolean}`
- `submitStep1()` through `submitStep4()` — per-step form submissions
- `scanDirectories()` — brownfield scan trigger
- `adoptStack()` — zero-downtime stack import
- `previewMigration()` and `executeMigration()` — full migration flow

**TypeScript interfaces:**
- `SetupStatus`, `Step1Result`, `ScanResult`, `DiscoveredStack`
- `VolumeSelection`, `MigrationPreview`, `MigrationResult`
- All interfaces ready for brownfield flow (Plan 05-07)

### WizardStepper Component (`client/src/routes/setup/components/wizard-stepper.tsx`)
Accessible numbered step indicator following 05-UI-SPEC design system:

**Features:**
- 5 numbered steps with titles: Account, Settings, Backup, Notifications, Import
- Visual states: completed (checkmark + primary color), current (primary color), inactive (muted)
- Connector lines between steps colored based on completion state
- Clickable navigation to completed or current steps
- Disabled future steps with `cursor-not-allowed`

**Accessibility:**
- `aria-label` on each step with completion and optional status
- `aria-current="step"` on active step
- `<nav>` wrapper with `aria-label="Setup wizard progress"`
- Proper button semantics with disabled state

### Setup Page Shell (`client/src/routes/setup.tsx`)
Main wizard orchestrator with state management and step handlers:

**State management:**
- `currentStep` (1-5) with navigation logic
- `completedSteps` Set for tracking progress
- `stepLoading` for async operation feedback
- `setupComplete` check on mount to prevent re-runs

**Step handlers:**
- `handleStep1` through `handleStep4` with async submission, toast feedback, auto-advance
- `handleStep1` includes auto-login via `signIn.email()` after account creation
- `handleSkip` for optional steps 3-5
- `handleFinish` for final navigation to dashboard
- `handleStepClick` for stepper navigation

**UI patterns:**
- Setup complete screen with "Go to Dashboard" CTA if users exist
- Loading state during setup status check
- Placeholder step rendering until Plan 05-07 adds actual form components
- Clean separation: page manages state, stepper handles navigation UI

### Route Registration (`client/src/main.tsx`)
Added `/setup` route **before** `ProtectedRoute` wrapper to ensure public access (no authentication required). Matches pattern of `/login` and `/signup` public routes.

## Deviations from Plan

None. Plan executed exactly as specified.

## Threat Model Compliance

**T-05-15 (Spoofing):** ✅ Mitigated
- `checkSetupStatus()` called on mount
- If `setupComplete: true`, shows "Setup Complete" message with dashboard link
- Wizard UI not rendered if setup already done

**T-05-17 (Tampering - step navigation):** ✅ Accepted
- Users can navigate back to completed steps via stepper (accepted risk per threat register)
- Future steps disabled until reached sequentially

## Dependencies Satisfied

**Requires:**
- ✅ 05-01: `WizardStep1Input` through `WizardStep4Input` types from `@docktor/shared`
- ✅ 05-03: Server endpoints `/api/setup/*` (called by API client; implementation in 05-06)

**Provides:**
- ✅ `setup-api.ts` for Plan 05-07 step components to import
- ✅ `WizardStepper` component for wizard UI
- ✅ Setup page shell ready to render step components from 05-07

## Testing Notes

**Manual verification completed:**
- ✅ TypeScript compilation passes (`yarn workspace @docktor/client tsc --noEmit`)
- ✅ All imports resolve correctly
- ✅ Route registered in correct position (public routes section)

**Integration testing deferred to Plan 05-08:**
- Setup page accessibility (stepper keyboard navigation, screen reader announcements)
- End-to-end wizard flow with actual step components
- Setup status check redirect behavior

## Next Steps

**Plan 05-06:** Implement server routes (`/api/setup/status`, `/api/setup/step1-4`) and `OnboardingService` with proper Zod validation

**Plan 05-07:** Build step form components (`AccountStep`, `SettingsStep`, `BackupStep`, `NotificationsStep`, `BrownfieldStep`) and wire into setup page shell

**Plan 05-08:** E2E wizard tests with full user flow from account creation through brownfield import

## Known Issues

None. Foundation ready for step components.

## Files Modified

| File | Lines Changed | Purpose |
|------|--------------|---------|
| `client/src/lib/setup-api.ts` | +119 | API client with all wizard endpoints |
| `client/src/routes/setup/components/wizard-stepper.tsx` | +80 | Numbered step indicator component |
| `client/src/routes/setup.tsx` | +197 | Wizard page shell with state management |
| `client/src/main.tsx` | +1 | Route registration for `/setup` |

## Commits

| Commit | Message | Files |
|--------|---------|-------|
| ff3e16f | feat(05-05): create setup API client with all wizard endpoints | `setup-api.ts` |
| 891a4e4 | feat(05-05): create wizard stepper and setup page shell with route | `wizard-stepper.tsx`, `setup.tsx`, `main.tsx` |

---

**Status:** ✅ Complete
**Duration:** 7 minutes
**Blocker:** None
