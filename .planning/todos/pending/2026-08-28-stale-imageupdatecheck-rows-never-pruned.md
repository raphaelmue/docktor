---
created: 2026-08-28T00:00:00Z
title: Stale ImageUpdateCheck rows are never pruned when a service's tag changes
area: observability
severity: cosmetic
files:
  - server/src/jobs/update-checker.ts
  - server/src/repositories/image-update-check-repository.ts
---

## Problem

Observed while verifying plan 02-12: after changing a service's tag
(directly, or via the new upgrade dialog), the `ImageUpdateCheck` row for
the *old* image+tag combination stays in the table forever — nothing ever
deletes it. Confirmed via a real DB dump showing a `nginx:1.25` row from
before the tag was ever changed away from 1.25, still present days later
alongside the current `nginx:1.27`/`nginx:1.31.4` rows.

Harmless today (nothing reads stale rows — `findAllImageRefs()` only
returns *current* distinct image+tag combos from the `Service` table, and
the stagger scheduler only iterates that current set), but the table
grows unboundedly over time as tags churn, and a stale row with a
`hasUpdate: true` you already resolved is misleading if anyone queries the
table directly for support/debugging.

## Solution

TBD — e.g. a periodic prune step (delete `ImageUpdateCheck` rows whose
`imageRef` no longer appears in any current `Service.image`+`imageTag`
combination), or delete the old row explicitly whenever a service's tag
changes (compose sync, deploy, or the upgrade endpoint).
