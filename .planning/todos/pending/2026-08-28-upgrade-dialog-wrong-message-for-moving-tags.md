---
created: 2026-08-28T00:00:00Z
title: Upgrade dialog shows "not checked yet" for a moving-tag service that was actually checked
area: ui
severity: minor
files:
  - server/src/jobs/update-checker.ts
  - server/src/routes/stacks.ts
  - client/src/routes/app/stacks/components/service-upgrade-dialog.tsx
---

## Problem

User report: a service pinned to `stable` (a moving tag) shows the blue
"update available" badge (correctly — `hasUpdate` is driven by a digest
comparison, which did detect a change), but clicking Upgrade shows
"The registry has not been checked for this image yet. Checks run on a
staggered schedule — check back later." — which is factually wrong: the
check *did* run.

Root cause: `UpdateChecker.checkImage()` (`update-checker.ts:414`)
deliberately skips the registry tag-listing/`selectUpgradeCandidates()`
call entirely for any tag in `MOVING_TAGS` (`latest`/`edge`/`stable`/
`main`/`master`/`nightly`), since a moving tag has no version-ordered
upgrade target by design — the tag itself never changes, only its
underlying content. So `availableTags` and `latestTag` both stay `null`
forever for such a service, which is indistinguishable, from the
dialog's point of view, from "the check hasn't run yet at all"
(`service-upgrade-dialog.tsx`'s zero-candidates-and-no-latestTag branch).

## Solution

TBD — the dialog needs a third, distinct state for "this is a moving tag,
there is no discrete version to select." Likely: have
`GET /api/stacks/:id/services/:serviceName/tags` (or the `ImageUpdateCheck`
row itself) indicate whether the current tag is a moving tag — reusing
`MOVING_TAGS` from `update-checker.ts` rather than duplicating the set
client-side — and have the dialog show something like "This service is on
a moving tag (`stable`) — there's no discrete newer version to pick. Use
'Update Images' to pull the latest content for this tag" instead of the
misleading "not checked yet" message.
