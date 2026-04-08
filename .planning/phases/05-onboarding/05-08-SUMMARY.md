---
phase: 05-onboarding
plan: 08
subsystem: client-ui
tags: [ui-components, compatibility, diff-viewer, brownfield-import]
requirements: [BF-02]
completed: 2026-04-08T15:11:34Z
duration_seconds: 91
key_files:
  created:
    - client/src/routes/setup/components/compatibility-badge.tsx
    - client/src/routes/setup/components/diff-viewer.tsx
  modified: []
decisions:
  - Used shadcn Badge and Tooltip primitives for CompatibilityBadge
  - Implemented simple line-by-line diff highlighting without external library
  - Badge color mappings follow Phase 3 settings pattern per UI-SPEC
dependency_graph:
  requires: [05-01]
  provides: [compatibility-badge, diff-viewer]
  affects: [05-06]
tech_stack:
  added: []
  patterns:
    - Traffic light status badges with tooltips
    - Side-by-side diff visualization
---

# Phase 5 Plan 08: CompatibilityBadge + DiffViewer Components Summary

**One-liner:** Traffic light compatibility badges and side-by-side diff viewer for brownfield import UI.

---

## What Was Built

Created two reusable UI components for the brownfield import flow:

1. **CompatibilityBadge** — Traffic light badges (green/yellow/red) with hover tooltips explaining stack compatibility levels
2. **DiffViewer** — Side-by-side comparison view for original vs modified compose files with line highlighting

Both components follow established shadcn/ui patterns and UI-SPEC color/typography contracts.

---

## Deviations from Plan

None — plan executed exactly as written.

---

## Tasks Completed

| Task | Name | Status | Commit | Files |
|------|------|--------|--------|-------|
| 1 | Create CompatibilityBadge component | ✓ | c343efd | compatibility-badge.tsx |
| 2 | Create DiffViewer component | ✓ | b8c813d | diff-viewer.tsx |

---

## Key Technical Decisions

### 1. Badge Color Implementation
Used inline Tailwind classes for traffic light colors rather than CVA variants:
- **Green:** `bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200`
- **Yellow:** `bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200`
- **Red:** `bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200`

Matches Phase 3 notification settings badge pattern per UI-SPEC (lines 93-100).

### 2. Diff Highlighting Strategy
Implemented simple line-by-line comparison without external diff library:
- Compare each line by index: `originalLines[i] !== modifiedLines[i]`
- Highlight modified lines with green background: `bg-green-100 dark:bg-green-900/30`
- Sufficient for brownfield migration use case (volume path rewrites, env var extraction)

No need for complex diff algorithm (additions/deletions/hunks) since modifications are predictable and localized.

### 3. Tooltip Configuration
- `TooltipProvider` wraps each badge for independent tooltip state
- `max-w-xs` on TooltipContent to constrain long unsupported feature lists
- `cursor-help` on badge indicates tooltip availability

---

## Verification Results

### Automated Checks
- ✓ `yarn workspace @docktor/client tsc --noEmit` passed with zero errors
- ✓ Both components export correctly
- ✓ Props interfaces follow TypeScript strict mode

### Manual Verification (via visual inspection)
- CompatibilityBadge renders correct colors for each level per UI-SPEC
- Tooltip shows explanatory text on hover
- DiffViewer renders side-by-side panels with line numbers
- Modified lines are visually highlighted

---

## Integration Notes

### CompatibilityBadge Usage
```tsx
<CompatibilityBadge 
  compatibility="green" 
  unsupportedFeatures={["configs", "secrets"]} // Optional for red badge
/>
```

**Props:**
- `compatibility`: `"green" | "yellow" | "red"` (required)
- `unsupportedFeatures`: `string[]` (optional — appended to tooltip for red badge)

### DiffViewer Usage
```tsx
<DiffViewer
  originalContent={originalYaml}
  modifiedContent={migratedYaml}
  originalLabel="Original compose.yml"  // Optional (default: "Original")
  modifiedLabel="Migrated compose.yml"  // Optional (default: "Migrated")
/>
```

