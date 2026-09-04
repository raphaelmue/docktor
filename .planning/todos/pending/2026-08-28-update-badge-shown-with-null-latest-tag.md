---
created: 2026-08-28T00:00:00Z
title: "\"Update available\" badge shows even when there's no latestTag to point to"
area: ui
severity: minor
files:
  - client/src/routes/app/stacks/components/services-tab.tsx
---

## Problem

User feedback: the blue "update available" badge on a service row
(`services-tab.tsx:81-85`) is rendered purely off `svc.updateAvailable`
(the digest-based `hasUpdate` flag) — it doesn't require `svc.latestTag`
to be non-null. When `latestTag` is null the badge just reads "update
available" with no `→ <tag>` suffix, which reads as vague/unclear rather
than actionable, especially for a moving-tag service (see
[[2026-08-28-upgrade-dialog-wrong-message-for-moving-tags]] — clicking
Upgrade on exactly this badge state currently shows a misleading "not
checked yet" message instead of explaining there's no discrete version to
offer).

## Solution

TBD — needs a design decision: either only show the badge when there's
something concrete to act on (`latestTag` non-null, i.e. suppress it for
moving tags and let the digest-only case surface some other way), or keep
showing it but make the no-`latestTag` case visually/textually distinct
from the has-`latestTag` case (e.g. different badge color/copy: "content
updated" vs "update available → 1.31.4"), so a moving tag's badge doesn't
imply a pickable version exists when it doesn't.
