import {isScalar, isSeq, parseDocument, type Document, type Scalar} from "yaml";

// The shared external Docker network every proxied service joins (D-03).
// The proxy stack's own compose file owns the definition (non-external,
// created on that stack's first deploy); every target stack references it
// as external: true.
export const PROXY_NETWORK_NAME = "docktor_proxy";

export type ComposeProxyEditErrorReason = "no-services" | "service-not-found";

/**
 * Raised when a compose document cannot be edited for a given service's
 * proxy env vars — either the document has no `services` key at all, or the
 * named service doesn't exist in it. `reason` lets callers distinguish a
 * "service doesn't belong to this stack" case (404) from every other case
 * (400) without parsing the message text. Mirrors lib/compose-editor.ts's
 * ComposeEditError shape exactly.
 */
export class ComposeProxyEditError extends Error {
    constructor(
        message: string,
        public readonly reason: ComposeProxyEditErrorReason,
    ) {
        super(message);
        this.name = "ComposeProxyEditError";
    }
}

function assertServiceExists(doc: Document, serviceName: string): void {
    if (!doc.has("services")) {
        throw new ComposeProxyEditError("Compose file has no 'services' key", "no-services");
    }
    if (!doc.hasIn(["services", serviceName])) {
        throw new ComposeProxyEditError(`Service "${serviceName}" not found in compose file`, "service-not-found");
    }
}

/**
 * Mutates an existing scalar node's value in place (preserving its original
 * quoting style) when one already exists at `path`, otherwise creates a new
 * default-styled scalar via setIn — mirrors compose-editor.ts's
 * setServiceImageTag() targeted-mutation pattern exactly.
 */
function setEnvScalar(doc: Document, serviceName: string, key: string, value: string): void {
    const path = ["services", serviceName, "environment", key];
    const node = doc.getIn(path, true);
    if (isScalar(node)) {
        (node as Scalar).value = value;
    } else {
        doc.setIn(path, value);
    }
}

export interface ServiceProxyEnv {
    virtualHost: string;
    virtualPort: string;
    letsencryptHost: string | null;
}

export interface ServiceProxyEnvRead {
    virtualHost: string | null;
    virtualPort: string | null;
    letsencryptHost: string | null;
}

/**
 * Surgically sets `VIRTUAL_HOST`/`VIRTUAL_PORT`/`LETSENCRYPT_HOST` on one
 * service's `environment` block and adds the shared `docktor_proxy` network
 * to that service's `networks` list plus the top-level `networks` key —
 * preserving every other byte of the document (comments, key order,
 * quoting style, unrelated services) via the yaml package's Document API
 * rather than a full parse-and-restringify. Never call this once per
 * domain: callers must always aggregate every ProxyConfig row for a
 * (stackId, serviceName) pair into one comma-joined virtualHost/
 * letsencryptHost value first (the D-08 promote invariant) — nginx-proxy
 * only honours one VIRTUAL_HOST key per service, and a second call would
 * silently overwrite the first rather than adding a domain.
 */
export function setServiceProxyEnv(content: string, serviceName: string, env: ServiceProxyEnv): string {
    const doc = parseDocument(content);
    assertServiceExists(doc, serviceName);

    setEnvScalar(doc, serviceName, "VIRTUAL_HOST", env.virtualHost);
    setEnvScalar(doc, serviceName, "VIRTUAL_PORT", env.virtualPort);
    if (env.letsencryptHost) {
        setEnvScalar(doc, serviceName, "LETSENCRYPT_HOST", env.letsencryptHost);
    } else {
        doc.deleteIn(["services", serviceName, "environment", "LETSENCRYPT_HOST"]);
    }

    const networksPath = ["services", serviceName, "networks"];
    const networksNode = doc.getIn(networksPath, true);
    const existingNetworks: string[] = isSeq(networksNode) ? (networksNode.toJSON() as string[]) : [];
    if (!existingNetworks.includes(PROXY_NETWORK_NAME)) {
        doc.setIn(networksPath, [...existingNetworks, PROXY_NETWORK_NAME]);
    }
    doc.setIn(["networks", PROXY_NETWORK_NAME, "external"], true);

    return doc.toString({lineWidth: 0});
}

/**
 * Removes the proxy-related environment keys for one service. Not used by
 * the tracer slice (assignDomain is the only write path in this plan), but
 * declared alongside setServiceProxyEnv so 06-02's removeDomain() has the
 * mirror-image function to call.
 */
export function removeServiceProxyEnv(content: string, serviceName: string): string {
    const doc = parseDocument(content);
    assertServiceExists(doc, serviceName);

    doc.deleteIn(["services", serviceName, "environment", "VIRTUAL_HOST"]);
    doc.deleteIn(["services", serviceName, "environment", "VIRTUAL_PORT"]);
    doc.deleteIn(["services", serviceName, "environment", "LETSENCRYPT_HOST"]);

    return doc.toString({lineWidth: 0});
}

/**
 * Reads the current proxy env vars for a service, returning null for any
 * key that isn't set. Used by ProxyService to re-render the aggregate
 * comma-joined value when a new domain is assigned.
 */
export function readServiceProxyEnv(content: string, serviceName: string): ServiceProxyEnvRead {
    const doc = parseDocument(content);
    assertServiceExists(doc, serviceName);

    const read = (key: string): string | null => {
        const node = doc.getIn(["services", serviceName, "environment", key]);
        return node === undefined || node === null ? null : String(node);
    };

    return {
        virtualHost: read("VIRTUAL_HOST"),
        virtualPort: read("VIRTUAL_PORT"),
        letsencryptHost: read("LETSENCRYPT_HOST"),
    };
}
