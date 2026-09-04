---
created: 2026-08-28T00:00:00Z
title: Env file changes (via app or externally) never set the config-changed badge
area: observability
severity: major
files:
  - server/src/application/stack-service.ts
  - server/src/jobs/file-watcher.ts
---

## Problem

User report: "when changing the env file (or creating it) the container
stack does not get the badge that changes were made, neither via the app
nor via external changes."

Confirmed via code — two separate gaps, one per path:

1. **App-driven edit:** `StackService.updateStack()`
   (`stack-service.ts`, `envContent` branch) writes the env file via
   `this.fs.writeEnv()`/`removeEnv()` but never calls
   `this.repo.setConfigChanged()` — unlike the `composeContent` branch
   directly above it, which hashes the new content and calls
   `setConfigChanged` when it differs from `lastKnownHash`. Editing only
   the env file through the app leaves `configChanged` untouched.
2. **External edit:** `FileWatcher`'s chokidar `ignored` filter
   (`file-watcher.ts`) only watches paths ending in `docker-compose.yml`
   — `.env` is never watched at all, so an external edit to it produces
   no `config_changed` event, no hash update, nothing.

## Solution

TBD — two independent fixes matching the two gaps:
1. `updateStack()`'s `envContent` branch should also flag `configChanged`
   (env content isn't currently hashed anywhere the way compose content
   is via `lastKnownHash`/`createComposeConfig().hash` — needs its own
   comparison, or just unconditionally flag `configChanged: true` on any
   env write, which is simpler and matches "something changed" semantics
   env content doesn't need diffing for).
2. Extend `FileWatcher`'s watched/ignored filter to also cover the
   stack's `.env` file, and thread the same config-changed/config-error
   handling through `handleFileChange()` for it.
