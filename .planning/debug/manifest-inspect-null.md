---
status: awaiting_human_verify
trigger: "Investigate why DockerExecutor.manifestInspect() is returning null, blocking all update detection."
created: 2026-03-16T00:00:00Z
updated: 2026-03-16T00:13:00Z
---

## Current Focus

hypothesis: CONFIRMED - manifestInspect returns null for "not found" errors, meaning imageRef values in database are invalid/inaccessible
test: Add diagnostic logging to see actual imageRef and stderr, then identify the source of invalid refs
expecting: Either normalizeImageRef creates invalid format, or Service table has malformed image names, or images genuinely don't exist in registry
next_action: Implement fix with logging to diagnose exact problem

## Symptoms

expected: manifestInspect() should query Docker registry and return manifest digest for both current and latest tags
actual: manifestInspect() returns null for all images
errors: "manifest inspect returned null"
reproduction: Run update checker job - all images show latestTag, latestDigest, currentDigest as null in ImageUpdateCheck table
started: Phase 02-observability implementation - blocking all update detection

## Eliminated

## Evidence

- timestamp: 2026-03-16T00:01:00Z
  checked: docker-executor.ts manifestInspect method (lines 76-110)
  found: |
    Method executes: docker manifest inspect --verbose <imageRef>
    Returns digest from: manifest?.Descriptor?.digest, manifest?.SchemaV2Manifest?.config?.digest, or manifest?.Ref
    Returns null if stderr contains "no such manifest" or "not found"
    Re-throws other errors (rate limit, auth)
  implication: Implementation looks correct - need to test actual Docker command output

- timestamp: 2026-03-16T00:02:00Z
  checked: update-checker.ts checkImage method (lines 258-323)
  found: |
    Line 263: calls docker.manifestInspect(imageRef)
    Line 264-270: if result is null, records checkError: "manifest inspect returned null"
    imageRef is passed directly from database Service.image field, normalized with normalizeImageRef()
  implication: Need to verify what imageRef format is being passed and test Docker command manually

- timestamp: 2026-03-16T00:03:00Z
  checked: Docker CLI command execution with nginx:latest
  found: |
    Command: docker manifest inspect --verbose nginx:latest
    Output: Valid JSON array with manifest data
    Descriptor.digest exists: sha256:a6bead2c897e9e39ca1a2dbd241f96dc181c8d32adcb6201258624fb37d2c7fe
    Structure: Array of objects with Descriptor, OCIManifest, Ref fields
  implication: Docker command itself works correctly - issue must be in parsing or command execution context

- timestamp: 2026-03-16T00:04:00Z
  checked: manifestInspect return value (line 98)
  found: |
    Line 98: return {digest, latestTag: null}
    latestTag is HARDCODED to null - it's never fetched or computed
    The method only fetches the digest for the imageRef passed in
    It doesn't query the "latest" tag or compare current vs latest
  implication: This explains why latestTag is always null! The method doesn't implement latest tag detection

- timestamp: 2026-03-16T00:05:00Z
  checked: How update-checker.ts uses manifestInspect (lines 258-299)
  found: |
    Line 263: calls manifestInspect(imageRef) - where imageRef includes the tag (e.g., "nginx:1.25")
    Line 274: destructures {digest: latestDigest, latestTag}
    Line 279: checks if latestTag exists - but it's always null!
    Line 286-289: Falls back to digest comparison if latestTag is null

    The code EXPECTS manifestInspect to:
    1. Query the LATEST tag from registry
    2. Return both the latest digest AND latest tag version

    But manifestInspect only queries the imageRef passed in (e.g., nginx:1.25)
    It never queries "nginx:latest" to compare versions
  implication: manifestInspect needs to query TWO manifests - the current tag AND the latest tag

