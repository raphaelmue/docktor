import {isScalar, parseDocument, type Scalar} from "yaml";

export type ComposeEditErrorReason =
    | "no-services"
    | "service-not-found"
    | "no-image"
    | "digest-pinned";

/**
 * Raised when a compose document cannot be edited for a given service —
 * either the service (or its image) doesn't exist, or the image is pinned
 * by digest and has no tag to swap. `reason` lets callers distinguish a
 * "service doesn't belong to this stack" case (404) from every other case
 * (400) without parsing the message text.
 */
export class ComposeEditError extends Error {
    constructor(
        message: string,
        public readonly reason: ComposeEditErrorReason,
    ) {
        super(message);
        this.name = "ComposeEditError";
    }
}

/**
 * Splits an image reference into name and tag. A colon is a tag separator
 * only when no forward slash follows it — a colon followed later by a
 * slash is a registry port (e.g. "registry.example.com:5000/team/app"),
 * not a tag separator. Restated here rather than imported from
 * jobs/update-checker.ts's splitImageRef(): lib/ sits below jobs/ in this
 * project's layering (jobs depends on infrastructure and lib, never the
 * reverse), and jobs/update-checker.ts already imports the registryClient
 * singleton at module scope — importing back from lib/ risks the same
 * bottom-of-file-singleton TDZ crash documented in the 02-10 plan summary.
 */
function splitImageRef(imageRef: string): {name: string; tag: string | null} {
    const lastColon = imageRef.lastIndexOf(":");
    if (lastColon === -1 || imageRef.indexOf("/", lastColon) !== -1) {
        return {name: imageRef, tag: null};
    }
    return {name: imageRef.slice(0, lastColon), tag: imageRef.slice(lastColon + 1)};
}

function readServiceImage(doc: ReturnType<typeof parseDocument>, serviceName: string): string {
    if (!doc.has("services")) {
        throw new ComposeEditError("Compose file has no 'services' key", "no-services");
    }
    if (!doc.hasIn(["services", serviceName])) {
        throw new ComposeEditError(`Service "${serviceName}" not found in compose file`, "service-not-found");
    }
    if (!doc.hasIn(["services", serviceName, "image"])) {
        throw new ComposeEditError(`Service "${serviceName}" has no 'image' key`, "no-image");
    }

    const rawImage = String(doc.getIn(["services", serviceName, "image"]));
    if (rawImage.includes("@sha256:")) {
        throw new ComposeEditError(
            `Service "${serviceName}" image "${rawImage}" is pinned by digest; upgrading a digest pin is not supported`,
            "digest-pinned",
        );
    }
    return rawImage;
}

/**
 * Returns the current tag for a service's image, or null when the image
 * carries no explicit tag (Docker implies "latest" in that case). Throws
 * ComposeEditError for every case setServiceImageTag would also reject, so
 * callers can validate before attempting a write.
 */
export function getServiceImageTag(content: string, serviceName: string): string | null {
    const doc = parseDocument(content);
    const rawImage = readServiceImage(doc, serviceName);
    return splitImageRef(rawImage).tag;
}

/**
 * Rewrites a single service's image tag in a compose document, preserving
 * every other line — comments, key order, quoting style, and unrelated
 * services — byte for byte. Uses the yaml package's Document API (parse +
 * targeted node mutation + toString) rather than parse-and-restringify,
 * which would discard comments and normalize formatting across the whole
 * file on every upgrade.
 */
export function setServiceImageTag(content: string, serviceName: string, newTag: string): string {
    const doc = parseDocument(content);
    const rawImage = readServiceImage(doc, serviceName);
    const {name} = splitImageRef(rawImage);
    const newImage = `${name}:${newTag}`;

    const path = ["services", serviceName, "image"];
    const imageNode = doc.getIn(path, true);
    if (isScalar(imageNode)) {
        // Mutating the existing scalar node's value (rather than doc.setIn,
        // which would create a fresh default-styled scalar) preserves the
        // node's original quoting style.
        (imageNode as Scalar).value = newImage;
    } else {
        doc.setIn(path, newImage);
    }

    return doc.toString({lineWidth: 0});
}
