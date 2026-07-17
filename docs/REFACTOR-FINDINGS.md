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
- Status: obsolete (verified 2026-07-17 audit — `src/lib/ingestion/` and the entire ingestion pipeline/extractors were removed; no `pipeline.ts` or `extractors/` exists anywhere in `src`)

### F-002: Unused `depth` parameter across multiple extractors
- Location: `src/lib/ingestion/extractors/{github,instagram,reddit,twitter}.ts` (lint warning in each)
- Found during: P0 pre-flight (lint output)
- Severity: smell
- Description: 4 of 7 extractors accept a `depth` parameter they never use. Suggests the extractor signature was generalized for link-following but most platforms don't recurse. Either remove the unused param (if truly unused) or implement depth handling (if it was intended and got dropped).
- Proposed resolution: defer-to-P3a — fix during the pipeline split (the extractor signature should be normalized as part of that phase anyway).
- Status: obsolete (verified 2026-07-17 audit — the `extractors/` directory and all 7 platform files were deleted with the ingestion pipeline; no `depth` param survives)

### F-003: Lint error in `with-auth.ts` — `any` type and dead eslint-disable
- Location: `src/lib/auth/with-auth.ts:56` (unused eslint-disable), `:58:45` (`any` type)
- Found during: P0 pre-flight (lint output)
- Severity: smell
- Description: The shared auth wrapper (which we're explicitly reusing instead of inventing `requireUser`) has a lint error we should clean up before migrating it to `src/shared/auth/` in P6. One `any` type on line 58.
- Proposed resolution: defer-to-P6 — fix during the `src/lib/auth/with-auth.ts` → `src/shared/auth/with-auth.ts` migration.
- Status: fixed (verified 2026-07-17 audit — migrated to `src/shared/auth/with-auth.ts`; the remaining `any` types now carry USED `eslint-disable`/`eslint-disable-next-line` comments at L56-57/L61, and the whole-src eslint pass reports 0 errors per F-006)

### F-004: `connection-panel.tsx` has 5 lint errors at one location (L195)
- Location: `src/components/canvas/panels/connection/connection-panel.tsx:195`
- Found during: P0 pre-flight
- Severity: smell
- Description: Lint reports 5 errors all flagged at line 195 column 3. Suggests a dense block of offending code (likely `any` types or similar). Not blocking but worth cleaning when the file is touched.
- Proposed resolution: defer-to-post-refactor — not on the primary refactor path.
- Status: obsolete (verified 2026-07-17 audit — `connection-panel.tsx` and the whole `src/components/canvas/` tree were deleted with the canvas feature, F-036)

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
- Status: RESOLVED — `npx eslint src packages/mcp-server/src packages/dopl-client/src` now reports **0 errors** (was 38 errors / 20 warnings at the start of the cleanup pass). Fixes were behavior-preserving: `<a>`→`next/link` on marketing/auth internal nav; escaped apostrophes in accept-invite-card; `react-hooks/immutability` in markdown-message via a non-global presence-test regex; `set-state-in-effect` fixed by migrating skill-panel's load to `useApiQuery`, moving desktop-complete's early `setError` into the async IIFE, and converting workflow-panel's prop-sync to the adjust-during-render pattern (focus tracked in state, not a ref); `react-hooks/refs` fixed by moving the canvas-db-sync seed + `latestStateRef`/`stateRef` writes out of render into effects (seed reads an initial-state ref, declared first so it lands before the write-through effects). 11 warnings remain, all pre-existing and intentionally left: 8 `react-hooks/exhaustive-deps` (canvas-db-sync `workspaceId` ×7 + canvas.tsx `dispatch` — deliberate omissions; adding the deps changes save/effect behavior) and 3 `no-unused-vars` that are intentional patterns (`_grid`, the `{ history: _, ...rest }` omit, and proxy.ts `options` signature param).

### F-007: Chrome extension source uses PascalCase filenames — inconsistent with main app
- Location: `packages/chrome-extension/src/panel/{App.tsx,components/*,views/*,hooks/*}`
- Found during: Earlier audit (pre-P0)
- Severity: smell
- Description: Main app uses kebab-case (`entry-card.tsx`); chrome-extension uses PascalCase (`EntryCard.tsx`). Already scheduled for P6 cleanup per the refactor plan.
- Proposed resolution: defer-to-P6.
- Status: obsolete (verified 2026-07-17 audit — the entire `packages/chrome-extension` package was deleted; `packages/` now holds only `dopl-client` and `mcp-server`)

### F-008: Landing `page.tsx` still imports `@/hooks/use-speech-recognition` but hooks/ is not scoped to shared yet
- Location: `src/app/page.tsx`, `src/hooks/use-speech-recognition.ts`
- Found during: P0 pre-flight (audit review)
- Severity: smell
- Description: The single file in `src/hooks/` is `use-speech-recognition.ts`, imported by the landing page. Plan already schedules this move to `src/shared/hooks/` in P6.
- Proposed resolution: defer-to-P6.
- Status: fixed-in-p6 (moved to `src/shared/hooks/use-speech-recognition.ts`; `src/hooks/` removed)

---

## Findings added during refactor (P1 onwards)

### F-009: Dead `DRAG_BLOCK_SELECTOR` constant + stale doc comment in canvas-panel.tsx
- Location: `src/components/canvas/canvas-panel.tsx` (pre-P2.4)
- Found during: P2.4 canvas-panel split
- Severity: smell
- Description: A 30-line `DRAG_BLOCK_SELECTOR` constant was declared in `canvas-panel.tsx` but never referenced — the actual drag-block logic used inline `closest(...)` calls with hardcoded selector strings. The file's header comment further described a "cursor-style-based" drag-block approach that was never actually implemented (the implementation is purely selector-based). Both were artifacts of an earlier design pass that got superseded without cleanup.
- Proposed resolution: fix-now (in-scope with the drag extraction — the constant isn't carried into the new hook, and the stale comment is corrected in the same commit).
- Status: fixed-in-7c6449a

### F-010: Stale doc comment in useCanvasPanelDrag
- Location: `src/components/canvas/use-canvas-panel-drag.ts:27-40` (as written in commit 7c6449a)
- Found during: P2 post-phase audit
- Severity: smell
- Description: The hook's JSDoc claimed it returned `{isDragging, didDragRef}` and that the caller would use `didDragRef` for click-vs-drag detection. The actual return is `{isDragging, handleRootPointerDown, handleRootPointerMove, handleRootPointerUp}` — click-vs-drag is handled *inside* the hook's pointer-up handler. The doc was a leftover from an earlier extraction draft where the decision lived in the component.
- Proposed resolution: fix-now (corrected in the P2 audit commit).
- Status: fixed-in-audit-commit

### F-011: `withErrorHandler` may double-log when composed with `withUserAuth`
- Location: `src/shared/api/error-handler.ts` (new in P1)
- Found during: P2 post-phase audit
- Severity: smell
- Description: `withErrorHandler` catches unhandled exceptions and logs a `system_events` row with `fingerprintKeys: ["unhandled_route_error", source, name]`, then returns a 500 response. `withUserAuth` in `src/lib/auth/with-auth.ts` wraps its handler in `runAndLog5xx`, which also logs `system_events` with `["5xx", endpoint, "500"]` when the handler returns status ≥ 500. When composed as `withUserAuth(withErrorHandler(...))`, a single unhandled exception produces **two** `system_events` rows (different fingerprints, same incident). Not a crash — fingerprints differ so grouping isn't broken — but it doubles volume and can mislead incident counts.
- Evidence: `error-handler.ts:39-46` logs, then returns 500 → `with-auth.ts:runAndLog5xx` sees 5xx → logs again.
- Proposed resolution: defer-to-P4 — decide the composition design when we actually wire `withErrorHandler` into the first route (api/chat/route.ts). Candidate fixes: (a) have withErrorHandler skip its log when a caller signals it's composed under withUserAuth, (b) drop the unhandled-error log from withErrorHandler and rely on runAndLog5xx, (c) keep both intentionally — two perspectives on one incident, with the docs explaining the duplication.
- Status: obsolete (verified 2026-07-17 audit — `error-handler.ts` / `withErrorHandler` was never wired into a route and no longer exists as an implementation; the only surviving reference is a doc-comment mention in `src/shared/lib/http-error.ts`, so the double-log composition cannot occur)

### F-015: Dead migration functions in canvas-store.tsx
- Location: `src/components/canvas/canvas-store.tsx` (pre-P5a)
- Found during: P5a canvas-store split
- Severity: smell
- Description: `migratePreZoomCamera`, `migrateMissingSelection`, `migrateAddClusters` — three backward-compat functions for localStorage-persisted canvas state — were declared but never referenced. The `CanvasProvider`'s `useReducer` initializer returns `initialState` unchanged without running any migrations. All three are dead code (from an earlier client-only persistence path).
- Proposed resolution: fix-now — dropped during the split rather than relocating dead code into a new sub-module.
- Status: fixed-in-p5a

### F-014: Dead `InsufficientCreditsCard` in chat-panel.tsx
- Location: `src/components/canvas/panels/chat/chat-panel.tsx:837` (pre-P3c)
- Found during: P3c chat-panel split
- Severity: smell
- Description: `InsufficientCreditsCard` was defined at the bottom of chat-panel.tsx but never referenced (not called, not exported). Dead code from a since-removed credits-gating path.
- Proposed resolution: fix-now — dropped during the split rather than carrying into a new sub-module.
- Status: fixed-in-p3c

### F-013: Dead imports / constants in pipeline.ts
- Location: `src/lib/ingestion/pipeline.ts` (pre-P3a)
- Found during: P3a.1 survey
- Severity: smell
- Description: `pipeline.ts` imported `chunkAndEmbed` from `./embedder` and declared `const PIPELINE_TIMEOUT_MS = 10 * 60 * 1000` — both unreferenced anywhere in the file. Legacy from the removed `runPipeline` orchestrator.
- Proposed resolution: fix-now (removed during the strategy extraction, same commit).
- Status: fixed-in-5ef0198

### F-017: PublicId rollout skipped for clusters
- Location: `src/features/clusters/`, `src/features/community/server/published-slug.ts`
- Found during: PR #4 scope review (publicId rollout)
- Severity: smell
- Description: PRs #1–#3 added `public_id` to workspaces, knowledge bases, and skills as the URL routing handle. Clusters were originally on the same list, but the plan was based on a wrong assumption that clusters had a user-facing standalone page route. They don't — clusters are canvas panels accessed via `/[workspaceSlug]/canvas`, and the only public surface is `/community/[slug]` which already uses a hybrid slug-with-random-suffix scheme via `generatePublishedSlug`. Internal `clusters` slugs are MCP-addressed and workspace-scoped-unique, which is already adequate.
- Proposed resolution: defer — revisit only if a future product surface needs cluster URLs to be enumeration-resistant or rename-stable in a way the current scheme doesn't already provide. If we reach for it, the workspaces / KB / skills recipe applies.
- Status: open (verified still-real 2026-07-17 audit — clusters still have no user-facing standalone page route; deliberate defer holds)

### F-016: Legacy slug-only workspace URL fallback awaiting deletion
- Location: `src/features/workspaces/server/segment.ts` (`resolveWorkspaceSegmentForUser` legacy branch)
- Found during: workspace publicId rollout (PR #1)
- Severity: smell
- Description: After workspaces moved to `{slug}-{publicId}` URLs, the resolver still falls back to slug-only lookup so pre-migration bookmarks (`/dopl-team-workspace/members`) keep working. Each fallback hit logs a `legacy_slug_redirect` system event.
- Proposed resolution: defer — delete the legacy branch (and `findWorkspaceBySlug` / `findMemberWorkspaceBySlug` if still only used here) once the `legacy_slug_redirect` event drops to zero hits over 14 consecutive days.
- Status: open (verified still-real 2026-07-17 audit — `resolveWorkspaceSegmentForUser` legacy branch + `legacy_slug_redirect` event still present in `workspaces/server/segment.ts`; `findWorkspaceBySlug`/`findMemberWorkspaceBySlug` still in repository.ts)

### F-018: `is_workspace_member` 'editor' → 'member' fix bundled into M-10 migration
- Location: `supabase/migrations/20260504030000_visibility_private_resources.sql` (the function rewrite at the top), originally introduced by `20260502130000_editor_to_member.sql` which forgot to update the function
- Found during: M-10 audit
- Severity: bug (latent — silently denied member-role users from ALL session-based RLS-enforced reads/writes)
- Description: The editor → member rename migration updated the role values in `workspace_members` but did NOT update the `is_workspace_member` SECURITY DEFINER function, which still hard-coded `'editor'` in its rank table. Any user with `role='member'` was being treated as `-1` by the function and denied by every RLS policy that passed `'editor'` as the min role. Symptom: member-role users saw empty KB / skill / cluster lists via the web UI (admin paths via `supabaseAdmin` bypassed RLS so the bug was hidden in most flows).
- Resolution: migration `20260504030000` patches the function to recognize both `'member'` and `'editor'` (legacy alias) as rank-1. Bundled into the M-10 migration because both touch the same RLS surface, but the function fix is independently applicable. Behavior change: member-role users in shared workspaces will newly see resources they couldn't before — but those were resources they were always intended to see; the function bug was masking correct intent.
- Proposed resolution: ✅ fixed-in-20260504030000. Track here so the bundling is visible — future migrations should keep `is_workspace_member` in sync if the role enum changes again.
- Status: fixed-in-20260504030000

### F-012: Grandfathered 500-line violators touched during P2 relocations
- Location: `src/features/ingestion/server/skeleton.ts` (850 lines after relocation; was 847), `src/features/clusters/server/service.ts` (517 after; was 516), `src/lib/ingestion/pipeline.ts` (1212, untouched but over), `src/app/page.tsx` (823 after P2.5 extractions; was 1114)
- Found during: P2 post-phase audit, after user set a 500-line hard cap
- Severity: smell
- Description: The new ENGINEERING.md §2 rule is **500 lines hard cap, no edit may add lines to a file already over 500**. P2 relocations added 1–3 lines to `skeleton.ts` and `clusters/service.ts` via `import "server-only"` + a boundary-note comment, technically violating the new rule. `page.tsx` dropped from 1114 → 823 in P2.5 but is still over. `pipeline.ts` is untouched and will be split in P3a.
- Proposed resolution: defer — these files are already in the refactor queue for their respective phases (skeleton.ts → P3a, clusters/service.ts → P6 cleanup, pipeline.ts → P3a, page.tsx → P6). Grandfathered with explicit deadlines in ENGINEERING.md §2. Any *further* edits to these files that don't shrink them below 500 must include a split in the same PR.
- Status: resolved (verified 2026-07-17 audit — all four tracked files are now handled: `skeleton.ts` and `pipeline.ts` deleted with the ingestion pipeline, `src/app/page.tsx` down to 13 lines, `clusters/server/service.ts` down to 244. NOTE: a fresh crop of over-cap files exists (`skills/components/skill-view.tsx` 687 — GREW from 621 during the F-038 concurrency pass, a §2 "no growth over 500" violation; `workspaces/server/invitations.ts` 517; `teams/server/repository.ts` 508) — tracked under F-030's remaining-over-cap list, not here)

### F-019: Canvas-native drawing primitives don't theme (light mode)
- Location: `src/features/canvas/canvas-minimap.tsx`, `src/features/canvas/canvas.tsx` (marquee overlay ~L728), `src/features/canvas/clusters/cluster-outline.tsx` (SVG stroke/fill)
- Found during: Light-mode tokenize sweep (Phase A)
- Severity: smell
- Description: These draw with hardcoded `rgba(255,255,255,…)` in JS-computed inline styles / SVG attributes (minimap panel dots + viewport rect, marquee selection box, dashed cluster outline). They aren't CSS-class utilities, so the token sweep left them. In dark mode they're correct (unchanged); in `html.light` they render white-on-light → faint/invisible. The canvas's own grid in `canvas-parts/index.tsx` uses `rgba(0,0,0,…)` (black-on-light = visible, acceptable).
- Evidence: `grep -rn "rgba(255" src/features/canvas` → minimap, canvas marquee, cluster-outline.
- Proposed resolution: defer — a dedicated canvas-chrome pass. Either read these colors from CSS vars via `getComputedStyle`/a theme-aware constant, or branch on the active theme. Low risk (canvas chrome only), localized.
- Status: obsolete (verified 2026-07-17 audit — `canvas-minimap.tsx`, the canvas marquee, and `cluster-outline.tsx` were all deleted with the canvas feature, F-036; the replacement ontology/workflow graph uses the shared `.graph-substrate` class + token colors and has zero `rgba(255,…)` white-on-light primitives)

### F-020: Legacy `workspace_resource_access` table is inert — drop pending
- Location: `supabase/migrations/20260503060326_member_resource_access.sql` (table), no remaining code consumers
- Found during: Teams feature build (2026-06-11)
- Severity: smell
- Description: Per-member resource overrides were replaced wholesale by team-based grants (`teams` / `team_members` / `team_resource_access` + `access_mode` columns). All code paths that read or wrote `workspace_resource_access` were removed (`members/server/access.ts`, the member access route, the access matrix UI, `removeMember`'s manual cleanup). The table and its triggers (`cleanup_resource_access_on_*`) remain in the DB but nothing consults them. One pre-existing override row existed at cutover and silently reverted to the role default.
- Proposed resolution: defer — once the teams model is stable in prod, ship a `DROP TABLE workspace_resource_access` migration (and its orphaned `cleanup_resource_access_on_*` trigger functions, which also trip the SECURITY DEFINER advisor).
- Status: resolved 2026-07-17 — drop migration authored (`supabase/migrations/20260717120000_drop_workspace_resource_access.sql`, NOT yet applied). Note the table was actually created by `20260502140000_member_resource_access.sql` (+ policies/triggers in the 20260503232327 / 20260504050000 / 20260505020000 follow-ups); the canvas cleanup trigger already died with the `canvases` drop, its function is dropped here. Regen `src/shared/supabase/types.ts` after applying (rides the F-036 regen).

### F-022: Legacy shadcn primitives (`ui/button.tsx`, `ui/dialog.tsx`) are off-token — retire, don't polish
- Location: `src/shared/ui/button.tsx`, `src/shared/ui/dialog.tsx` (shadcn tokens `bg-popover`/`bg-muted`, raw `text-sm`/`text-xs`)
- Found during: shared-kit cleanup pass (2026-07-10)
- Severity: smell
- Description: The base-ui `Dialog` + cva `Button` predate the design system and violate it. They are one of THREE parallel modal systems (`Dialog`, settings-modal `ModalShell`, `ConfirmDialog`). Consumers: workspaces dialogs, knowledge move-to-dialog, members create-team/invite, skills trash-modal, billing paywall. Re-skinning them was deliberately skipped — the end state is consolidating onto `ModalShell`/`ConfirmDialog` during the per-feature cleanup passes, then deleting both files.
- Proposed resolution: defer — retire during feature passes; do not add new consumers. NOTE: the `shadcn` npm dependency looks unused to a JS-import grep but `globals.css:3` imports `shadcn/tailwind.css` (the token theme these primitives style against) — removing the dep breaks the build until this finding is resolved; drop the dep and the `@import` together when Button/Dialog retire.
- Status: resolved 2026-07-17 — both primitives deleted (`shared/ui/button.tsx`, `shared/ui/dialog.tsx`) after migrating all 6 consumers onto the house shells: workspace-danger-zone → `ConfirmDialog`; create-workspace + move-to + skills-trash → `ModalShell` size="narrow" (kit-class buttons `modalStyles.btnCancel`/`btnConfirm`); create-team + invite → `ModalShell` narrow, keeping their centered Notion-style token layouts and dropping the now-redundant `appShell.lightScope` (the `:root` palette is already light-valued). `shadcn` + `class-variance-authority` (button.tsx was cva's only user) removed from package.json and `@import "shadcn/tailwind.css"` removed from globals.css:3 — the compat theme tokens (`--color-popover`/`-muted`/`-primary`/…) are self-defined in the globals `@theme` block, so removal is safe. Follow-ups flagged: `npm install` to regenerate package-lock.json (not run), and orphaned shadcn CLI config `components.json` left in place.

### F-023: Effective-access rules encoded twice (pure display fn vs server enforcement)
- Location: `src/features/teams/effective-access.ts` (`computeEffectiveAccess`, server-invoked display) and `src/features/teams/server/access.ts` (`effectiveResourceAccess`/`listEffectiveAccess`, enforcement)
- Found during: RBAC consolidation (2026-07-10)
- Severity: conflict (latent drift risk)
- Description: Same rule ladder (admin→edit; workspace-mode→role ceiling; creator→ceiling; else max team grant capped) in two shapes. A forced merge was evaluated and rejected: the server fns early-return specifically to skip team-grant queries (admin/workspace-mode paths), so a shared core would either change query patterns or shrink to a trivial helper. Both file headers now cross-reference each other; a rule change must touch both.
- Proposed resolution: defer — revisit if the rules ever change (that's when drift becomes real). Never import `effective-access.ts` from client code.
- Status: open (documented; verified still-real 2026-07-17 audit — both `teams/effective-access.ts::computeEffectiveAccess` and `teams/server/access.ts::effectiveResourceAccess`/`listEffectiveAccess` still encode the ladder separately)

### F-024: Post-extraction aliases pending deletion in feature passes
- Location: `src/features/chats/components/share-control.tsx` (`SCOPE_ICONS` alias), `src/features/skills/components/skill-share-control.tsx` (`SKILL_SCOPE_ICONS` alias), `src/features/members/components/member-row.tsx` (unused `canManage` in Props at extraction time — since removed)
- Found during: shared-kit cleanup pass (2026-07-10)
- Severity: smell
- Description: The ScopeSharePopover extraction left thin per-feature icon-map aliases so `list-pane.tsx` / `skills-browser.tsx` imports kept working. Deletion trigger: the chats and skills feature cleanup passes point those imports at `SHARE_SCOPE_ICONS` in `shared/ui/scope-share-popover.tsx` and drop the aliases.
- Proposed resolution: defer-to-feature-passes.
- Status: fixed (verified 2026-07-17 audit — no `SCOPE_ICONS`/`SKILL_SCOPE_ICONS` aliases remain in `share-control.tsx`/`skill-share-control.tsx`; `list-pane.tsx` + `skills-browser.tsx` now import `SHARE_SCOPE_ICONS` directly from `shared/ui/scope-share-popover`; `canManage` removed from `member-row.tsx`)

### F-025: Likely-dead API routes
- Location: `src/app/api/billing/checkout/status/route.ts`, `src/app/api/knowledge/trash/purge/route.ts`, `src/app/api/skills/trash/purge/route.ts` (all three DELETED 2026-07-10 with their handler-only service exports); `src/app/api/workspaces/[workspaceSlug]/canvases/` (2 routes, KEPT)
- Found during: dead-code audit (2026-07-10)
- Severity: smell
- Description: Zero callers found across src/, packages/dopl-client, packages/mcp-server, dopl-desktop-app. checkout/status: the Stripe return flow strips `session_id` without calling it (webhook + `/api/billing/status` polling confirm payment instead). trash/purge ×2: the daily cron calls the repository fns directly, bypassing these admin routes. The two canvases routes remain because they ride the owner's pending canvas keep/remove decision — they die with the feature if it's cut.
- Proposed resolution: first three deleted (owner delegated the call); canvases routes ride the canvas decision.
- Status: resolved 2026-07-17 — the canvases routes went down with the canvas feature deletion (F-036); `src/app/api/workspaces/[workspaceSlug]/canvases/` no longer exists.

### F-026: Ontology loads the whole workspace graph per visit — deliberate, revisit at scale
- Location: `GET /api/ontology` (`ontology/server/service.ts::getSnapshot`), `use-ontology.ts`
- Found during: ontology cleanup pass (2026-07-10)
- Severity: smell (scale)
- Description: The snapshot pulls every cluster/object/membership/relationship. Per-cluster lazy loading was evaluated and deferred: the whole-graph client model is load-bearing — cluster tabs switch instantly client-side (history.replaceState, no remount), relationship/ref editors address objects across clusters, and the optimistic reducer assumes a complete graph. Splitting it means "objects may be missing" handling through the reducer + editors — break risk on a live feature for no perceptible gain at current graph sizes. Mitigations shipped instead: snapshot served through the query cache (instant repaint on revisit, background refresh with a dirty-guard so refetches never clobber optimistic edits) and the resources provider cached.
- Proposed resolution: defer — revisit when a workspace graph is large enough that the snapshot payload is felt (likely shape then: light cluster index + per-cluster object pages + id→name directory for cross-cluster refs).
- Status: open (verified still-real 2026-07-17 audit — `ontology/server/service.ts::getSnapshot` still pulls the whole graph; deliberate scale defer holds)

### F-027: Chat transcripts + chat list are unbounded — deferred until transcripts have real size
- Location: `GET /api/chats/[chatId]` (`chats/server/service.ts::getChat` → `repo.listMessages`, no limit), `GET /api/chats` (`listVisibleChats`, no limit)
- Found during: chats cleanup pass (2026-07-10)
- Severity: smell (scale)
- Description: Opening a chat ships the entire transcript including `verbatim`. Measured live at decision time: 3 chats, 14 messages total, largest transcript < 1 KB — pagination now would be speculative. It also isn't free: the detail pane's copy-as-markdown builds from the full message array, and the MCP `dopl_chats` get op expects a complete transcript, so windowing needs a UI load-more + a full-fetch copy path + an explicit MCP contract decision. The repository `select("*")` sites were reviewed and left: the chats tables are consumed column-for-column by their DTO mappers (table ≈ DTO), so explicit lists would add typo fragility without shedding payload.
- Proposed resolution: defer — trigger is transcripts reaching real size (large MCP session exports). Shape then: `GET /api/chats/[chatId]/messages?cursor=&limit=` (cursor = position) via `parsePageParams`/`Paginated<T>`, detail endpoint returns the first page + messageCount, UI loads more on scroll, copy/MCP fetch full explicitly.
- Status: open (verified still-real 2026-07-17 audit — `chats/server/repository.ts::listMessages` + `listVisibleChats` still issue no `.limit`/`.range`; deliberate scale defer holds)

### F-021: Canvas panels don't team-filter workflow headers/nodes
- Location: `src/features/canvas/server/load-server-state.ts` (panel load), canvas realtime
- Found during: Teams feature build (2026-06-11)
- Severity: smell
- Description: Teams-mode workflows are enforced at every workflow API read/write (list, get, graph/node/edge/attachment ops) and in KB reads, but the shared canvas still renders the workflow header/node panels themselves to all members — canvas_panels load is workspace-scoped, not team-scoped. A non-granted member sees the panel shell but every interaction (open, edit, node ops) 404s/403s.
- Proposed resolution: defer — decide whether teams-mode workflows should disappear from the canvas for non-granted members (needs per-user canvas state filtering + realtime predicate) or render a locked placeholder.
- Status: obsolete (verified 2026-07-17 audit — `canvas/server/load-server-state.ts` and canvas_panels rendering were deleted with the canvas feature, F-036; workflows are now their own `/workflows` surface enforced at the API level, so there is no shared-canvas panel shell leaking teams-mode workflows to non-granted members)

### F-028: Web ontology UI can't name or pick entry-level knowledge refs
- Location: `src/features/ontology/hooks/use-workspace-resources.tsx` (`nameOf`), `components/attributes-editor.tsx` (knowledge PickMenu), `kanban-card.tsx` / `object-hover-card.tsx` previews
- Found during: MCP entry-ref support (2026-07-11)
- Severity: smell
- Description: `dopl_ontology` set_attribute kind="knowledge" now accepts KB ENTRY refs (`<base>/<entry path>` or entry uuid) and the MCP renderer resolves them to read_file handles. The web UI still resolves knowledge attribute ids only against `/api/knowledge/bases`, so an entry id renders as "Unavailable" in the attributes editor and is silently dropped from card/hover previews. The picker also can't add entry refs.
- Proposed resolution: extend the resources provider with lazy entry-name resolution (light `GET /api/knowledge/entries?ids=` or per-base tree fetch on demand) and add a base→entry drill-in to the knowledge PickMenu.
- Status: resolved (2026-07-11) — added `GET /api/knowledge/entries?ids=` (returns `{ entries: [{ id, title, baseId, baseName }] }`, capped at 100 ids, same base-visibility gating as `listBases`); the ontology resources provider batch-resolves unresolved knowledge-attr ids through it (one `keepPreviousData` query keyed on the id-set) so `nameOf` renders entries as "BaseName / EntryTitle" in attribute rows, kanban previews, and hover cards; and a new `KnowledgePickMenu` drills base→entry (entries fetched on expand via `GET /api/knowledge/bases/[baseId]/entries`), storing the entry id while base-select still works.

### F-029: `skill_files` table is single-row per skill — collapse into `skills.body` later
- Location: `skill_files` table, `src/features/skills/server/repository.ts` (file I/O), `src/features/skills/server/service.ts` (`readBody`/`writeBody`), `packages/mcp-server/src/tools/skills.ts`
- Found during: single-file skills + folders change (2026-07-11)
- Severity: smell
- Description: Skills became single-file: every skill now has exactly one active `skill_files` row (its SKILL.md), enforced by the `skill_files_single_active` partial unique index (migration `20260716064655`). The multi-file surface (create/rename/delete/list-files ops, per-file-name API routes, the tab UI) is gone. The table was deliberately KEPT as the storage layer so version history (`skill_file_versions`), export, duplicate, and realtime kept working with minimal rework — but it now carries a single row per skill, plus a `file_id` FK on every version. The clean end-state is to fold the body into a `skills.body` column and drop `skill_files` (re-pointing `skill_file_versions` at the skill), which removes a join and a table from every skill read/write.
- Resolution (2026-07-15, migration `20260716064733_collapse_skill_files_into_skills`): STORAGE-ONLY collapse — no external API/MCP contract change.
  - **Schema:** `skills` gained `body`, `body_updated_at`, `body_edited_by`, `body_edited_source` (only the SKILL.md fields the app read off the file row; everything else the old `SkillFile` carried is derivable). `body_updated_at` is the CAS clock — DELIBERATELY separate from `skills.updated_at` so metadata edits don't false-412 a body write. `skill_file_versions` had its `file_id`/`file_name` (and the ON DELETE CASCADE → skill_files FK) dropped and was RENAMED to `skill_versions` — history preserved, keyed on `skill_id`. `skill_events.file_id` dropped (its `type` CHECK kept so historic `file.*` events stay readable; the app stopped emitting `file.*`). `skill_files` dropped.
  - **App:** repository reads/writes body on the skill row (`readSkillBody`/`updateSkillBody`; CAS on `body_updated_at`); `service-body` contract unchanged (still returns the `SkillFile` shape, synthesized by `dto.mapSkillBodyRow` — `updatedAt` = `body_updated_at`); history choke-point records `skill_versions` with no file linkage; `SkillFileVersion` type → `SkillVersion` (dropped `fileId`/`fileName`); realtime watches `skills` only; trash/DTO dropped the `files` field; cron dropped the `skill_files` purge arm; workflow attachments read `skills.body`. `packages/dopl-client` + `packages/mcp-server` needed NO changes (verified — contracts unchanged). `src/shared/supabase/types.ts` hand-edited to match; regenerate from the DB after the migration applies.
  - **Rollback shift:** `createSkill` is now a single atomic insert (body is a column), so the old two-phase insert + skill-row rollback is gone. Body-version rollback (`restoreFileVersion`) no longer emits a `file.rolled_back` event — the fresh version snapshot it mints is the record.
- Status: resolved

### F-030: Three worst over-cap files split into cohesive modules (§2 "Files end, not grow")
- Location: `src/features/knowledge/server/service.ts`, `src/features/canvas/panels/knowledge-base/knowledge-base-panel.tsx`, `src/features/skills/server/service.ts`
- Found during: 500-line-cap split pass (2026-07-13)
- Severity: smell (resolved)
- Description: The three largest over-cap files were split behavior-preserving (pure code motion + import updates; no logic/signature/API changes). Each original file became a re-export barrel keeping its full public surface, so every existing importer keeps working with zero import churn. Both invariant suites (`knowledge/server/service.test.ts`, `skills/server/service.test.ts`) stayed green unchanged.
  - **knowledge/server/service.ts** (1549 → 81 barrel) → `service-shared.ts` (188: context, `canSeeBase`/`assertBaseVisible`/`filterTeamVisibleBases`, `assertBaseWritable`, generic helpers), `service-bases.ts` (122: base reads incl. the `getBaseById` gate), `service-base-writes.ts` (371: create/update/delete/restore), `service-folders.ts` (203), `service-entries.ts` (224: incl. `resolveEntryRefs`), `service-paths.ts` (379: path-addressed ops), `service-trash.ts` (104), `service-seed.ts` (62).
  - **knowledge-base-panel.tsx** (957 → 394 panel shell + `TreePaneSkeleton`) → `knowledge-tree.tsx` (278: `buildTree` + `TreeNodes`/`FolderRow`/`EntryRow`/`IconButton`), `entry-editor.tsx` (298: `EntryEditor` + its CAS/conflict model). `KnowledgeBasePanelBody` export path unchanged.
  - **skills/server/service.ts** (941 → 60 barrel) → `service-shared.ts` (154: context, `canSeeSkill` matrix + grant helpers, `assertAgentWriteAllowed`), `service-reads.ts` (160: reads incl. the `getSkillBySlug` gate), `service-writes.ts` (365: create/update/delete/duplicate), `service-body.ts` (76: SKILL.md read + CAS write), `service-trash.ts` (74), `service-history.ts` (81), `service-insights.ts` (50), `service-seed.ts` (43). The history-recording choke-point (`./history` `recordVersion`/`recordEvent`) is imported by the domain modules, never duplicated.
  - Every resulting file is ≤ 379 lines. Dependency graphs are acyclic (domain modules → `service-shared` / the reads gate → repo; barrels re-export only the original public symbols, so shared internals stay internal).
- Verification: root `tsc --noEmit` clean; `vitest run` 7 files / 51 tests green; `eslint` on all 20 created/touched files → 0 errors, 0 warnings.
- Remaining over-cap files repo-wide after this pass (`wc -l`, excluding generated `src/shared/supabase/types.ts`, `*seed-fixtures*` data, tests, and `node_modules`/`dist`):
  - `src/features/knowledge/server/repository.ts` (892) — scheduled to mirror the service split (§2 / F-012-adjacent).
  - `src/features/workflows/server/authoring.ts` (828).
  - `src/features/canvas/canvas.tsx` (719) — scheduled (viewport/interaction hook extraction).
  - `src/features/canvas/panels/skill/skill-panel.tsx` (644).
  - `src/features/chats/server/service.ts` (622).
  - `src/features/skills/components/skill-view.tsx` (621).
  - `src/features/canvas/canvas-store/reducer.ts` (594) — §2 exception (cohesive state-machine reducer).
  - `src/features/canvas/use-canvas-db-sync.ts` (542).
  - `src/features/canvas/types.ts` (530) — type-only cohesive domain model (§2 exception candidate).
  - `src/features/teams/server/repository.ts` (508).
  - `packages/` (out of scope this pass): `dopl-client/src/client.ts` (599), `mcp-server/src/tools/knowledge.ts` (597), `mcp-server/src/server.ts` (593), `mcp-server/src/tools/ontology.ts` (586), `mcp-server/src/tools/workflow.ts` (513) — all already scheduled in ENGINEERING §2 / TRACKED-DEBT.
- Proposed resolution: fixed for the three target files; remaining list tracked for future cap passes (repositories next, to mirror their service splits).
- Status: fixed (three target files); remaining over-cap files defer
- Follow-up (2026-07-15) — three more over-cap files split behavior-preserving (pure code motion; byte-identical bodies except unexported helpers promoted to `export` where they cross a module; barrels re-export the exact original public surface via explicit named re-exports, so every importer keeps working unchanged and the `knowledge/server/service.test.ts` repository mock stays green). **knowledge/server/repository.ts** (892 → 80 barrel) → `repository-bases.ts` (255: base reads/writes + cascade trash/restore + `fetchProfileNames`), `repository-folders.ts` (203: folder reads + ancestor walk + writes + cascade), `repository-entries.ts` (296: entry reads incl. path-resolver helpers + batch id lookups + writes), `repository-trash.ts` (164: trash listing + hard-delete purge); no `-shared.ts` needed (the four sections have no cross-section calls). **workflows/server/authoring.ts** (828 → 38 barrel) → `authoring-header.ts` (114: header spawn/sync/`resolveHeaderPanelId` — the shared entry point), `authoring-refs.ts` (207: wire types + kb/skill/entry ref resolution + validation), `authoring-shared.ts` (264: ownership BFS, node/edge panel primitives, cycle detection, `reconcileAttachments`), `authoring-graph.ts` (130: declarative `setGraph`), `authoring-nodes.ts` (128: `addNode`/`updateNode`/`removeNode`), `authoring-edges.ts` (85: `connect`/`disconnect`). **chats/server/service.ts** (622 → 36 barrel) → `service-shared.ts` (215: `ChatContext` build, visibility gates, ownership guard, folder inheritance, format/profile helpers), `service-reads.ts` (64: list + detail reads), `service-writes.ts` (280: export + owner-only mutations), `service-folders.ts` (143: folder CRUD + scope propagation). Every resulting file ≤ 296 lines; import graphs acyclic (leaf helpers ← domain/op modules ← barrel; no module imports its own barrel). Also migrated `workspaces/components/accept-invite-card.tsx:115` `<a href="/login?…">` → `next/link` `<Link>`. Verification: root `tsc --noEmit` clean; root `vitest run` 7 files / 51 tests green; `eslint` on all 18 created/touched files → 0 errors / 0 warnings. (During the pass, root `tsc`/`vitest` went transiently red from a concurrent `skills/` storage-layer refactor sharing the working tree; every failure was confined to that other pass's files and cleared once it reached a consistent state.)

### F-031: `createCluster` partial failure leaves a half-created cluster in local state
- Location: `src/features/ontology/hooks/use-ontology.ts` (`createCluster`)
- Found during: Canvas 2 live wiring adversarial review (2026-07-16)
- Severity: smell
- Description: `createCluster` runs three sequential POSTs (cluster → seed column → seed card) inside one try/catch. If the cluster POST succeeds but a later POST throws, the cluster was already dispatched into local state (`CLUSTER_ADD`) yet the function returns `null`, so callers (ontology kanban header, graph view header) don't select it — an unseeded tab appears and the server holds a cluster missing its seed column/card. Same behavior on both `/ontology` and `/canvas2`; pre-existing, surfaced by the graph-view review.
- Proposed resolution: either make seed creation server-side (one POST creates cluster+column+card atomically in the service) or roll back locally on partial failure (dispatch `CLUSTER_DELETE` + `api.deleteCluster` for the orphan).
- Status: fixed (2026-07-17 — `createCluster` catch now rolls back a half-created cluster: `CLUSTER_DELETE` dispatch + fire-and-forget `api.deleteCluster`, guarded on POST#1 success by the pure `planClusterCreateRollback` helper (`ontology/create-cluster-rollback.ts`, unit-tested); error toast unchanged)

### F-032: Per-user trial vestiges left in analytics after the workspace-billing pivot
- Location: `src/features/analytics/server/launch-metrics.ts` (queries `profiles.subscription_status` / `trial_expires_at`); `profiles.subscription_*` columns now dormant
- Found during: workspace per-seat billing build (2026-07-16)
- Severity: smell
- Description: billing moved to `workspace_billing` and the 24h trial was retired (access.ts, PaywallGate/Modal, trial-reactivation cron all deleted; auth callback no longer stamps trials), but launch-metrics still reads the dormant per-user columns for historical dashboard tiles, and the webhook no longer emits `subscribed`/`churned`/`reactivated` conversion events those dashboards may expect.
- Proposed resolution: either retire the trial tiles or repoint them at `workspace_billing` + `mcp_tool_calls`; decide whether conversion events should be re-emitted from the new webhook handler.
- Status: fixed (2026-07-17 — subscription tile repointed to `workspace_billing` (count of `plan='pro'`, exposed as `pro_workspaces`); trial tiles/fields (`trials_active`/`trials_expired`/`conversion_trial_to_paid_pct`/`conversion_reactivation_pct`) removed from `launch-metrics.ts` and the admin analytics page markup; dormant `profiles.subscription_*` queries gone. Conversion-event re-emission decision left open — no longer blocks this tile)

### F-033: `hiddenCount` retention counter is a deliberate approximation
- Location: `src/features/chats/server/repository.ts` (`countHiddenChats`)
- Found during: chats retention window build (2026-07-16)
- Severity: smell
- Description: the hidden-chats count applies the `owner_id = user OR visibility = public` predicate but not the in-memory `canSeeChat` refinements (team-grant membership, API-key private-hiding), so team-scoped-but-ungranted or API-key-scoped callers can see a slightly inflated count in the "N older chats hidden" strip. Chosen to keep it one cheap head-count query.
- Proposed resolution: if it ever matters, push the grant predicate into the count query (join on team grants) rather than fetching rows.
- Status: open (verified still-real 2026-07-17 audit — `chats/server/repository.ts::countHiddenChats` L66-76 still applies only the `owner_id OR visibility=public` predicate, no `canSeeChat` refinement; deliberate approximation holds)

### F-034: `src/shared/supabase/types.ts` hand-edited pending regen
- Location: `src/shared/supabase/types.ts` (`chats_retention_cutoff` Functions stanza)
- Found during: chats retention window build (2026-07-16)
- Severity: smell
- Description: the generated-types file was hand-extended with the new DB function (and the migration also later gained `SET search_path = ''` per the Supabase security lint). A `supabase gen types typescript` regen against the live DB (migrations applied 2026-07-16) should reproduce/replace the hand edit.
- Proposed resolution: regen types on the next schema touch; confirm no drift.
- Status: resolved 2026-07-17 — regenerated from the live DB (all repo migrations applied through `graph_layout_columns`); diff vs the hand-edited file was exactly the new `layout: Json` columns (both graph tables) — every prior hand edit (incl. `chats_retention_cutoff`) reproduced by the generator. Also closes F-036 follow-up (1); the 11 dead canvas type entries were already gone. `tsc --noEmit` clean after swap.

### F-035: Free-plan chats retention window is app-layer only (owner RLS reads bypass it)
- Location: `supabase/migrations/20260707170000_chats.sql` (`chats_owner_select`); window enforced in `chats/server/{service-reads,retention}.ts`
- Found during: billing adversarial security review (2026-07-16)
- Severity: smell (accepted for v1)
- Description: the 90-day free window is enforced in the service layer (list/detail/MCP) and the append echo is stripped, but a chat OWNER can still read their own >90-day rows via direct PostgREST/realtime with their JWT. Deliberately accepted: the window is a monetization gate on the product surface, not a confidentiality boundary (the owner owns the data; export must stay possible per no-data-hostage). Cross-user leakage IS enforced in RLS (team-aware policies, 20260716150000).
- Proposed resolution: only revisit if the retention gate ever becomes contractual — would need a security-definer read path plus removing direct-table SELECT for owners.
- Status: open (accepted; verified still-real 2026-07-17 audit — `chats_owner_select` RLS policy unchanged, window enforced only in `chats/server/retention.ts`)

### F-036: Workflows rebuilt on first-class step tables; legacy canvas deleted (2026-07-16)
- Location: `features/workflows/**`, `src/shared/graph/`, migrations `20260716210000_workflow_steps.sql` + `20260716220000_drop_canvas_tables.sql`
- Found during: workflows pivot (step-graph rebuild + canvas teardown)
- Severity: n/a (record of a structural change + its follow-ups)
- Description: step graphs moved out of `canvas_panels`/`canvas_edges` into `workflow_steps`/`workflow_step_edges`; `features/canvas` (~9.4k lines, 57 files) deleted; graph drawing layer extracted to `src/shared/graph/`. Follow-ups: (1) regen `src/shared/supabase/types.ts` after the drop migration is applied (11 dead canvas type entries + hand-added stanzas); (2) `read-pick-menu`/`pick-menu`/`workflow-bits` were copied from ontology components into workflows per the §3 no-sideways-imports rule — promote to `src/shared/ui` when a third consumer appears; (3) workflow list endpoint lacks step counts (inactive workflow tabs show name only); (4) baseline lint warning count is now 1 (`proxy.ts`), was 11.
- Status: open (follow-ups only) — 2026-07-17 audit: (1) RESOLVED (types regenerated from live DB, see F-034); (3) RESOLVED (`workflows/server/service.ts::listWorkflows` L190-258 now computes a grouped `step_count` per workflow so every tab shows a count); (2) still open — the copied pick-menu pattern has only 2 consumer areas (ontology original + workflows copy), no third yet; (4) informational (lint baseline record).

### F-037: Low-priority residue from the 2026-07-17 verification sweep
- Location: various (see below)
- Found during: post-rebuild verification fleet (fix-wave re-review + integration sweep)
- Severity: smell
- Description: items verified real but deliberately deferred: (a) immediate connect vs disconnect of the same workflow edge isn't serialized client-side — final state depends on network ordering under rapid clicks (use-workflows.ts); (b) listWorkflows step counts fetch one row per step workspace-wide — fine at current scale, grouped-count RPC if step volumes grow (workflows/server/service.ts); (c) `join` and `onboarding` missing from RESERVED_WORKSPACE_SLUGS / NON_WORKSPACE_ROOTS — pre-existing, only bites legacy slug-only workspace URLs; (d) RESEND_API_KEY documented in .env.example but unused since the trial-reactivation cron was deleted.
- Status: (a) FIXED 2026-07-17; (b) open; (c) resolved 2026-07-17 (both slugs added to both lists); (d) resolved 2026-07-17 (.env.example line + comment removed; zero code references confirmed). 2026-07-17 audit re-verified (a) + (b) still-real: (a) `use-workflows.ts` `connectSteps`/`disconnectSteps` each `flushWorkflow` then fire their own API call — `disconnectSteps` only `scheduler.cancel`s a queued CONDITION edit, so an immediate connect POST vs a follow-on disconnect DELETE on the same edge still race on network ordering; (b) `listWorkflows` L180-194 fetches one `workflow_id` row per step workspace-wide and tallies client-side (the grouped-count RPC is the deferred fix). FIX (a): new per-edge FIFO serializer `src/shared/lib/keyed-serializer.ts` (unit-tested — op B's work begins only after op A settles even when both `run` calls are synchronous; distinct keys stay concurrent) wired into `use-workflows.ts`: immediate `connectSteps` and `disconnectSteps` for the same `edgeKey(workflowId,from,to)` now run through one keyed promise-chain, so a rapid connect→disconnect can't resolve by network ordering (the DELETE only issues after the in-flight POST settles). The debounced condition-edit upsert stays on the merge-scheduler and `disconnectSteps` still eagerly cancels a queued one, so it never re-enters the serializer — no `flushWorkflow` deadlock.

### F-038: Concurrent-edit protection false-positives and bypasses (KB docs + skills)
- Location: src/features/skills/components/skill-view.tsx, src/features/knowledge/components/doc-pane.tsx, src/features/skills/server/service-body.ts, src/features/knowledge/server/service-entries.ts, packages/dopl-client/src/{skills,knowledge}.ts, packages/mcp-server/src/tools/{skills,knowledge}.ts
- Found during: 2026-07-17 conflict-system audit (owner-reported: "says someone else is editing when I'm alone" + "still overwrites edits")
- Severity: bug
- Description: the timestamp-CAS design has no writer identity and no client-side save serialization, so the 412 "edited elsewhere" banner fires on the same human (own MCP agent writes, second tab, overlapping autosaves — flushSave has no in-flight guard so a debounced save B can PUT the pre-A baseline; KB description-blur shares the same token as body autosave). Meanwhile real overwrites slip through: MCP omit-version "auto-guard" re-reads the token at write time (clobbers anything written since the agent's read, with a success response); MCP force=true skips CAS entirely; the 412 handler re-buffers the LOSING save's body over any newer pending keystrokes, so "Save mine" can write older text; unmount flush drops the last ≤1.5s on 412 with only a console.warn; skill metadata writes send no precondition (last-write-wins). Latent: metadata CAS keys on `updated_at`, which the touch trigger bumps on every body save (false-412 the moment any caller sends the header). Presence (avatar dot) is cosmetic and correctly de-dupes multi-tab; it is not the source of the banner.
- Evidence: skill-view.tsx flushSave/scheduleSave (no in-flight guard; `pendingBodyRef.current = body` in the 412 branch stomps newer buffer), doc-pane.tsx handleDescriptionBlur vs scheduleSave sharing expectedUpdatedAtRef, dopl-client skills.ts:136-141 read-then-write auto-guard, service-body.ts:44 header-absent = CAS skipped, service.test.ts:202-212 enshrining the force path.
- Proposed resolution: option (a) — harden the CAS, keep the model.
- Status: mostly fixed 2026-07-17 (uncommitted). Shipped: single-flight save chains in both editors (skill-view + doc-pane — body/description/keep-mine/unmount all serialize through one queue); 412 handler no longer stomps newer buffered keystrokes; skills editor reseed decoupled from save success (`resetKey` no longer contains `updatedAt` — save responses can't clobber in-flight typing); EntryView now gates DocPane on the full entry fetch (the body-stripped tree entry could autosave `body: ""` over the document and seeded a stale token); unmount-flush 412 surfaces a toast instead of a silent console.warn; MCP omit-version writes on existing files now fail 412 with read-first instructions instead of the write-time auto-guard (dopl-client + tool copy). Still open (lower priority): timestamp-equality token design smell (monotonic counter would be sturdier) — D9 + D10 now FIXED 2026-07-17 (see note at end). D4 (presence unload cleanup) resolved 2026-07-17 — `use-presence.ts` untracks on `pagehide` (tab close + bfcache) so a dead tab's editing dot no longer waits for the heartbeat reap. 2026-07-17 audit re-verified D9/D10 still-real: the PATCH `/api/skills/[skillSlug]` route now READS an optional `x-updated-at` header into `expectedUpdatedAt` and `service-writes.ts::updateSkill` L186-220 enforces it — but the client (`skills/client/api.ts::updateSkill`) never sends the header (grep: zero `x-updated-at` in `src/features/skills`), so metadata writes remain last-write-wins in practice (D9); the CAS keys on `updatedAt`/`updated_at` which the body touch-trigger bumps, so enabling it would cross-clock false-412 against `body_updated_at` (D10). FIXED 2026-07-17 (D9 + D10, client-freshness fix per option (a) — kept the two-clock model): the web client now threads the metadata clock end-to-end. `writeBody`/PUT `/api/skills/[skillSlug]/body` re-reads and returns the row's post-write `updated_at` as a sibling `skillUpdatedAt` (the touch-trigger-bumped metadata clock, distinct from `body_updated_at`; MCP/dopl-client ignore the extra field, unchanged). `skill-view.tsx` keeps a `metaBaselineRef` refreshed from every response that carries the metadata clock — initial prop, metadata PATCH result, full skill pulls (`pullFreshSkill`), AND body saves (`skillUpdatedAt`) — and sends it as `x-updated-at` on every name/folder/sharing PATCH through one `commitMeta` choke-point. Threading the body save's fresh `updated_at` is exactly what avoids the D10 cross-path false-412 (a separate metadata-clock column was unnecessary); the body CAS stays on `body_updated_at`, which metadata writes never move, so continuous body typing is never interrupted by a metadata edit. On a metadata 412, `commitMeta` does a metadata-only refresh (`refreshMeta` — no editor reseed, safe mid-body-edit) + an "Edited elsewhere" toast (the discrete-field analogue of the body banner). Tests: `service.test.ts` covers `updateSkill` rejecting a stale precondition + forwarding it to the atomic CAS, and `writeBody` returning the fresh `skillUpdatedAt` on a real write vs. the unchanged clock on a no-op.

### F-038: New-workspace seeding + realtime/skeleton/KB-overview follow-ups (2026-07-17)
- Location: `features/workspaces/server/seed-workspace.ts` + per-feature `seed.ts`/`service-seed.ts`; `src/shared/realtime/refetch-coordinator.ts`; `src/shared/ui/skeleton.tsx`; knowledge-v2 detail
- Found during: seeding build + same-day UI passes
- Severity: n/a (record + follow-ups)
- Description: new workspaces now seed a cross-referenced "how to use Dopl" corpus (Dopl Guide KB ×5 entries, 4 Dopl skills, Dopl Playbook ontology cluster w/ ref attrs, Workspace-upkeep workflow w/ branch, 1 sample chat) via an idempotent best-effort orchestrator hooked at both workspace-creation paths (idempotency key: `dopl-guide` KB slug). Follow-ups: (1) `src/features/configuration/seed-content.ts` is authored but UNWIRED — wire when the configuration page is rebuilt; (2) KB base name/description agent edits don't push live (bases list is SSR-prop, not a query); (3) RESOLVED 2026-07-17 — KB base description reconciled to 2000 everywhere via `KB_BASE_DESCRIPTION_MAX` in src/config (server zod already accepted 2000, MCP copy already said 2000; the four web editors were the lagging layer — entry excerpt + folder descriptions stay at `DESCRIPTION_MAX` 300 by design); (4) knowledge-v2 Pin/Trash toolbar buttons remain visual-only; (5) dotted graph-substrate CSS literal duplicated across graph views + skeletons — extract a shared constant; (6) partial-seed retry can re-run non-idempotent later surfaces (best-effort contract, low risk).
- Status: open (follow-ups only) — 2026-07-17 audit: (5) RESOLVED (the substrate is now the single shared `.graph-substrate` CSS class in `globals.css:757-761`, consumed by graph-body, workflow-graph, and both skeletons — no duplicated literal); (3) confirmed resolved (`KB_BASE_DESCRIPTION_MAX=2000` threaded through schema + all 4 editors, `DESCRIPTION_MAX=300` for excerpt/folders). Still-real: (1) `configuration/seed-content.ts` has zero importers (still unwired); (2) RESOLVED 2026-07-17 — the KB bases list is now a live client query. `useKnowledgeBases` (knowledge/client/hooks.ts) gained an optional `initialData` seed (mirrors `useKnowledgeEntry`); `use-knowledge-v2-controller.ts` takes the SSR bases as `initialBases`, seeds the query with them (no skeleton flash), and refetches it in the EXISTING `useKnowledgeRealtime` subscriber (`knowledge_bases` was already a watched table), so agent/remote base name/description edits appear without a reload. The local user's own base edits also `refetchBases()` on save (knowledge-v2.tsx `onBaseSaved`) so they reflect immediately; `reconciledSelection` re-points the toolbar/overview off the fresh bases as before. Everything downstream reads `bases` unchanged; (4) fixed (2026-07-17 — `knowledge-v2/detail/detail-panel.tsx` toolbar: dead Pin button removed, Trash wired to the real `deleteBase` flow with a `ConfirmDialog` inline confirm and post-delete navigation to the knowledge root, mirroring `base-settings-form`); (6) unchanged.

### F-039: Missing x-workspace-id header class of bug + interactive-graph residue (2026-07-17)
- Location: various
- Found during: seeded-skill detail-load fix + interactive graph build
- Severity: smell / follow-ups
- Description: (a) the seeded-skill "Couldn't load" bug was a MISSING `x-workspace-id` HEADER on the skills detail-pane fetches — `withWorkspaceAuth` silently falls back to the user's DEFAULT workspace, so any unscoped client call misbehaves for multi-workspace users. Skills is fixed; AUDIT other features for header-less apiRequest/fetch calls (this is a recurring class). (b) Export links (skills + knowledge) are plain `<a download>` and cannot carry the header — need a query-param workspace scope. (c) `useGraphPositions` adopt-when-idle can briefly revert a just-dragged card if a refetch lands between flush-fire and write-return (self-heals via realtime echo); consider treating in-flight persists as non-idle. (d) ResizeObserver height-measurement block duplicated between ontology graph-view and workflow-graph — extract `use-measured-heights`. (e) `layout` jsonb accumulates entries for deleted nodes (harmless orphans; prune opportunistically on write). (f) fresh-connect condition popover stays open after a cycle rejection (connectSteps is fire-and-forget).
- Status: (a) CLOSED 2026-07-17 — full-surface audit (every client fetch/apiRequest across features + shared, mapped against withWorkspaceAuth vs path-scoped vs user-global routes) found ZERO additional header-less call sites: skills was the lone case (already fixed); ontology/workflows client wrappers make `workspaceId` a mandatory param, knowledge/chats/billing thread it end-to-end; `/pricing`'s default-workspace fallback is intentional (no workspace context pre-login). (b) CLOSED — knowledge exports fetch as header-carrying blobs, skills export uses `?workspaceId=` + `resolveExportWorkspace` (shared/auth/export-workspace.ts). (c)–(f) CLOSED 2026-07-17 (verified by audit against the graph fix-wave): (c) `shared/graph/use-graph-positions.ts` + `shared/lib/persist-gate.ts` — a refetch is adopted only while no local edit is pending AND `persistGate.busy()` is false, so a just-dragged card can't revert mid-PATCH; (d) `ResizeObserver` height measurement extracted to `shared/graph/use-measured-heights.ts`, consumed by both `workflow-graph.tsx` and ontology `graph-body.tsx`; (e) `shared/graph/positions.ts::pruneLayout` drops stored positions for nodes absent from the auto-layout and is called on both adopt and persist (`use-graph-positions.ts` L86, L102), so orphans no longer accumulate; (f) `connectSteps` now returns `Promise<boolean>` and `workflow-graph.tsx::onConnect` L147-153 opens the condition popover only when the connect resolves truthy — a cycle-rejected connect leaves no dangling popover.
