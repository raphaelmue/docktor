/**
 * Pure comparison logic for deciding whether an "Update Images" run actually
 * changed anything. Deliberately has no imports from repositories,
 * infrastructure, jobs or Prisma, and performs no I/O of any kind — the
 * caller (StackService.updateImages()) is responsible for resolving the
 * before/after digests via DockerExecutor.imageDigest() and handing the
 * results here.
 */

/**
 * A single service's image ref plus the local image store digest observed
 * before and after a pull. `before`/`after` are `string | null` because the
 * local image store legitimately has no digest for an image that is absent
 * (never pulled) or was built locally rather than pulled from a registry.
 */
export interface ImageDigestComparison {
    readonly ref: string;
    readonly before: string | null;
    readonly after: string | null;
}

/**
 * Reconstructs the canonical imageRef for a service's stored `image` +
 * `imageTag` fields, using the same spelling as
 * `buildImageRefFromService`/`normalizeImageRef` in
 * `jobs/update-checker.ts` — that spelling is the one already proven to
 * resolve against the local image store (it is what UpdateChecker already
 * passes to `imageDigest()`).
 *
 * Duplicated locally rather than imported: the domain layer must not depend
 * on `jobs/`, and importing `jobs/update-checker.ts` here would drag
 * node-cron, semver and the registry-client singleton into the application
 * unit-test module graph. The parity test in
 * `image-update-detection.test.ts` is the guard against the two copies
 * drifting apart — this mirrors the precedent and reasoning already
 * documented at the top of `infrastructure/registry-client.ts`.
 *
 * Returns null when there is no non-blank image — a build-only service has
 * no image to compare, so it must be excluded rather than turned into a ref
 * that can never resolve.
 */
export function toImageRef(service: {image: string | null; imageTag: string | null}): string | null {
    if (!service.image || !service.image.trim()) return null;

    let ref = service.imageTag ? `${service.image}:${service.imageTag}` : service.image;
    ref = ref
        .replace(/^docker\.io\/library\//, "")
        .replace(/^docker\.io\//, "");
    if (!ref.includes(":")) ref = `${ref}:latest`;
    return ref;
}

/**
 * Decides whether nothing changed across an image update run, from
 * before/after local image digests only — never from parsing the pull
 * command's free-text progress output (that vocabulary is not a stable
 * Docker interface; see the debug session that traced this bug).
 *
 * Returns true only on positive evidence: the list is non-empty and every
 * entry has a non-empty `before` digest that strictly equals its `after`
 * digest. Every other shape — an empty list, a null or empty digest on
 * either side, any inequality — returns false.
 *
 * The bias is deliberate: telling a user nothing changed when something
 * did is the failure being fixed here, so an unknown digest must fall back
 * to the generic "images updated" message rather than the confident
 * "already up to date" one.
 */
export function detectNoUpdates(comparisons: readonly ImageDigestComparison[]): boolean {
    if (comparisons.length === 0) return false;
    return comparisons.every((c) => Boolean(c.before) && c.before === c.after);
}
