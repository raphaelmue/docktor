---
status: testing
phase: 05-onboarding
source: [05-VERIFICATION.md]
started: 2026-08-31T16:31:32Z
updated: 2026-08-31T16:31:32Z
---

## Current Test

number: 1
name: Concurrent POST /api/setup/step1 requests create exactly one admin account
expected: |
  Trigger two concurrent POST /api/setup/step1 requests (double-submit or two tabs) against a
  real Postgres instance. The losing request receives a 400 "Setup already complete" response;
  exactly one User row exists afterward.
awaiting: user response

## Tests

### 1. Concurrent POST /api/setup/step1 requests create exactly one admin account
expected: The losing request receives a 400 "Setup already complete" response; exactly one User row exists afterward.
result: [pending]

## Summary

total: 1
passed: 0
issues: 0
pending: 1
skipped: 0
blocked: 0

## Gaps
