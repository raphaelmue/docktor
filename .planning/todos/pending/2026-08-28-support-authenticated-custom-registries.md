---
created: 2026-08-28T00:00:00Z
title: Support authenticated/private container registries for update checking
area: observability
severity: minor
files:
  - server/src/infrastructure/registry-client.ts
---

## Problem

User question: is ghcr.io (GitHub Container Registry) considered by the
update checker? Confirmed yes for *public* images — `RegistryClient.
resolveRegistryTarget()` treats any host with a dot (or `localhost`/a
port) as an explicit registry host rather than defaulting to Docker Hub,
and goes through the same Registry v2 API + bearer-token negotiation
(covered by an existing test: `ghcr.io/user/app:2.0`).

What's missing: `RegistryClient.fetchToken()` only ever requests an
**anonymous** pull token — there's no way to supply credentials. So any
private image (a private Docker Hub repo, a private ghcr.io image, or a
self-hosted registry that requires auth) can never be checked; `listTags()`
will just fail the token negotiation and the image's update checks stay
permanently unavailable, with no way for a user to fix it from the app.

## Solution

TBD — needs a settings surface for per-registry (or per-image) credentials
(username/password or a token), stored encrypted like the existing backup
repo password (`server/src/lib/crypto.ts`'s AES-256-GCM pattern). Register
domain: `RegistryClient.fetchToken()`/`requestTagsListUrl()` would need to
accept optional credentials and send them in the token request (Basic auth
against the realm) rather than always requesting anonymously. Needs a
design pass on how a stored credential set maps to a given image's host
(one set of Docker Hub credentials? per-host credential list?).
