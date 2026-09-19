---
created: 2026-09-07T11:58:51.827Z
title: Add support for custom TLS certificates
area: proxy
severity: major
files:

  - server/src/jobs/proxy-cert-poller.ts
  - server/src/lib/proxy-stack-compose.ts
  - client/src/components/domain/stack/cert-status-badge.tsx

completed: 2026-09-17
status: completed
---

## Problem

Phase 06 (proxy-configuration) only supports automatic certificate issuance via
acme-companion (Let's Encrypt, HTTP-01 challenge). There is no way for a user to
upload/provide their own TLS certificate for a proxied domain — e.g. for internal
domains without public DNS, wildcard certs issued elsewhere, or CAs other than
Let's Encrypt. COVERAGE.md for phase 06 explicitly opted out of `ACME_CA_URI` /
staging CA toggle and DNS-01, but "bring your own certificate" (bypassing ACME
entirely) wasn't considered at all.

Surfaced during Phase 06 UAT (test 7, "Certificate issuance on a real host") when
the test was skipped for lack of a real host with public DNS — prompted the
question of whether a custom-cert path exists as an alternative to the
DNS-dependent ACME flow.

## Solution

TBD. Likely shape: let a user upload a cert+key pair (or point to files) per
domain, store them where nginx-proxy's `vhost.d`/cert volume expects them
(`PROXY_CERTS_SUBPATH` in `proxy-stack-compose.ts`), and have `ProxyCertPoller`
treat a custom cert as already "issued" — skipping acme-companion for that
domain entirely rather than fighting to reissue it.

## Resolution

Scope item 4 (custom TLS certificates) shipped across four plans in
Phase 9 — data model, upload pipeline, issuance/expiry wiring, and the
client surface — closing all five decisions (D-09 through D-13) this todo
was filed against.

- **D-09 (file upload, no pasted PEM, chain combined by Docktor):** shipped
  in **plan 09-06**. `POST /api/certificates` is a `requireAuth`-gated,
  `@fastify/multipart`-backed route (`server/src/routes/certificates.ts`)
  accepting three file parts — certificate, private key, and an optional
  CA bundle. `CertificateFilesystem` concatenates the leaf certificate and
  the optional bundle into a single `.crt` at write time, so the user never
  concatenates anything by hand. The client surface for this (three
  separate file inputs, one clearly optional) shipped in **plan 09-08**'s
  `CertificatesCard` (`client/src/routes/app/settings/components/certificates-card.tsx`).

- **D-10 (reusable, wildcard-capable Certificate entity, one upload per
  domain pattern):** shipped in **plan 09-05** (`Certificate` Prisma model,
  `domainPatternRegex`, `createCertificateSchema` in
  `shared/src/validation/proxy.ts`) and **plan 09-06** (`certFileBaseName`'s
  parent-domain wildcard naming — `*.example.com` writes once as
  `example.com.crt`, matching nginx-proxy's own convention, never
  duplicated per subdomain). Any number of `ProxyConfig` rows reference the
  same `Certificate` row via `certificateId`.

- **D-11 (certificate-source field governs issuance, not
  acme-companion's own skip detection):** shipped in **plan 09-05**
  (`ProxyConfig.certSource` field, `assignDomainSchema`'s pairing
  refinements — custom requires a `certificateId`, acme forbids one, custom
  requires `tlsEnabled`) and **plan 09-07**
  (`renderProxyEnvForService`'s issuance-host filter is TLS-enabled AND
  `certSource==='acme'` — the single place suppression happens; proven
  against a real parsed compose YAML document, not just mocks). The
  user-facing choice (automatic vs. one of their uploaded certificates,
  with a picker and an explanatory note of the consequence) shipped in
  **plan 09-08**'s `proxy-tab.tsx`.

- **D-12 (reject a mismatched/non-covering/unparseable upload before
  persisting anything):** shipped in **plan 09-06**.
  `certificate-validation.ts` validates the key/certificate pair and
  domain-pattern coverage via `node:crypto` (`X509Certificate`/
  `createPrivateKey`, no PEM library) before any database row or file is
  written, and distinguishes the three failure classes (key mismatch,
  uncovered domain, unparseable content) so the rejection reason is
  specific. **Plan 09-08**'s `CertificatesCard` renders that reason text
  verbatim rather than a generic failure message.

- **D-13 (expiry warning, no silent gap since custom certs have no
  auto-renewal):** shipped in **plan 09-05** (`expiring` added as a fourth
  `certStatusSchema` member), **plan 09-07** (`ProxyCertPoller`'s
  `CERT_EXPIRY_WARNING_DAYS = 30` and `classifyCertificateExpiry`,
  re-checked on the poller's existing cron cadence and proven against a
  real fixture certificate's actual not-after date), and **plan 09-08**
  (the `CertStatusBadge` "Expiring soon" branch — amber-toned, explicitly
  not the destructive variant, arriving live through the existing
  `proxy_cert_status` SSE stream with no page reload — plus a per-row
  warning indicator in the Settings certificates list for a user who never
  opens a stack page).

### Live-database status carried forward from plans 09-05 and 09-06

Both plans took **Branch B**: no live database was reached in either
session. Plan 09-05 generated the `add_certificate` migration (Certificate
table, `ProxyConfig.certSource`/`certificateId` columns) against a
from-schema-copy diff, not applied to any running Postgres instance — the
same TCP-connects-but-the-Postgres-wire-protocol-never-completes block
documented across this project's Phase 09/05.1/06/08 sessions
(`WINDOWS.md` entry #11, compounding entry #10 from plan 09-03). Plan 09-06
built the upload/validation/storage pipeline entirely against unit tests
with a mocked filesystem and mocked Prisma client — it never exercised a
live database or a live mounted proxy stack either (`WINDOWS.md`
implicitly covers this via the same entry #11 gap, since the Certificate
table it writes to doesn't exist anywhere live). **A user cannot exercise
any part of this feature until a developer on an unrestricted host runs
`yarn db:migrate` and confirms the certSource backfill**, per the command
sequence recorded in `09-05-SUMMARY.md`.

### User-acceptance-testing handoff (live confirmation)

Carried forward from plan 09-07 (which itself carried it from plan 09-06):
a human on an unrestricted host, with a live database migrated and a real
proxy stack deployed, must perform one live end-to-end pass — upload a
real certificate through the browser, assign it to a domain, confirm
nginx-proxy actually serves HTTPS with that certificate, and confirm
acme-companion's logs show no issuance attempt for that domain. This has
never been exercised against a live Docker-mounted proxy stack in any
session across plans 09-06, 09-07, or 09-08 — all three proved their
logic via source-level containment/naming checks, real compose-YAML
parsing, and a real self-signed fixture certificate's expiry, but not via
a live `nginx-proxy`/`acme-companion` deployment. **A failing check here
reopens this item through normal gap closure** — file a new todo scoped to
whatever the live pass surfaces, rather than reopening this one wholesale.

### Not addressed by this resolution

None of D-09 through D-13 were descoped or partially implemented — all
five are fully delivered at the source-and-unit-test level described
above. The only carried-forward gaps are the two live-environment items
named above (migration application, and the live HTTPS-serving UAT pass),
both pre-existing classes of gap already tracked in `.planning/WINDOWS.md`
for this phase's earlier plans, not new gaps introduced by this
resolution.
