# Open questions (ontology port, branch `ui/port-ontology`, 2026-10-26)

Each: the question, what was chosen, where.

## Structure

1. **Where does the playground get the /home host?** The Next tree cannot import `apps/`, and the
   staging host copies (`home/ontology-panels.tsx`, `home/ontology-share.tsx`) differed from the
   desktop's only in data calls. Chose INVARIANTS §1's rule for a face two trees render: the host
   moved to `src/features/ontology/components/home-ontology-panels.tsx` + `ontology-share.tsx`, and
   the SPA keeps its derivation (`home-panes.tsx` passes `useHomeChannels()` in as
   `homeChannels`). `PageError` moved to `src/shared/ui/page-error.tsx` (the SPA's
   `page-states.tsx` re-exports it) and `EmptyLine` into `src/shared/ui/empty-state.tsx`.
2. **How does the playground feed product hooks fake data?** Chose the SPA bridge seam that every
   product read and write already goes through: `ontology-staging/store/staging-server.ts` is
   installed as `window.dopl` for the page's mount (restored on unmount), under a private
   `QueryClient`. No product file gained a staging seam. Side effect accepted: on that page
   `isSpaRenderer()` is true, so links open through the fake `openExternal` (`window.open`) and the
   upgrade modal takes its desktop branch.
3. **`EmptyLine` touched the knowledge worker's files.** `pages/home/knowledge-panels.tsx` now
   imports it from `@/shared/ui/empty-state` and `knowledge-panel-cards.tsx` lost its copy (one
   hunk each). `ui/knowledge-overhaul` may conflict there; resolution is to keep the shared import.

## Look (staging spec wins over older rulings)

4. **The attribute row's ":" glyph (2026-09-14 ruling)** is gone, as staging has it: label column,
   then value, kind and menu on `PANEL_GRID`. INVARIANTS updated.
5. **Both Descriptions are quiet** (no rule at rest, secondary ink), as staging has it; the 36px
   `form-dialog.module.css › .inputAction` face lost its last callers and was deleted.
6. **Rows display: the selected type header** used to wear `data-selected` (it was a
   `KanbanColumnHeader`); the group header (`ontology-rows-group-header.tsx`) is a line, not a
   card, and the kit has no selected face for a line, so none was invented. Opening the type's
   settings still works through its `⋯`. Its read-only Default fields fold was restored in review
   (`object-type-actions.tsx › TypeDefaultFields`, shared with the canvas lane header).
7. **"+ Object" on a pending ontology** is `CreateButton disabled` (staging) instead of
   `pendingRow`'s inert dim. Same effect (no click lands), different face while pending.
8. **The type actions' click-swallowing wrapper** (`object-type-actions.tsx`) wore
   `data-clickable` in staging, which shows a hand over a non-target. Dropped it; the
   `clickable-cursor.test.ts` allowlist entry moved from `kanban-column-header.tsx` to this file.
9. **Section titles (Samuel's add-on).** `SECTION_TITLE` is a shared constant
   (`src/shared/ui/section-title.ts`), not a kit class: both wearers are utility-class components
   and a kit class would need the two-copy mirror. The Overview half is the staging Overview
   (`overview-staging/.../overview-bits.tsx › ECard`); the product /home Overview has no "Needs you"
   card yet, so it wears it when that face is ported.

## Left alone

10. **RESOLVED (Samuel: "Let's delete that … Delete the code for it, for the handmade board.").**
    The marketing `/playground` ontology pane and its data file are deleted, the Ontology entry is
    gone from the playground shell's nav (it opens on Knowledge), and `.kanban-card` is deleted
    from both kit copies with the orphaned graph-node tombstone comments beside it.
11. **Scenarios the real host cannot reach** were dropped from the "States" panel: "Board load
    error" (a failed snapshot is the host's `PageError`, i.e. "Load error") and "Ontology no longer
    here" (needs an edited board plus an outside delete). "Board skeleton" mounts
    `OntologyBoardSkeleton` directly, as the page's own pre-mount state does.
12. **Pre-existing red, not this slice:** `src/features/ui-staging/staging-frame.test.tsx › opens
    every frame-level popup` cannot find the settings modal's "Devices" button (settings-staging).
