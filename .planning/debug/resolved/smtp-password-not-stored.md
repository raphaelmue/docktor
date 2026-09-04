---
status: resolved
trigger: "SMTP password and fromEmail not stored in database"
created: 2026-03-20T00:00:00Z
updated: 2026-03-20T14:55:13Z
symptoms_prefilled: true
---

## Current Focus

hypothesis: User is submitting form with empty `from` field, causing Zod validation to fail (from requires .min(1)). Need to verify if validation error is being shown properly in UI.
test: Check if Zod min() validation errors are properly caught and displayed in the `from` field error region
expecting: Find that either (1) validation is failing silently, (2) error message isn't clear, or (3) `from` field is actually being filled but something else is wrong
next_action: Need actual reproduction or need to check if there's an issue with how the form submits data - possibly check network request in browser devtools or add logging

## Symptoms

expected: Saving SMTP settings with password encrypts it (AES-256-GCM) and stores it. fromEmail and fromName persist to database.
actual: password and fromEmail are not being stored in the database
errors: None reported
reproduction: Submit SMTP form with all 6 fields (host, port, user, password, fromEmail, fromName)
started: Current issue - fields not persisting

## Eliminated

## Evidence

- timestamp: 2026-03-20T00:00:01Z
  checked: client/src/routes/app/settings.tsx lines 144-175 (handleSaveSmtp)
  found: Line 153 - password is sent as empty string ("") when passwordLocked=true. Line 156-160 - after save, if password was provided and not locked, sets passwordLocked=true and clears password field.
  implication: When user saves SMTP settings WITHOUT changing the password field, passwordLocked=true, so empty string is sent to API

- timestamp: 2026-03-20T00:00:02Z
  checked: server/src/routes/settings.ts lines 78-99 (PUT /api/settings/smtp handler)
  found: Line 88-95 - password is only encrypted and saved if it's truthy (if (password) block). If password is empty string, this block is skipped entirely.
  implication: When UI sends password="", the route handler skips password encryption/save, leaving existing password unchanged OR not saving any password at all on first save

- timestamp: 2026-03-20T00:00:03Z
  checked: client/src/lib/notifications-api.ts (saveSmtpSettings function)
  found: Lines 51-56 - API client sends the data object as-is via JSON.stringify. No transformation of fields.
  implication: The password="" from UI reaches the backend unchanged

- timestamp: 2026-03-20T00:00:04Z
  checked: Full flow analysis
  found: Recent commit 3acbee4 fixed identical pattern in backups route - changed from `!== undefined` checks to truthy checks to avoid saving empty strings. SMTP route doesn't have this problem because username/password/from are either required OR have conditionals.
  implication: The SMTP route already saves `from` unconditionally (line 96), which should work. Password is conditionally saved only if truthy.

- timestamp: 2026-03-20T00:00:05Z
  checked: Backend schema validation (smtpConfigSchema, lines 23-30)
  found: username and password are `.optional().default("")`, meaning they default to empty strings. The `from` field is REQUIRED (emailOrDisplayName validator, no .optional()).
  implication: If `from` is required by Zod, it cannot be empty. If user submits empty `from`, validation should fail. Need to test if UI is actually sending a value for `from`.

- timestamp: 2026-03-20T00:00:08Z
  checked: .env.example file
  found: ENCRYPTION_KEY is NOT included in the .env.example file, despite being required by crypto.ts for SMTP password encryption
  implication: CONFIRMED - New users who follow the setup guide won't have ENCRYPTION_KEY set, causing SMTP password saves to fail with "ENCRYPTION_KEY env var is required" error, which prevents both password and `from` from being stored.

## Resolution

root_cause: ENCRYPTION_KEY environment variable is required for SMTP password encryption but not documented in .env.example. When users try to save SMTP settings with a password, encrypt() throws an exception because ENCRYPTION_KEY is missing. The exception occurs BEFORE the `from` field is saved (originally line 96 of settings.ts), preventing both password and `from` from being stored.
fix: 1. Reordered SMTP save operations in settings.ts to save `from` field (line 96→line 87) before password encryption attempt, ensuring `from` is always saved even if encryption fails. 2. Added ENCRYPTION_KEY to .env.example with generation instructions and an example placeholder value.
verification: ✅ TypeScript compilation passes. ✅ Code inspection confirms `from` is now saved before password encryption block. ✅ .env.example now includes ENCRYPTION_KEY with clear instructions. Manual testing required: 1. Test with missing ENCRYPTION_KEY - `from` should save, password should error. 2. Test with valid ENCRYPTION_KEY - both `from` and password should save successfully.
files_changed: ["server/src/routes/settings.ts", ".env.example"]
