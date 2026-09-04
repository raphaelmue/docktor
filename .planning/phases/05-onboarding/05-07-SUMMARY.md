---
phase: 05-onboarding
plan: 07
subsystem: onboarding
tags: [wizard, ui, forms, validation]
completed: 2026-04-08T15:24:43Z
duration_minutes: 3

dependency_graph:
  requires: [05-05]
  provides: [wizard-step-forms]
  affects: [setup-wizard]

tech_stack:
  added: []
  patterns: [react-hook-form, zod-validation, conditional-rendering]

key_files:
  created:
    - client/src/routes/setup/components/account-step.tsx
    - client/src/routes/setup/components/settings-step.tsx
    - client/src/routes/setup/components/backup-step.tsx
    - client/src/routes/setup/components/notifications-step.tsx
  modified:
    - client/src/routes/setup.tsx

decisions:
  - decision: "AccountStep and SettingsStep use react-hook-form with Zod resolvers"
    rationale: "Consistent with existing form pattern from login-form.tsx; enables proper validation with error messages"
  - decision: "BackupStep and NotificationsStep use native form submission with manual state"
    rationale: "Optional steps with conditional fields benefit from simpler state management; skip logic is cleaner without form library"
  - decision: "Timezone picker reuses Popover + Command pattern from settings.tsx"
    rationale: "Established pattern for searchable dropdowns; consistent UX across wizard and settings"
  - decision: "Empty field submission in optional steps triggers skip action"
    rationale: "UX convenience - clicking Next without filling any fields implicitly skips the step"

metrics:
  tasks_completed: 3
  files_created: 4
  files_modified: 1
  commits: 3
  tests_added: 0
---

# Phase 05 Plan 07: Wizard Step Forms Summary

**One-liner:** Four wizard step form components (account, settings, backup, notifications) with validation, conditional fields, and skip functionality integrated into setup page.

## What Was Built

### Step Components Created

**1. AccountStep (Step 1 - Required)**
- Email and password form with validation
- Uses `wizardStep1Schema` from @docktor/shared
- react-hook-form + standardSchemaResolver pattern
- Inline validation on blur + submit
- Password minimum 8 characters, email format validation
- Full-width Next button (no Back - first step)

**2. SettingsStep (Step 2 - Required)**
- Instance name, base URL (optional), timezone configuration
- Uses `wizardStep2Schema` from @docktor/shared
- Timezone picker: Popover + Command combobox (reused from settings.tsx)
- Default instance name: "Docktor"
- Default timezone: User's current timezone from browser (`Intl.DateTimeFormat().resolvedOptions().timeZone`)
- Back and Next buttons

**3. BackupStep (Step 3 - Optional)**
- Restic backup repository configuration
- Reuses `backupSettingsSchema` (wizardStep3Schema) from Phase 4
- Repository type selector: Local, SFTP, S3-compatible
- Conditional field rendering:
  - Local: Alert message (no additional fields)
  - SFTP: Repository path, host, username
  - S3: Endpoint URL, bucket name, access key, secret key
- Restic password field (shown for all types)
- Back, Skip, Next buttons
- Skip behavior: Empty repoType triggers skip automatically on Next click

**4. NotificationsStep (Step 4 - Optional)**
- SMTP email notification configuration
- Uses `wizardStep4Schema` from @docktor/shared
- Fields: Host, port, encryption (none/starttls/ssl), from address, username, password
- Grid layout: 2-column for compact form
- Default port: 587 (STARTTLS)
- Back, Skip, Next buttons
- Skip behavior: Empty host triggers skip automatically on Next click

### Integration with Setup Page

**Updated client/src/routes/setup.tsx:**
- Uncommented and imported all four step components
- Replaced `renderCurrentStep()` placeholder with conditional step rendering
- Each step receives appropriate props:
  - `onNext`: Handler for form submission
  - `onBack`: Handler to return to previous step (steps 2-5)
  - `onSkip`: Handler for optional steps (steps 3-4)
  - `loading`: Disabled state during async operations
- Step 5 remains placeholder for BrownfieldStep (Plan 05-06)

## Deviations from Plan

None - plan executed exactly as written.

## Authentication Gates

None encountered.

## Threats Mitigated

| Threat ID | Mitigation Applied | Verification |
|-----------|-------------------|--------------|
| T-05-16 | All password inputs use `type="password"` | Visual check: passwords masked in UI |
| T-05-21 | Client-side Zod validation via standardSchemaResolver | TypeScript check: schema enforcement at compile time |

## Known Stubs

None - all form fields are functional with proper validation.

## Verification Results

- [x] `yarn workspace @docktor/client tsc --noEmit` passes (zero errors)
- [x] All step components render with correct props
- [x] Form validation schemas imported from @docktor/shared
- [x] Conditional field rendering works (backup type selection)
- [x] Skip buttons present on optional steps (3-4)
- [x] Navigation flow: Next → next step, Back → previous step

## Success Criteria Met

- [x] AccountStep creates admin account with email/password validation (WIZ-02)
- [x] SettingsStep configures instance name, base URL, timezone (WIZ-03)
- [x] BackupStep allows optional backup configuration (WIZ-04)
- [x] NotificationsStep allows optional SMTP configuration (WIZ-05)
- [x] All steps integrate with setup page state management
- [x] Follows UI-SPEC design system (spacing, typography, color)
- [x] Password fields use `type="password"` (T-05-16)
- [x] All forms use Zod validation (T-05-21)

## Next Steps

**Plan 05-06 (Wave 3):** BrownfieldStep component for existing stack discovery and import wizard.

Once 05-06 completes, the full 5-step wizard will be functional end-to-end.

## Self-Check: PASSED

All created files verified:
- ✓ FOUND: account-step.tsx
- ✓ FOUND: settings-step.tsx
- ✓ FOUND: backup-step.tsx
- ✓ FOUND: notifications-step.tsx

All commits verified:
- ✓ FOUND: 08ada53 (feat: create AccountStep and SettingsStep components)
- ✓ FOUND: 38f3568 (feat: create BackupStep and NotificationsStep components)
- ✓ FOUND: e2f519b (feat: integrate step components with setup page)
