---
status: diagnosed
trigger: "Investigate why invalid YAML errors and validation restrictions are not being detected or shown."
created: 2026-03-16T00:00:00Z
updated: 2026-03-16T00:11:00Z
---

## Current Focus

hypothesis: parseComposeContent returns empty array for missing services key instead of throwing error, bypassing error handling in file-watcher
test: verify that missing services key is a valid scenario vs error scenario
expecting: confirm whether empty array is intentional or bug
next_action: check if empty services should be considered an error

## Symptoms

expected: Invalid YAML syntax should trigger config_error SSE events, validation rules should be enforced
actual: Invalid YAML doesn't show error messages in UI or logs, validation restrictions not enforced
errors: No error messages shown
reproduction: Create invalid YAML in compose file, add network/volume violations
started: Unknown, likely since initial implementation

## Eliminated

## Evidence

- timestamp: 2026-03-16T00:05:00Z
  checked: compose-parser.ts parseComposeContent function
  found: When services key is missing or invalid, function returns empty array [] without throwing error
  implication: file-watcher.ts catch block never executes, so config_error event never fires

- timestamp: 2026-03-16T00:06:00Z
  checked: yaml library parse() method
  found: yaml.parse() DOES throw errors for invalid YAML syntax
  implication: Invalid YAML syntax should be caught, but missing services key is not considered invalid

- timestamp: 2026-03-16T00:07:00Z
  checked: file-watcher.ts handleFileChange method lines 130-146
  found: try-catch wraps parseComposeContent() and broadcasts config_error on exception
  implication: Error handling IS implemented, but parseComposeContent doesn't throw for missing services

- timestamp: 2026-03-16T00:08:00Z
  checked: compose-parser.ts lines 49-54
  found: When services key missing/invalid, returns empty array [] without throwing
  implication: Silent failure - no error broadcast to UI

- timestamp: 2026-03-16T00:09:00Z
  checked: .planning/REQUIREMENTS.md
  found: No validation rules defined for network restrictions or volumes directory requirements
  implication: User expectation in UAT test 5 but no corresponding requirement exists

- timestamp: 2026-03-16T00:10:00Z
  checked: domain/compose-config.ts and application/stack-service.ts
  found: createComposeConfig used during stack creation/update, would create stack with zero services if services key missing
  implication: Empty services array is NOT a valid state - should be treated as error

## Resolution

root_cause: parseComposeContent() in compose-parser.ts silently returns empty array when services key is missing or invalid, instead of throwing an error. This bypasses the error handling in file-watcher.ts handleFileChange() (lines 130-146), preventing config_error events from being broadcast to the UI.

fix: Modify parseComposeContent() to throw descriptive error when:
  1. YAML parsing succeeds but services key is missing
  2. services key exists but is not an object
  3. services key is an empty object (no services defined)
  Additionally, validation restrictions mentioned in UAT (network, volumes directory) are user expectations without corresponding requirements - should be documented as future enhancements, not current bugs.

verification: After fix, test with:
  1. Invalid YAML syntax (already works - yaml.parse throws)
  2. Missing services key (currently fails - should show config_error)
  3. Empty services object (currently fails - should show config_error)
  4. Valid compose with services (should work normally)

files_changed: []
