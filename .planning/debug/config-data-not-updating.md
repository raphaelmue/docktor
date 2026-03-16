---
status: diagnosed
trigger: "Investigate why config changes (version, ports) in docker-compose.yml are not reflected in UI or database."
created: 2026-03-16T00:00:00Z
updated: 2026-03-16T00:05:00Z
---

## Current Focus

hypothesis: CONFIRMED - FileWatcher only updates hash and sets configChanged flag, never calls replaceServices
test: traced handleFileChange implementation
expecting: root cause identified
next_action: document findings and fix approach

## Symptoms

expected: When docker-compose.yml is modified (version, ports changed), the UI and database should reflect the new values
actual: Yellow "config changed" badge appears, but service data (version, ports) remains stale in UI and database
errors: None reported
reproduction: Modify docker-compose.yml fields (image version, ports), observe that FileWatcher detects hash change but metadata doesn't update
started: Current behavior in 02-observability phase

## Eliminated

## Evidence

- timestamp: 2026-03-16T00:01:00Z
  checked: file-watcher.ts handleFileChange method (lines 97-161)
  found: Method calls parseComposeContent(content) for validation only (line 131), but never uses the parsed result. Only updates hash via updateStackHash (line 149) and sets configChanged flag (line 295 in stack-repository.ts)
  implication: Parsed service data is discarded; database services table never updated

- timestamp: 2026-03-16T00:02:00Z
  checked: stack-repository.ts replaceServices method (lines 105-128)
  found: Method exists and properly deletes old services and creates new ones with updated metadata from ComposeConfig. Used by updateStack in stack-service.ts (line 59)
  implication: The infrastructure to update services exists but is never called by FileWatcher

- timestamp: 2026-03-16T00:03:00Z
  checked: compose-parser.ts parseComposeContent function (lines 49-64)
  found: Correctly parses docker-compose.yml and returns ParsedService[] with serviceName, image, imageTag, ports, volumes
  implication: Parser works correctly; issue is in FileWatcher not using the parsed data

- timestamp: 2026-03-16T00:04:00Z
  checked: stack-service.ts updateStack method (lines 53-82)
  found: When compose content is updated via API, it calls createComposeConfig and then repo.replaceServices (line 59) to update service metadata
  implication: Manual updates work correctly; only file-based changes fail to update services

## Resolution

root_cause: FileWatcher.handleFileChange() parses the docker-compose.yml for validation (line 131) but discards the parsed result. It only updates the hash and sets configChanged flag, never calling stackRepository.replaceServices() to update service metadata (image, imageTag, ports, volumes) in the database. This is why the yellow badge appears (configChanged flag) but service data remains stale.

fix: After successful parse validation in handleFileChange, create a ComposeConfig object and call repo.replaceServices() to update service metadata, similar to how stack-service.ts updateStack does it (lines 58-59). This will synchronize the database services table with the actual compose file content.

verification:
1. Modify docker-compose.yml (change image tag or port)
2. Observe FileWatcher detects change (console logs)
3. Verify database services table contains new values
4. Verify UI displays updated image tag and ports
5. Verify yellow badge still appears correctly

files_changed:
  - server/src/jobs/file-watcher.ts (add replaceServices call after parse validation)
  - May need to import createComposeConfig from domain/compose-config.ts
