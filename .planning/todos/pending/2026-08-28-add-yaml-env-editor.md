---
created: 2026-08-28T12:01:53.982Z
title: Add a sophisticated compose YAML editor and env editor
area: ui
severity: minor
files:
  - client/src/routes/app/stacks/[id].tsx
  - client/src/routes/app/stacks/create.tsx
---

## Problem

User feedback: wants "a sophisticated yaml editor as well as env editor"
for the Compose and Environment tabs on the stack detail page (currently
plain text areas — see the `composeContent`/env handling in `[id].tsx` and
`create.tsx`). Split out from a larger UI redesign request — see also
[[2026-08-28-redesign-ui-ux-service-colors-mobile]].

## Solution

TBD. Likely a syntax-highlighting code editor (e.g. CodeMirror or Monaco)
with YAML-aware linting/validation for the compose editor, and a
structured key=value editor (with add/remove rows, secret masking) for the
env editor rather than raw text. Check CDN/bundle-size constraints before
picking a library.
