/**
 * Serializes async work per key: two calls made with the same key never
 * overlap — the second call's function starts only after the first has
 * settled (resolved or rejected) — while calls made with different keys run
 * fully concurrently, each on its own independent chain.
 *
 * Used to serialize every proxy-configuration compose read-modify-write
 * cycle per stack id (T-06-09): two requests targeting the same stack's
 * `docker-compose.yml` must never interleave their read/write, or one can
 * silently clobber the other's edit.
 *
 * Dependency-free by design — no imports beyond what TypeScript needs — so
 * this stays trivially unit-testable in isolation.
 */
const chains = new Map<string, Promise<void>>();

export async function withKeyedLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const previousLink = chains.get(key) ?? Promise.resolve();

    // `previousLink` never rejects (see below), so `.then(fn)` runs `fn`
    // once the previous same-key caller has fully settled, regardless of
    // whether that caller's own function resolved or rejected.
    const result = previousLink.then(fn);

    // The tail every subsequent same-key caller awaits. A rejection here
    // must never poison the chain for later callers, so it's swallowed on
    // this shared link — the actual rejection still propagates to this
    // call's own caller below, via `result`, not via `nextLink`.
    const nextLink: Promise<void> = result.then(
        () => undefined,
        () => undefined,
    );
    chains.set(key, nextLink);

    try {
        return await result;
    } finally {
        // Only the last call to have set the map entry for this key clears
        // it — an identity check, not a value check, so an interleaved
        // later call's own entry is never clobbered by an earlier call's
        // cleanup. This is what keeps the map from growing without bound
        // while a key is idle.
        if (chains.get(key) === nextLink) {
            chains.delete(key);
        }
    }
}
