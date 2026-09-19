import {BadRequestError} from "../lib/errors.js";

/**
 * Derives the on-disk certificate file base name from a Certificate's own
 * domain pattern.
 *
 * nginx-proxy (nginxproxy/nginx-proxy, the fork this project pins — see
 * server/src/lib/proxy-stack-compose.ts) resolves a wildcard certificate
 * under its PARENT domain, not an underscore-prefixed name: a certificate
 * covering "*.example.com" is served from "example.com.crt", NOT
 * "_.example.com.crt". Source: github.com/nginx-proxy/nginx-proxy's own
 * docs (docs/README.md, SSL certificate naming section), confirmed against
 * the upstream project in 09-RESEARCH.md — the underscore convention is
 * common in other reverse-proxy tooling but is not what this project's
 * nginx-proxy fork actually looks for.
 *
 * Defense in depth behind domainPatternRegex (shared/src/validation/proxy.ts):
 * throws BadRequestError if the resulting base name still contains a path
 * separator (either kind), a ".." segment, a null byte, or is empty, so this
 * function stays safe even if a future caller forgets to validate the
 * pattern first.
 */
export function certFileBaseName(domainPattern: string): string {
    const baseName = domainPattern.startsWith("*.") ? domainPattern.slice(2) : domainPattern;

    if (
        baseName.length === 0 ||
        baseName.includes("/") ||
        baseName.includes("\\") ||
        baseName.includes("..") ||
        baseName.includes("\0")
    ) {
        throw new BadRequestError(
            `Domain pattern "${domainPattern}" does not derive a safe certificate file name`,
        );
    }

    return baseName;
}
