---
phase: 2
slug: observability
status: validated
nyquist_compliant: false
wave_0_complete: true
created: 2026-03-13
---

# Phase 2 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest 4.0.18 |
| **Config file** | `server/vitest.config.ts` (unit project), `client/vitest.config.ts` |
| **Quick run command** | `yarn workspace @docktor/server test --run` |
| **Full suite command** | `yarn workspace @docktor/server test --run && yarn workspace @docktor/client test --run` |
| **Estimated runtime** | ~30 seconds |

The `npm run test:unit -w server` form from the original draft still works, but the project has
since standardized on the Yarn v4 workspace commands above.

---

## Sampling Rate

- **After every task commit:** Run `yarn workspace @docktor/server test --run`
- **After every plan wave:** Run the full suite command above
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** ~30 seconds

---

## Requirement Verification Map

The phase grew from its original 5-plan scope to 16 plans (02-01 through 02-16, including 4
gap-closure plans from UAT). The per-task table below has been superseded by this
requirement-level map — it reflects what was actually built and tested, not the original plan.

| Requirement | Meaning | Plans | Test file(s) | Status |
|---|---|---|---|---|
| FW-01 | chokidar watcher starts on stacks root | 01, 03, 05, 06, 08 | `server/test/unit/jobs/file-watcher.test.ts` (24 tests) | ✅ COVERED |
| FW-02 | handleFileChange: config_changed/config_error detect + broadcast | 01–03, 05, 06, 08, 14, 15, 16 | `file-watcher.test.ts` (server-side); client: `use-stack.test.ts`, `use-stack-events.test.ts`, `event-log-card.test.tsx` | ⚠️ PARTIAL — server-side detection/broadcast fully covered; client has no `config_error` code path at all yet (feature gap, not test gap — see Manual-Only below) |
| FW-03 | 60s reconcile loop | 01, 03, 08 | `file-watcher.test.ts` reconcile() suite | ✅ COVERED |
| UPD-01 | version comparison (semver/date/digest) | 01, 04, 07, 09, 10 | `server/test/unit/domain/image-update-detection.test.ts`, `registry-client.test.ts` | ✅ COVERED |
| UPD-02 | stagger logic | 01, 02, 04, 07, 09 | `update-checker.test.ts` (43 tests) | ✅ COVERED |
| UPD-03 | update-available badge / genuinely-newer version filtering | 02, 05, 07, 09, 10, 12, 15, 16 | `registry-client.test.ts`, `update-checker.test.ts`, `use-stack-events.test.ts` | ✅ COVERED |
| UPD-04 | pull+recreate / upgrade dialog | 01, 04, 05, 07, 11, 12, 13 | `server/test/unit/application/stack-service.test.ts` (32 tests, incl. the digest-comparison branch added for gap G-02-11), `service-upgrade-dialog.test.tsx` | ✅ COVERED |

**Coverage: 6/7 automated, 1 partial (deferred feature gap).** Confirmed passing at audit time:
server 409/409 (2 unrelated todo), client 77/77 (3 unrelated todo).

*Status: ✅ COVERED · ⚠️ PARTIAL · ❌ MISSING*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Notes |
|----------|-------------|------------|-------|
| "config error" indication appears client-side on invalid compose YAML | FW-02 | No client code path exists yet — this is a feature gap, not a coverage gap. Backend detection/broadcast (`config_error` StackEvent + SSE) is fully unit-tested. | Tracked: `.planning/todos/pending/2026-08-28-config-error-ui-indication-missing.md`. Deferred, not blocking phase 02. |
| 60s reconcile fallback catches changes on an NFS/Docker-Desktop-virtualized mount | FW-03 | The reconcile loop mechanism itself is unit-tested; the specific environment condition (non-native filesystem event propagation) is inherently untestable in CI. | Covered functionally by `DOCKTOR_FS_POLLING` + the 60s cron fallback; environment-specific by nature. |
| Update pull + container recreate completes against a live Docker daemon | UPD-04 | The decision/dialog logic (which version to pull, when to allow the action) is fully unit-tested; actual container recreation against a live daemon is an integration/manual concern. | UAT test 8 (Phase 02 UAT) confirmed this end-to-end against a real stack. |

The other two items from the original draft (SSH-based config-changed badge, update-available
badge) are now COVERED by automated tests — see the map above — and have been removed from this
table.

---

## Validation Sign-Off

- [x] All requirements have automated verification or an explicit, justified manual-only entry
- [x] Sampling continuity: dense automated coverage across all 16 plans
- [x] Wave 0 requirements superseded by full phase execution
- [x] No watch-mode flags
- [x] Feedback latency < 30s
- [ ] `nyquist_compliant: true` — not set; one requirement (FW-02) is partial pending a deferred
      client feature, not a test-writing gap. Re-run `/gsd-validate-phase 02` once
      `2026-08-28-config-error-ui-indication-missing.md` is implemented and tested.

**Approval:** validated (partial) — 2026-08-30

---

## Validation Audit 2026-08-30

| Metric | Count |
|--------|-------|
| Requirements | 7 |
| Covered | 6 |
| Partial (deferred feature gap, not a test gap) | 1 |
| Missing | 0 |

Audited against the actual 16-plan implementation (original VALIDATION.md was drafted
2026-03-13 against a 5-plan scope and had never been updated). No nyquist auditor spawned:
the one gap (FW-02 client-side `config_error` handling) has no implementation to test against
yet, so a test can't close it — user chose to mark it manual-only/deferred rather than spawn
the auditor to write a test for non-existent behavior.
