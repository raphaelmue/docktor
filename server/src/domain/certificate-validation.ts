import {createPrivateKey, X509Certificate} from "node:crypto";

/**
 * Result of attempting to parse PEM content as an X.509 certificate.
 * parseCertificate() never throws raw — a malformed input always produces
 * the `ok: false` branch with a fixed, non-interpolating reason.
 */
export type ParseCertificateResult = {ok: true; cert: X509Certificate} | {ok: false; reason: string};

/**
 * Result of validating that a certificate and a private key belong
 * together. Every failure `reason` is a fixed, human-readable sentence that
 * never interpolates any part of the supplied PEM material — a reason may be
 * rendered in the UI and may be logged (T-09-30).
 */
export type CertificateValidationResult = {valid: true} | {valid: false; reason: string};

/**
 * Parses PEM (or DER) content as an X.509 certificate using Node's built-in
 * X509Certificate — no third-party PEM/ASN.1 parser. Never throws: malformed
 * input produces a typed failure with a fixed reason string.
 */
export function parseCertificate(pem: string): ParseCertificateResult {
    try {
        return {ok: true, cert: new X509Certificate(pem)};
    } catch {
        return {ok: false, reason: "Certificate is not a valid PEM/DER X.509 certificate"};
    }
}

/**
 * Validates that an uploaded certificate and private key belong together
 * (D-12). Distinguishes three failure classes with different, fixed
 * reasons: the certificate is not parseable, the key is not parseable, and
 * the key does not match the certificate. The match check uses the
 * certificate's own `checkPrivateKey` method against a KeyObject built from
 * the key PEM — never a hand-rolled modulus comparison, never an OpenSSL
 * shell-out.
 */
export function validateCertKeyPair(certPem: string, keyPem: string): CertificateValidationResult {
    const parsedCert = parseCertificate(certPem);
    if (!parsedCert.ok) {
        return {valid: false, reason: parsedCert.reason};
    }

    let privateKey;
    try {
        privateKey = createPrivateKey(keyPem);
    } catch {
        return {valid: false, reason: "Key is not a valid private key"};
    }

    if (!parsedCert.cert.checkPrivateKey(privateKey)) {
        return {valid: false, reason: "Private key does not match certificate"};
    }

    return {valid: true};
}

/**
 * Reports whether a certificate covers a declared domain pattern (D-12).
 *
 * For a wildcard pattern (e.g. "*.example.com"), this compares directly
 * against the certificate's subject alternative names for an EXACT pattern
 * match — X509Certificate.checkHost() validates a concrete hostname against
 * a certificate, not a pattern against a pattern, so it cannot answer "does
 * this cert declare exactly this wildcard" (a cert with SAN "*.foo.com"
 * would incorrectly appear to "cover" the pattern "*.example.com" under
 * host-matching semantics if we tried to check a representative hostname,
 * since checkHost's wildcard matching only compares a single label).
 *
 * For a non-wildcard (concrete) pattern, checkHost() is the correct check:
 * it applies standard hostname-matching semantics, including matching a
 * concrete hostname against a wildcard SAN entry the certificate carries.
 */
export function certCoversDomainPattern(cert: X509Certificate, domainPattern: string): boolean {
    if (domainPattern.startsWith("*.")) {
        const sanEntries = (cert.subjectAltName ?? "")
            .split(",")
            .map((entry) => entry.trim());
        return sanEntries.includes(`DNS:${domainPattern}`);
    }

    return cert.checkHost(domainPattern) !== undefined;
}

/**
 * Returns the certificate's not-after value as a Date, using the
 * date-typed accessor (validToDate) rather than parsing the string form
 * (validTo).
 */
export function certificateExpiry(cert: X509Certificate): Date {
    return cert.validToDate;
}
