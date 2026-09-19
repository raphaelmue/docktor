import fs from "node:fs/promises";
import path from "node:path";
import {getStackPath} from "../lib/stacks-dir.js";
import {PROXY_STACK_ID} from "../application/proxy-service.js";
import {PROXY_CERTS_SUBPATH} from "../lib/proxy-stack-compose.js";

// Owner-only permissions — the private key file must never be group/world
// readable on the host (T-09-35). The certs directory itself is already
// mounted read-only into nginx-proxy and read-write into acme-companion by
// the existing proxy compose template; this is the file-level mitigation on
// top of that.
const PRIVATE_KEY_MODE = 0o600;

export interface CertificateFileContent {
    certificate: string;
    privateKey: string;
    caBundle?: string | null;
}

/**
 * Owns all certificate file I/O so CertificateService stays testable with a
 * plain object. Never logs the content of anything it writes (T-09-30).
 */
export class CertificateFilesystem {
    /**
     * Resolves the proxy stack's certificates directory. Derived from the
     * existing single definitions (PROXY_STACK_ID, PROXY_CERTS_SUBPATH)
     * rather than re-spelled here.
     */
    getCertsDir(): string {
        return path.join(getStackPath(PROXY_STACK_ID), PROXY_CERTS_SUBPATH);
    }

    /**
     * Resolves a target file path and asserts it is still contained inside
     * the certificates directory — mirrors the escape guard in
     * getStackPath() (T-09-31 defense in depth, third of three layers
     * behind domainPatternRegex and certFileBaseName's own checks).
     */
    private resolveCertPath(baseName: string, extension: "crt" | "key"): string {
        const certsDir = this.getCertsDir();
        const resolved = path.join(certsDir, `${baseName}.${extension}`);
        if (resolved !== certsDir && !resolved.startsWith(certsDir + path.sep)) {
            throw new Error(
                `Certificate file "${baseName}.${extension}" resolves outside the certificates directory (${resolved} is not under ${certsDir}) — refusing to write it`,
            );
        }
        return resolved;
    }

    /**
     * Writes <baseName>.crt and <baseName>.key under the certificates
     * directory, creating it if missing. When a CA bundle is supplied, the
     * .crt content is the leaf certificate followed by a newline followed
     * by the bundle, so the proxy serves a complete chain (D-09) without the
     * user hand-concatenating anything. The key file is written with
     * owner-only permissions (0o600).
     */
    async writeCertificateFiles(baseName: string, content: CertificateFileContent): Promise<void> {
        const certsDir = this.getCertsDir();
        const crtPath = this.resolveCertPath(baseName, "crt");
        const keyPath = this.resolveCertPath(baseName, "key");

        await fs.mkdir(certsDir, {recursive: true});

        const crtContent = content.caBundle
            ? `${content.certificate.trimEnd()}\n${content.caBundle}`
            : content.certificate;

        await fs.writeFile(crtPath, crtContent, "utf-8");

        // Open explicitly with the owner-only mode instead of writeFile +
        // chmod: fs.open's mode argument is applied atomically at file
        // creation (O_CREAT), so the key file never exists at a wider mode
        // even transiently (T-09-35 TOCTOU fix). A plain `fs.writeFile` with
        // a bare encoding argument creates at the process default mode
        // (0o666 minus umask), leaving a world-readable window until a
        // separate chmod resolves. The trailing chmod below remains as a
        // defense-in-depth backstop for the overwrite case, where an
        // existing file on disk may carry a stale, wider mode from before
        // this fix landed.
        const keyHandle = await fs.open(keyPath, "w", PRIVATE_KEY_MODE);
        try {
            await keyHandle.writeFile(content.privateKey, "utf-8");
        } finally {
            await keyHandle.close();
        }
        await fs.chmod(keyPath, PRIVATE_KEY_MODE);
    }

    /**
     * Removes <baseName>.crt and <baseName>.key, tolerating absence.
     */
    async removeCertificateFiles(baseName: string): Promise<void> {
        const crtPath = this.resolveCertPath(baseName, "crt");
        const keyPath = this.resolveCertPath(baseName, "key");
        await fs.unlink(crtPath).catch(() => {});
        await fs.unlink(keyPath).catch(() => {});
    }
}

export const certificateFilesystem = new CertificateFilesystem();
