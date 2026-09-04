---
status: diagnosed
trigger: "Investigate issue: update-images-no-updates-toast-missing — Clicking \"Update Images\" in the stack detail page, when no service images had a newer version to pull, does not show the \"images are already up to date\" toast. User hypothesizes it's related to the update-available badge not being removed when there is no newer image."
created: 2026-08-28T00:00:00Z
updated: 2026-08-28T00:00:00Z
---

## Current Focus

hypothesis: CONFIRMED — see Resolution
test: n/a (goal: find_root_cause_only)
expecting: n/a
next_action: return diagnosis to caller

reasoning_checkpoint:
  hypothesis: "noUpdates always evaluates false because the substring heuristic in stack-service.ts::updateImages() (`up to date`, `already exists`, `downloading`, `extracting`, `pull complete`, `downloaded newer image`) checks for phrases that don't match the actual per-resource status text emitted by the modern Docker Compose CLI (v2/v5), which is `Pulled` (success, regardless of whether new layers were fetched) or `Skipped: <reason>` (e.g. `Skipped: Image is already present locally` when pull_policy=missing/if_not_present and a pinned tag is already present) — so the toast's success branch in stack-actions.tsx always renders 'Images updated successfully' and never 'Images are already up to date'."
  confirming_evidence:
    - "docker/compose source (pkg/api/event.go): StatusPulling='Pulling', StatusPulled='Pulled' — the only top-level per-service terminal status texts for a successful pull op; no 'up to date' or 'downloaded newer image' constant exists at this level."
    - "docker/compose source (pkg/compose/pull.go, eventSkippedPull): a skipped pull emits Text: 'Skipped: ' + reason. shouldPullImage() returns reason 'Image is already present locally' for pull_policy=missing/if_not_present + non-latest tag + image present — this exact text contains neither 'up to date' nor 'already exists', so it satisfies none of the code's OR conditions and also isn't 'hasDownloadActivity', leaving noUpdates=false for a case that is unambiguously 'no update happened'."
    - "docker/compose source (pkg/compose/pull.go, toPullProgressEvent): the literal strings 'Image is up to date' / 'Downloaded newer image' are only checked against jm.Status for the pull operation's *final summary* line, but that line has jm.ID=='' and the function returns early (`if jm.ID == \"\" || jm.Progress == nil { return }`) before ever reaching that check — so those two phrases the code searches for are dead ends even in the one place the compose codebase itself mentions them."
    - "server/src/infrastructure/docker-executor.ts composePull() already correctly concatenates stdout+stderr (compose writes progress to stderr) — ruling out a stdout/stderr capture bug as an alternative explanation."
    - "client/src/routes/app/stacks/components/stack-actions.tsx handleUpdateImages() correctly reads result.noUpdates and branches the toast.promise success message — ruling out the 02-12 ServicesTab/StackActions extraction as a wiring regression. server/src/routes/stacks.ts POST /update and client/src/lib/stacks-api.ts updateImages() both correctly propagate the noUpdates field end-to-end."
    - "server/test/unit/application/stack-service.test.ts has zero test coverage for the noUpdates:true branch — the only updateImages test asserts noUpdates===false using a synthetic 'Pull complete' fixture, which never exercises the heuristic's up-to-date branch against realistic output."
  falsification_test: "Run `docker compose pull` non-interactively (piped, no TTY, matching how execFileAsync spawns it) against a stack with a pinned (non-latest) tag whose image is already present locally, and inspect the literal captured stdout+stderr text. If it contains none of ['up to date', 'already exists', 'downloading', 'extracting', 'pull complete', 'downloaded newer image'] and is non-empty, this confirms the heuristic under-detects noUpdates in that configuration — this was reasoned from compose's Go source rather than an executed capture (no environment access here to actually run docker in this diagnose-only session)."
  fix_rationale: "The fix must stop pattern-matching free-form CLI progress text (which is an internal rendering detail Docker doesn't guarantee as an API) and instead use a positive, source-grounded signal that generalizes across pull_policy configurations — e.g. compare each service's local image digest before and after the pull (already partially available via docker-executor's manifest/digest inspection used elsewhere for update checks), or use `docker compose pull` with a machine-readable indicator (e.g. `--quiet` plus explicit per-service digest diffing) rather than text-scraping stdout/stderr."
  blind_spots: "Did not execute a real `docker compose pull` in this environment to directly observe captured text (diagnose-only investigation, no repro access) — conclusion is derived from reading the current docker/compose Go source (module path github.com/docker/compose/v5) rather than an observed capture. Did not fully trace the TTY-vs-plain progress-writer implementation (package moved out of this repo/version, 404s on the old pkg/progress path) to confirm whether per-layer 'Already exists' sub-events actually survive into non-TTY stdout for the no-pull_policy default case — case (b) in reasoning may still work by luck for stacks without an explicit pull_policy; case (a) (pull_policy=missing/if_not_present + pinned tag) is the confirmed-broken path from the source alone."
  candidate_causes:
    - "code: substring heuristic in server/src/application/stack-service.ts (lines ~269-285) matches phrases absent from modern docker compose CLI's actual event vocabulary"
    - "environment/config: whether a stack's compose file sets an explicit pull_policy (missing/if_not_present vs unset) changes which text-matching path is hit, but this is a config variable that exposes the code bug rather than a separate root cause"
  and_gate: "no — a single root cause (the string-heuristic mismatch with real compose output) fully explains the symptom; the config variation (pull_policy) is not an independent second failure condition, it's just the input that reliably triggers the code defect. This is NOT the same root cause as the (separate, pre-existing, already-tracked) update-available badge not clearing — that is driven by ImageUpdateCheck being a separate table joined by image+tag with no invalidation on tag-unchanged updates, decoupled from this pull-output parsing entirely."

