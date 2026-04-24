# Refactor Findings Log

A running log of bugs, conflicts, friction, and suspicious patterns discovered during the structural refactor. Entries are added the moment something is noticed — not batched. Each entry has a stable ID that commits can reference.

See [docs/ENGINEERING.md](ENGINEERING.md) for the target architecture and [plan file](../../.claude/plans/i-would-like-us-abundant-parnas.md) for execution discipline.

## Status legend

- **open** — not yet addressed
- **deferred** — will be fixed post-refactor; captured for future work
- **fixed-in-\<sha>** — resolved, commit linked

## Severity

- **bug** — incorrect behavior, runtime risk, or security concern
- **conflict** — two places in the codebase that disagree or duplicate each other
- **smell** — pattern that will cause pain later (not currently broken)
- **question** — needs user decision before action can be taken

## Entry template

```
### F-NNN: <short title>
- Location: path/to/file.ts:L123 (or multiple paths)
- Found during: P<N> <phase-name>
- Severity: bug | conflict | smell | question
- Description: <what's wrong>
- Evidence: <code snippet, repro, or trace>
- Proposed resolution: fix-now | defer-to-post-refactor | needs-user-decision
- Status: open | deferred | fixed-in-<commit-sha>
```

---

## Baseline state (captured at `refactor/baseline`)

- **`npm run build`**: ✅ green (Next.js build succeeds, exit 0).
- **`npm run typecheck`** (new script): ✅ green (`tsc --noEmit` passes clean).
- **`npm run lint`**: 59 errors, 84 warnings (after adding `packages/*/dist/**` to ignores). Original state was 162 errors / 1124 warnings — the delta was entirely built/minified output being linted.
- **Refactor gate from here on**: build + typecheck must stay green for every commit; lint must not regress from the baseline error/warning count (the 59 errors are pre-existing debt, logged below).
- **Ignored from lint**: `packages/*/dist/**` (built output, added in `fix(p0)` commit).

---

## Findings

### F-001: Ingestion pipeline already partially split — duplicate or stale code likely
- Location: `src/lib/ingestion/pipeline.ts` (1212 lines) + `src/lib/ingestion/extractors/{github,instagram,reddit,twitter,web,text,image}.ts`
- Found during: P0 pre-flight
- Severity: conflict
- Description: `extractors/` directory exists with 7 platform files (totaling ~1900 lines) AND `pipeline.ts` is still 1212 lines. Either the extractors were split out and pipeline still has orphaned copies of the logic, or the extractors are a separate code path and pipeline has its own inline platform handling. Needs investigation at the start of P3a.
- Evidence: `wc -l src/lib/ingestion/pipeline.ts src/lib/ingestion/extractors/*.ts` → 1212 + 1905 = 3117 total lines.
- Proposed resolution: defer-to-P3a — investigate at start of pipeline split phase; if duplicate, dedupe in that phase as in-scope fix-now.
- Status: open

### F-002: Unused `depth` parameter across multiple extractors
- Location: `src/lib/ingestion/extractors/{github,instagram,reddit,twitter}.ts` (lint warning in each)
- Found during: P0 pre-flight (lint output)
- Severity: smell
- Description: 4 of 7 extractors accept a `depth` parameter they never use. Suggests the extractor signature was generalized for link-following but most platforms don't recurse. Either remove the unused param (if truly unused) or implement depth handling (if it was intended and got dropped).
- Proposed resolution: defer-to-P3a — fix during the pipeline split (the extractor signature should be normalized as part of that phase anyway).
- Status: open

### F-003: Lint error in `with-auth.ts` — `any` type and dead eslint-disable
- Location: `src/lib/auth/with-auth.ts:56` (unused eslint-disable), `:58:45` (`any` type)
- Found during: P0 pre-flight (lint output)
- Severity: smell
- Description: The shared auth wrapper (which we're explicitly reusing instead of inventing `requireUser`) has a lint error we should clean up before migrating it to `src/shared/auth/` in P6. One `any` type on line 58.
- Proposed resolution: defer-to-P6 — fix during the `src/lib/auth/with-auth.ts` → `src/shared/auth/with-auth.ts` migration.
- Status: open

### F-004: `connection-panel.tsx` has 5 lint errors at one location (L195)
- Location: `src/components/canvas/panels/connection/connection-panel.tsx:195`
- Found during: P0 pre-flight
- Severity: smell
- Description: Lint reports 5 errors all flagged at line 195 column 3. Suggests a dense block of offending code (likely `any` types or similar). Not blocking but worth cleaning when the file is touched.
- Proposed resolution: defer-to-post-refactor — not on the primary refactor path.
- Status: open

### F-005: Built/minified output was being linted (pre-existing config bug)
- Location: `eslint.config.mjs` (missing `packages/*/dist/**` ignore)
- Found during: P0 pre-flight
- Severity: bug (config)
- Description: 103 of 162 lint errors came from linting minified files in `packages/chrome-extension/dist/` and `packages/mcp-server/dist/`. These are build artifacts that should never be linted. Likely the Chrome extension dist was accidentally committed.
- Proposed resolution: fix-now as part of P0 (already done).
- Status: fixed-in-p0 (see P0 fix commit)

### F-006: 59 real lint errors still exist at baseline
- Location: various (top offenders: `connection-panel.tsx:195` [5], `page.tsx` [3], `proxy.ts` [2], `entry-panel.tsx` [2], `chat-panel.tsx` [2], Chrome extension `*.tsx` [several])
- Found during: P0 pre-flight
- Severity: smell
- Description: Pre-existing lint debt. Refactor gate accepts these as baseline — new commits must not increase the count.
- Proposed resolution: defer-to-post-refactor — not in scope of this refactor; track for future cleanup PR.
- Status: open

### F-007: Chrome extension source uses PascalCase filenames — inconsistent with main app
- Location: `packages/chrome-extension/src/panel/{App.tsx,components/*,views/*,hooks/*}`
- Found during: Earlier audit (pre-P0)
- Severity: smell
- Description: Main app uses kebab-case (`entry-card.tsx`); chrome-extension uses PascalCase (`EntryCard.tsx`). Already scheduled for P6 cleanup per the refactor plan.
- Proposed resolution: defer-to-P6.
- Status: open

### F-008: Landing `page.tsx` still imports `@/hooks/use-speech-recognition` but hooks/ is not scoped to shared yet
- Location: `src/app/page.tsx`, `src/hooks/use-speech-recognition.ts`
- Found during: P0 pre-flight (audit review)
- Severity: smell
- Description: The single file in `src/hooks/` is `use-speech-recognition.ts`, imported by the landing page. Plan already schedules this move to `src/shared/hooks/` in P6.
- Proposed resolution: defer-to-P6.
- Status: open

---

## Findings added during refactor (P1 onwards)

<!-- New findings are appended here during each phase. -->
