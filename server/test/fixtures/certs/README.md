# Test fixtures — throwaway, self-signed, no production or trust value

These are self-signed certificates and keys generated with OpenSSL solely for this
project's unit tests. They are not issued by any certificate authority, are not used
by any running system, and must never be treated as trusted material.

- `leaf.crt` / `leaf.key` — matching certificate/key pair; SANs cover both
  `example.com` and `*.example.com`.
- `unrelated.key` — a second, unrelated private key used to exercise the
  key/certificate-mismatch rejection path.
- `ca-bundle.crt` — a second, unrelated self-signed certificate standing in as a
  CA/intermediate bundle for chain-concatenation tests.