## Symptoms

expected: Click "Update Images" in the stack detail page actions. If no images had updates, a toast says images are already up to date. If images were pulled and updated, a toast confirms images were updated successfully — distinct messages for each case.
actual: "the toast does not say \"no updates available\" - probably related to the issue that the badge is not removed if there are no newer images."
errors: None reported
reproduction: Test 11 in .planning/phases/02-observability/02-UAT.md — click "Update Images" on a stack whose services have no newer image available
started: Discovered during UAT re-verification of phase 02-observability (2026-08-28), after gap-closure plans 02-06 through 02-12 landed

## Eliminated

- hypothesis: "The 02-12 ServicesTab/StackActions extraction broke the client-side wiring (button no longer calls the right handler, or ignores result.noUpdates)."
  evidence: "client/src/routes/app/stacks/components/stack-actions.tsx handleUpdateImages() (lines 82-96) correctly awaits updateImages(stackId) and branches toast.promise's success message on result.noUpdates. client/src/routes/app/stacks/[id].tsx only imports and renders <StackActions>, no duplicate/stale inline handler remains. client/src/lib/stacks-api.ts updateImages() correctly types and returns {success, noUpdates}."
  timestamp: 2026-08-28T00:00:00Z

- hypothesis: "docker compose pull writes its progress output to stderr instead of stdout, and the server only captures stdout, silently dropping the text the heuristic needs."
  evidence: "server/src/infrastructure/docker-executor.ts composePull() already does `return stdout + \"\\n\" + stderr` with a comment acknowledging progress goes to stderr — both streams are captured and concatenated before being passed to the heuristic."
  timestamp: 2026-08-28T00:00:00Z

- hypothesis: "The update-available badge not clearing and the missing 'up to date' toast share a root cause (per user's stated hypothesis)."
  evidence: "The badge's updateAvailable/latestTag fields are computed in server/src/routes/stacks.ts by joining Service rows against a separate ImageUpdateCheck table keyed by image+tag (updateMap.get(key)). updateImages()'s repo.replaceServices() deletes/recreates Service rows but never touches ImageUpdateCheck, and the noUpdates flag returned from updateImages() is derived purely from parsing pull stdout/stderr text — no shared variable, table, or code path connects the two. The badge-staleness issue is already independently tracked as a separate pre-existing todo (.planning/todos/pending/2026-08-28-stale-imageupdatecheck-rows-never-pruned.md)."
  timestamp: 2026-08-28T00:00:00Z