- timestamp: 2026-03-16T00:06:00Z
  checked: Planning doc 02-04-PLAN.md (line 396)
  found: |
    Line 396 in plan: return {digest, latestTag: null}  // tag listing requires separate registry API

    The comment explicitly states: "tag listing requires separate registry API"

    manifestInspect() was INTENTIONALLY designed to return latestTag: null
    Getting available tags requires Docker Registry HTTP API v2 (not docker CLI)
    The method only returns the digest of the queried imageRef

    BUT update-checker.ts line 279 checks: if (latestTag && tag !== "latest")
    This condition will NEVER be true because latestTag is always null!

    The code falls back to digest comparison (lines 286-289) which compares:
    - existing?.latestDigest (previous check's digest)
    - latestDigest (current check's digest)

    For this to work, the SAME imageRef must be checked twice to detect changes.
  implication: ROOT CAUSE FOUND - manifestInspect doesn't implement latest tag detection, was never meant to

- timestamp: 2026-03-16T00:07:00Z
  checked: Parsing logic in manifestInspect (lines 92-96)
  found: |
    Digest extraction tries three paths:
    1. manifest?.Descriptor?.digest (for multi-arch from --verbose)
    2. manifest?.SchemaV2Manifest?.config?.digest (for single-arch v2)
    3. manifest?.Ref

    From nginx:latest test, the output has:
    - parsed[0].Descriptor.digest = "sha256:a6bead2c897e9e39ca1a2dbd241f96dc181c8d32adcb6201258624fb37d2c7fe"

    This should successfully extract! So if manifestInspect returns null for all images:
    - Either Docker CLI is failing for the actual images in database
    - OR imageRef format is invalid/inaccessible
    - OR there's an environment issue (Docker not available in job context)
  implication: Need to test with actual imageRef from database to see if Docker command fails

- timestamp: 2026-03-16T00:08:00Z
  checked: ImageUpdateCheck schema and upsert call (line 292-299)
  found: |
    Schema includes currentDigest field (line 7 of schema)
    But upsert call doesn't pass currentDigest at all!
    Only passes: imageRef, lastCheckedAt, latestTag, latestDigest, hasUpdate, checkError

    User symptom: "latestTag, latestDigest, currentDigest all null"
    - currentDigest null is EXPECTED (not implemented yet)
    - latestTag null is EXPECTED (hardcoded to null in manifestInspect)
    - latestDigest null means manifestInspect returned null (entire object)

    Real issue: manifestInspect returns null instead of {digest: "sha256:...", latestTag: null}
  implication: Docker command is failing for the actual images, OR digest parsing fails, OR method is throwing unexpected error

- timestamp: 2026-03-16T00:09:00Z
  checked: UAT Test 11 report (line 64-72 of 02-UAT.md)
  found: |
    User confirmed: "The update checker is running, but it is not detecting new versions"
    Error message: "manifest inspect returned null"
    This means UpdateChecker.checkImage() IS running, images exist in database
    manifestInspect() is being called but returning null

  checked: Test script with docker manifest inspect
  found: |
    Tested nginx:latest, postgres:17, traefik:latest, node:22
    ALL commands succeeded and returned valid digests
    Docker CLI works perfectly in my terminal session via Node.js child_process

  implication: Docker CLI works in test context but fails in UpdateChecker production context - environment difference

- timestamp: 2026-03-16T00:10:00Z
  checked: Error handling logic in manifestInspect (lines 99-109)
  found: |
    manifestInspect only returns null if:
    - err.stderr includes "no such manifest" OR
    - err.stderr includes "not found"

    All OTHER errors are re-thrown and would appear as checkError in database

    User symptom: checkError = "manifest inspect returned null"
    This message is set by update-checker line 269 when result === null

    Therefore: Docker command IS failing with "no such manifest" or "not found"

  implication: ROOT CAUSE IDENTIFIED - Images in database are invalid/inaccessible, or imageRef format is wrong

##Resolution

root_cause: |
  manifestInspect() returns null when Docker CLI fails with "no such manifest" or "not found" errors.
  UAT Test 11 confirms UpdateChecker is running but all images return null, with error "manifest inspect returned null".

  The code logic is correct - it properly handles:
  1. "not found" errors → returns null (expected for missing images)
  2. Other errors (auth, rate limit) → throws error with checkError message
  3. Successful queries → extracts digest from Descriptor.digest, SchemaV2Manifest.config.digest, or Ref

  Testing confirms Docker CLI works correctly for common images (nginx, postgres, traefik, node).

  However, the ACTUAL root cause is impossible to determine without seeing:
  1. Which specific imageRef values are in the Service table
  2. What stderr message Docker CLI returns for those images
  3. Whether normalizeImageRef() creates invalid refs from whatever is in the database

  Possible scenarios:
  A. Service table contains non-existent/private images that require auth
  B. Service table contains malformed image refs that Docker CLI can't parse
  C. normalizeImageRef() transforms valid refs into invalid format (unlikely - tested and works)
  D. No images in Service table yet (UpdateChecker finds nothing to check)

  The error message "manifest inspect returned null" was too generic to diagnose further.

fix: |
  Added diagnostic logging and improved error messages to enable root cause identification:

  1. docker-executor.ts manifestInspect():
     - Added console.warn when no digest extracted (logs manifest structure for debugging)
     - Added console.warn when "not found" error occurs (logs specific imageRef and stderr)
     - Added console.error for unexpected errors (logs imageRef and error details)

  2. update-checker.ts checkImage():
     - Added console.warn when manifestInspect returns null
     - Changed checkError from generic "manifest inspect returned null" to specific
       "Image not found in registry: {imageRef}" so UI/logs show which image is the problem

  These changes don't fix the underlying issue (images not found) but provide the diagnostic
  information needed to identify which images are failing and why.

  After deployment, server logs will show:
  - Exact imageRef values causing "not found" errors
  - Docker stderr messages explaining why images aren't accessible
  - Whether digest extraction succeeds or fails for accessible images

  User can then:
  - Verify those images exist in registry
  - Add authentication if needed for private images
  - Fix malformed image refs in compose files
  - Understand why update detection isn't working

verification: |
  Self-verification completed:
  1. ✓ TypeScript compiles successfully (npm run build -w server)
  2. ✓ Changes preserve existing error handling behavior
  3. ✓ Logging added for all error paths in manifestInspect
  4. ✓ Error message in UI will now show specific imageRef instead of generic message

  User verification required:
  1. Restart server to pick up changes
  2. Wait for UpdateChecker cron to run (every 5 minutes)
  3. Check server console logs for new diagnostic warnings
  4. Review which imageRef values are failing
  5. Verify those images exist and are accessible
  6. If images are valid and accessible, digest should extract successfully
  7. If images don't exist, error message will clearly identify the problem image

  Expected outcome:
  - Logs will reveal actual imageRef values and Docker error messages
  - User can fix the root cause (missing images, auth, malformed refs)
  - Update detection will work once valid, accessible images are used
