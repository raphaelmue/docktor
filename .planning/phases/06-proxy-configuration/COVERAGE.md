# API Coverage — nginx-proxy + acme-companion

> Full coverage by default. Opt-outs are explicit, reasoned decisions.

**Detector verdict:** `detected: true`. The signals the deterministic scan matched
(`integrating … REST API`, `REST API integration`) are all references to the
**Nginx Proxy Manager REST API that D-01 explicitly rejects**. Docktor calls no
external HTTP API in this phase (RESEARCH.md State of the Art: "do not build an
HTTP client for this phase").

The integration surface that *does* exist is the **env-var / container contract**
of the two `nginxproxy/*` images. That is the capability surface enumerated below,
because that is the surface a user can reasonably expect Docktor to expose and the
one where silent holes would otherwise accumulate.

## nginx-proxy — proxied-container env-var surface

| capability | decision | reason |
|---|---|---|
| `VIRTUAL_HOST` | INTEGRATE | |
| `VIRTUAL_PORT` | INTEGRATE | |
| multi-domain comma-joined `VIRTUAL_HOST` | INTEGRATE | D-08 requires several domains per service |
| `docktor_proxy` shared network attachment | INTEGRATE | D-03 resolution — the wiring mechanism |
| `VIRTUAL_PROTO` | OPT-OUT | not needed — every Docktor-managed service speaks plain HTTP behind the proxy; no fastcgi/uwsgi/https-upstream case in scope |
| `VIRTUAL_PATH` / `VIRTUAL_DEST` / `VIRTUAL_ROOT` | OPT-OUT | explicitly out of scope — D-07 rules out path-based routing this phase |
| `HTTPS_METHOD` (redirect / noredirect / nohttp / nohttps) | OPT-OUT | not needed yet — D-04 caps the UI at domain + TLS on/off; nginx-proxy's `redirect` default is the wanted behaviour |
| `HSTS` | OPT-OUT | not needed yet — image default applies |
| `CERT_NAME` | OPT-OUT | not needed — acme-companion names certs by domain; no custom cert naming in scope |
| per-vhost nginx config via `vhost.d` | OPT-OUT | not needed yet — the `vhost.d` volume IS bind-mounted, so a user can drop a file manually; no Docktor UI for it |
| `client_max_body_size` and other proxy tuning knobs | OPT-OUT | not needed yet — D-04 defers advanced knobs until the minimal surface ships |
| `DEFAULT_HOST` (catch-all vhost) | OPT-OUT | not needed — no catch-all/fallback vhost concept in Docktor's model |
| per-vhost basic auth (`htpasswd`) | OPT-OUT | explicitly out of scope — Docktor owns authentication; REQUIREMENTS.md puts RBAC/multi-user out of scope project-wide |
| custom `nginx.tmpl` | OPT-OUT | not needed — the image's shipped template is used unmodified |
| `docker-gen` / label-based auto-detection of the proxy container | OPT-OUT | superseded — `NGINX_PROXY_CONTAINER` is pinned explicitly instead (RESEARCH.md assumption A2: two doc pages disagreed on the label string) |

## acme-companion — cert-issuance surface

| capability | decision | reason |
|---|---|---|
| `LETSENCRYPT_HOST` (or its `ACME_HOST` alias — resolved at execution time, see 06-01 Task 1) | INTEGRATE | |
| `DEFAULT_EMAIL` on the companion container | INTEGRATE | D-09 — the single global ACME registration email |
| `NGINX_PROXY_CONTAINER` | INTEGRATE | A2 — pinned explicitly rather than relying on label auto-detection |
| automatic renewal | INTEGRATE | owned entirely by the container; Docktor observes outcome only |
| cert issuance status observation (cert-file presence + companion log tail) | INTEGRATE | D-05 |
| per-container `LETSENCRYPT_EMAIL` override | OPT-OUT | explicitly out of scope — D-09 makes the ACME email a single global Settings field, "not collected inline per-domain" |
| `ACME_CA_URI` / staging CA toggle | OPT-OUT | not needed yet — production Let's Encrypt only; no staging switch in the UI this phase |
| `LETSENCRYPT_TEST` | OPT-OUT | not needed yet — same reason as the staging CA toggle |
| `LETSENCRYPT_KEYSIZE` | OPT-OUT | not needed — image default key size is correct for every domain Docktor issues |
| `LETSENCRYPT_SINGLE_DOMAIN_CERTS` | OPT-OUT | not needed — the default (one SAN cert spanning a service's comma-joined domains) is exactly what D-08 wants |
| DNS-01 challenge / `ACME_CHALLENGE=dns-01` | OPT-OUT | explicitly out of scope — DNS-01 needs per-provider API credentials, a whole credential-storage surface REQUIREMENTS.md does not scope for v1 |
| ZeroSSL / non-Let's-Encrypt ACME CAs with EAB credentials | OPT-OUT | explicitly out of scope — PRXY-03 scopes a Let's Encrypt registration email, not a pluggable CA |