## Evidence

- timestamp: 2026-08-28T00:00:00Z
  checked: client/src/routes/app/stacks/components/stack-actions.tsx handleUpdateImages()
  found: "Correctly calls updateImages(stackId), awaits result, and picks the toast.promise success message via `result.noUpdates ? \"Images are already up to date\" : \"Images updated successfully\"`. Wiring intact after the 02-12 refactor."
  implication: "Client is not the source of the bug; investigation moves server-side to where noUpdates is computed."

- timestamp: 2026-08-28T00:00:00Z
  checked: server/src/routes/stacks.ts POST /api/stacks/:id/update and client/src/lib/stacks-api.ts updateImages()
  found: "Both correctly pass through {success, noUpdates} end-to-end with matching types."
  implication: "API boundary is not the source of the bug."

- timestamp: 2026-08-28T00:00:00Z
  checked: server/src/application/stack-service.ts updateImages() lines 269-285
  found: "noUpdates is computed by lowercasing pullOutput and substring-matching for 'downloading'/'extracting'/'pull complete'/'downloaded newer image' (hasDownloadActivity) vs 'up to date'/'already exists'/empty-string (noUpdates)."
  implication: "This is the only remaining candidate for the bug; must verify these phrases actually appear in real `docker compose pull` output."

- timestamp: 2026-08-28T00:00:00Z
  checked: docker/compose Go source, pkg/api/event.go and pkg/compose/pull.go (github.com/docker/compose, main branch, module path v5)
  found: "Per-service terminal status text after a successful pull is exactly 'Pulled' (StatusPulled constant), used unconditionally whether or not new layers were downloaded. A skipped pull (shouldPullImage()==false, e.g. pull_policy=missing/if_not_present + pinned non-latest tag + image already present) emits Text: 'Skipped: Image is already present locally' — this phrase matches none of the code's substrings. The literal phrases 'Image is up to date' / 'Downloaded newer image' are only checked in toPullProgressEvent() against the pull operation's final summary line, but that function returns early for any message with an empty jm.ID, which is exactly the summary line's ID — meaning even docker/compose's own code never surfaces that text as a rendered event."
  implication: "The heuristic's phrase list does not correspond to any real terminal status text the current docker compose CLI produces. In the pull_policy=missing/if_not_present + pinned-tag configuration, noUpdates is provably always false regardless of whether an update actually occurred, because 'Skipped: Image is already present locally' satisfies neither hasDownloadActivity nor the noUpdates OR-conditions."

- timestamp: 2026-08-28T00:00:00Z
  checked: server/test/unit/application/stack-service.test.ts describe('updateImages')
  found: "Only one test exists, asserting noUpdates===false when composePull resolves with the synthetic fixture 'Pull complete'. No test exercises the noUpdates===true branch against any realistic compose CLI output."
  implication: "The noUpdates:true path was never actually verified against real or even plausibly-real docker compose pull output — the gap between the heuristic's assumed vocabulary and Compose's actual vocabulary was never caught by tests."

## Resolution

root_cause: "server/src/application/stack-service.ts updateImages() (lines 269-285) infers noUpdates by substring-matching pullOutput for phrases ('up to date', 'already exists', 'downloaded newer image', 'pull complete', etc.) that do not correspond to the actual per-service status text the current Docker Compose CLI (v2/v5) emits ('Pulled' on success regardless of whether new layers were fetched, or 'Skipped: <reason>' such as 'Skipped: Image is already present locally' when pull_policy causes compose to skip pulling entirely). Consequently noUpdates evaluates to false even when nothing was updated, so the client's toast.promise success handler in client/src/routes/app/stacks/components/stack-actions.tsx always shows 'Images updated successfully' and the 'Images are already up to date' branch is effectively unreachable in realistic deployments (confirmed unreachable for any service using pull_policy: missing/if_not_present with a pinned, already-present tag; strongly suspected unreachable more broadly since the phrases the heuristic checks for don't match Compose's event/status vocabulary at all — see Evidence)."
fix: "not applied — diagnose-only session (goal: find_root_cause_only)"
verification: "not applicable — no fix applied"
files_changed: []