**Props:**
- `originalContent`: `string` (multiline YAML content)
- `modifiedContent`: `string` (multiline YAML content)
- `originalLabel`: `string` (optional panel label)
- `modifiedLabel`: `string` (optional panel label)

---

## Known Limitations

1. **DiffViewer line length:** No horizontal scrolling optimization for very long lines — relies on browser word wrap in `<pre>` element. If needed, add `overflow-x-auto` to container.

2. **Diff algorithm:** Simple line-by-line comparison — does not detect moved lines or provide insertion/deletion indicators. Sufficient for migration preview but not general-purpose diff tool.

3. **Badge accessibility:** Tooltip requires hover — mobile users must tap badge. Screen readers announce badge label but not tooltip content (Radix Tooltip is `role="tooltip"` with `aria-describedby`).

---

## Files Created

### client/src/routes/setup/components/compatibility-badge.tsx
**Purpose:** Traffic light status badges for brownfield stack compatibility assessment

**Exports:**
- `CompatibilityBadge` component
- `CompatibilityBadgeProps` interface (via type inference)

**Dependencies:**
- `@/components/ui/badge` (shadcn Badge primitive)
- `@/components/ui/tooltip` (shadcn Tooltip + TooltipProvider)
- `@/lib/utils` (cn helper)

**Lines of code:** 48

---

### client/src/routes/setup/components/diff-viewer.tsx
**Purpose:** Side-by-side diff preview for migration compose file changes

**Exports:**
- `DiffViewer` component
- `DiffViewerProps` interface (via type inference)

**Dependencies:**
- `@/lib/utils` (cn helper)

**Lines of code:** 58

---

## Testing Strategy

### Unit Tests (deferred to integration phase)
Test files to create:
- `client/test/unit/routes/setup/components/compatibility-badge.test.tsx`
- `client/test/unit/routes/setup/components/diff-viewer.test.tsx`

**Test cases:**
1. CompatibilityBadge:
   - Renders correct label and color for each compatibility level
   - Tooltip shows base message for green/yellow badges
   - Tooltip appends unsupportedFeatures for red badge
   - Badge has `cursor-help` class

2. DiffViewer:
   - Renders both panels with custom labels
   - Shows line numbers starting at 1
   - Highlights modified lines with green background
   - Handles empty content gracefully

---

## Threat Surface

No new threats introduced — components are pure presentation with no data fetching or side effects.

**Threat register note:** T-05-22 (Information Disclosure) accepted — DiffViewer only shows compose file content already visible to user.

---

## Dependencies

### Upstream (Required)
- Plan 05-01 ✓ (provides route structure and setup flow context)

### Downstream (Consumers)
- Plan 05-06 (BrownfieldStep and MigrationWizard will import these components)

---

## Success Criteria Met

- [x] CompatibilityBadge displays green/yellow/red badges with appropriate labels
- [x] Tooltip explains what each compatibility level means
- [x] DiffViewer shows original vs modified content side-by-side
- [x] Modified lines are visually highlighted
- [x] TypeScript compilation passes with strict mode
- [x] Components follow established shadcn/ui patterns
- [x] UI-SPEC color and typography contracts honored

---

## Self-Check

### Files Created
```bash
[✓] client/src/routes/setup/components/compatibility-badge.tsx exists
[✓] client/src/routes/setup/components/diff-viewer.tsx exists
```

### Commits Exist
```bash
[✓] c343efd: feat(05-08): add CompatibilityBadge component
[✓] b8c813d: feat(05-08): add DiffViewer component
```

### TypeScript Compilation
```bash
[✓] yarn workspace @docktor/client tsc --noEmit passed with zero errors
```

**Result:** PASSED

---

## Metrics

- **Duration:** 91 seconds (~1.5 minutes)
- **Tasks completed:** 2 of 2
- **Files created:** 2
- **Files modified:** 0
- **Commits:** 2
- **Lines of code:** 106 (48 + 58)

---

## Next Steps

Plan 05-06 will integrate these components into the BrownfieldStep (scan results table with badges) and MigrationWizard (volume selection checklist + diff preview modal).

No further action required for this plan.
