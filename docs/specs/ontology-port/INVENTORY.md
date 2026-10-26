# Ontology port inventory (2026-10-26, branch `ui/port-ontology`)

Port of the UI-staging Ontology face (`/playground/ontology`, `src/features/ontology-staging/**`,
commits `4445dc42c` + `0e838e379`) into the product. Method: `docs/specs/channel-page-port/PLAN.md`
§1. Anchors are `path › symbol`.

## 1. Layer map

| Layer | Files | Mounted by |
|---|---|---|
| Desktop /home Ontology face (host) | `apps/desktop-ui/src/pages/home/ontology-panels.tsx › HomeOntologyPanels`, `› OntologyMenuRows`; `ontology-share.tsx › OntologyShareDialog`, `› DeleteOntologyConfirm` | `pages/home/home-panes.tsx › HomePane` (`ONTOLOGY_PANE`) |
| Desktop workspace route | `apps/desktop-ui/src/pages/ontology/index.tsx`, `detail.tsx` | `/:workspaceSegment/ontology` (mounts `OntologyView` framed, unpinned) |
| Product board (web tree, imported by both desktop surfaces) | `src/features/ontology/components/*` (view, header bits, switcher, board, card, lane header, row, hover card, skeleton, object panel + four editors, pickers, dialogs, changelog, history) | `OntologyView` |
| Product hooks / client | `src/features/ontology/hooks/*`, `client/api.ts`, `client/realtime.ts`, `graph-state.ts`, `optimistic-create.ts`, `field-kinds.ts` | the components |
| Revisions UI | `src/features/revisions/components/{changelog-list,revision-diff}.tsx`, `client/hooks.ts` | `ontology-changelog.tsx`, `object-history.tsx` (and the knowledge/skills changelogs) |
| Shared kit | `src/shared/ui/*` (`white-card`/`select-card`, `WHITE_PILL`, `CreateButton`, `SelectMenu` `pill`/`bare`, `BARE_TRIGGER_FACE`, `StatusPill`, `EmptyState`, `NAKED_ICON_BUTTON`, `PILL_BUTTON`, `InlineUnderlineField` `quiet`, `form-dialog.module.css › .inputSecondary`) | everything |
| Staging (spec) | `src/features/ontology-staging/**` (copies + stand-ins), `ui-staging/staging.css › .uis-onto-pane` | `src/app/ontology/page.tsx`, `/playground/ontology` alias |
| Marketing /playground mirror | `playground/components/panes/ontology-pane.tsx`, a hand clone of the OLD board (DELETED in this port by Samuel's ruling) | `/playground` (public) |

Blast radius of a product edit: the /home Ontology face, the workspace ontology route, and (after
step 3) the staging playground. The landing hero demo mounts no ontology component (`grep -rn
"features/ontology" src/features/marketing` is empty).

## 2. Staging → product deltas

Every staging copy diffed against its source (`diff -u <source> <staging copy>`).

| Staging file | Product target | Kind |
|---|---|---|
| `ontology-view.tsx` | same | restyle: header `px-4 py-3 gap-2`, description `mx-2`, `CreateButton` "+ Object" (drops `channels/components/bits.tsx › TAB_ACTION`), both empty states on `EmptyState` + `PAGE_ACTION_BTN` |
| `board-header-bits.tsx` | same | restyle: description `quiet` + `.inputSecondary`, rename field `font-medium`, gear on `WHITE_PILL`, display menu `variant="pill"` |
| `ontology-switcher.tsx` | same | restyle: trigger `BARE_TRIGGER_FACE` at `text-heading`, h-9 |
| `object-panel.tsx` | same | restructure: one `.white-card`, header = muted eyebrow + naked delete/close, name + description in the header, sections below |
| `panel-section.tsx` | same | restructure: muted caption title (+ optional `caption`), hairline rows (`PANEL_ROW`), `PANEL_GRID`, `ROW_ICON_BUTTON`; drops the grey well (`PANEL_WELL`) |
| `attributes-editor.tsx` | same | restructure: grid row, `bare` kind menu (`KIND_TRIGGER`), no ":" glyph; value cell split out |
| `attribute-value-editor.tsx` | NEW beside it | `AttrValueEditor`, `ChipStrip`, `PICK_TRIGGER` (split for the 500-line cap; chips `VALUE_CHIP`, pickers "+ Add") |
| `relationships-editor.tsx`, `template-editor.tsx`, `actions-editor.tsx` | same | restyle onto `PANEL_GRID` / `ChipStrip` / `.inputSecondary`; template caption moves to `PanelSection caption` |
| `field-value-editors.tsx`, `field-description.tsx` | same | restyle: `min-w-0` cells, `ROW_ICON_BUTTON`, description at `col-start-2` |
| `ontology-bits.tsx` | same | `VALUE_CHIP`, `CHIP_TEXT`, `CHIP_MARK`, `ADD_OBJECT_BUTTON`; `CHIP` re-export dropped |
| `field-list.tsx` | NEW | `FieldList` / `objectFieldRows`: rows record, canvas card (3 fields) and hover card |
| `object-type-actions.tsx` | NEW | `ObjectTypeActions`, `TYPE_ICON_BUTTON`: the type's `+` and `⋯` (settings, delete confirm), both type headers |
| `ontology-rows-group-header.tsx` | NEW | the Rows display's one-line group header |
| `kanban-board.tsx` | same | restructure: canvas lanes lose the grey fill; Rows drops the dots, groups by header line + hairline |
| `kanban-card.tsx` | same | restyle: `white-card select-card`, content height, 3 fields, link/chip clicks do not select |
| `kanban-column-header.tsx` | same | restyle: `white-card select-card`, actions via `ObjectTypeActions`, fold via `RowsCollapse` |
| `ontology-row.tsx` (+ `.test.tsx`) | same | restructure onto `FieldList`, actions as chips; old grey name badge test replaced |
| `rows-collapse.tsx` | same | `id` prop (for `aria-controls`) |
| `object-hover-card.tsx` | same | restyle: `white-card`, `StatusPill` container, `FieldList` (6) |
| `ontology-skeleton.tsx` | same | mirrors the new header (display pill) and borderless lanes |
| `knowledge-pick-menu.tsx`, `object-history.tsx`, `ontology-changelog.tsx`, `delete-ontology-dialog.tsx`, `field-menu.tsx`, `object-pick-menu.tsx`, `new-object-dialog.tsx`, `cap-notice.tsx`, `ontology-frame.tsx`, `pick-menu.tsx` | same | data rewires / comment trims only (no visual delta) |
| `hooks/use-board-display.ts`, `use-rows-collapsed.ts`, `use-last-opened.ts`, `use-object-draft.ts` | same | storage-key / import rewires only |
| `home/ontology-panels.tsx`, `home/ontology-share.tsx`, `home/home-panes.tsx` | desktop hosts | data rewires only (store calls for API calls) |
| `revisions/components/*` | `src/features/revisions/components/*` | import rewires only (verbatim) |
| `ui-staging/staging.css › .uis-onto-pane` | `apps/desktop-ui/src/pages/home/home.module.css › .page[data-face="ontology"] .pane` | white record pane (`--bg-overlay`) |

## 3. Reverse gaps (product behaviour the staging copies stubbed or dropped) and how each is kept

The port restyles the PRODUCT files in place, so every handler below stays where it was; the
staging stand-ins never enter the product.

| Product behaviour | Where it lives | Staging had | Kept by |
|---|---|---|---|
| Snapshot read through the query cache, debounced full-state PATCH, flush on unmount, `dirtyRef` guard | `hooks/use-ontology.ts` | in-memory store | unchanged hook |
| Realtime refetch (MCP / other-device edits) | `client/realtime.ts`, `use-ontology.ts › useOntologyRealtime` | none | unchanged hook |
| Optimistic creates + id resolve, delete rollback, over-cap → upgrade modal | `use-ontology-creates.ts`, `delete-rollback.ts`, `ontology-view.tsx › UpgradeModal` | fake transport | unchanged |
| Viewer read-only (`canEdit`) across header, board, panel, editors | every component | kept in copies | carried; group header renders text for viewers |
| Pending (provisional id) rows inert | `shared/ui/pending.ts › pendingRow` | kept | carried ("+ Object" uses `disabled` on the pending ontology) |
| Version history + restore (object History, ontology Changelog) | `object-history.tsx`, `ontology-changelog.tsx`, `revisions/client/hooks.ts` | fake revisions | unchanged hooks |
| Object-type CRUD (+ Object draft dialog, rename, describe, settings, delete confirm naming orphans) | `new-object-dialog.tsx`, `use-object-draft.ts`, `ObjectTypeActions`, `deleteObjectMessage` | kept | carried |
| Field CRUD (template + attributes), kind switch with `convertValue`, ⋯ menu (description / options / remove), drafts keyed by position | editors, `field-menu.tsx`, `panel-section.tsx › useDraftRows` | kept | carried |
| Relationships (upsert by label, "related to" default, open target) | `relationships-editor.tsx` | kept | carried through `ChipStrip onOpen` |
| Knowledge picker (lazy entries read), skill picker, object picker | `knowledge-pick-menu.tsx` (`useApiQuery`), `pick-menu.tsx`, `object-pick-menu.tsx` | fake entries | product `useApiQuery` unchanged |
| Workspace resources (bases, skills, entry names) | `use-workspace-resources.tsx` | fake | unchanged |
| Link values open through the bridge | `shared/ui/external-anchor.tsx` | kept | carried in `FieldList` and `LinkValueEditor` |
| Board display (Canvas/Rows) and Rows fold memory per device | `use-board-display.ts`, `use-rows-collapsed.ts` | renamed keys | product keys unchanged |
| Last-opened ontology / face / object memory | `use-last-opened.ts`, `last-opened.ts` | kept | unchanged |
| Loading / error / empty / "no longer here" / not onboarded | `ontology-view.tsx`, host | kept | carried (`EmptyState` faces) |
| Object cap notice + upgrade | `cap-notice.tsx`, billing hooks | fake entitlements | unchanged |
| Sharing into home channels, agents view/edit rungs, delete naming channels | desktop host + `use-ontology-shares.ts` | store calls | host keeps the real calls |
| Workspace route URL writes (slug), unpinned switcher, own Delete dialog | `ontology-view.tsx › replaceUrl`, `delete-ontology-dialog.tsx` | not cloned | unchanged |
| Keyboard: lane fold chevron (`aria-expanded`/`aria-controls`), rename Enter/Escape, draft commit on Enter | components | kept | carried; `RowsCollapse id` now carries `aria-controls`' target |
| Search / filter / sort, undo | none on this surface | n/a | n/a (no product feature to keep) |
| Rows: the selected TYPE header showed `data-selected` | `kanban-board.tsx` Rows branch (via `KanbanColumnHeader`) | dropped (one-line group header) | not kept; logged in OPEN-QUESTIONS |

## 4. Dead code after the port

- `.kanban-card` kit class (`globals.css`, `kit.css`): last users were the board, lane header,
  Rows record and the marketing `/playground` pane. Deleted with the pane.
- `panel-section.tsx`'s re-exports of `PANEL_WELL` / `PANEL_ROWS` from `shared/ui/panel-well.ts`
  (the Agents tab keeps the well itself).
- `ontology-bits.tsx › CHIP` re-export (`shared/ui/wells.ts › CHIP` stays if anything else reads it).
- `rows-collapse.tsx` callers' inline chevron button recipes; the lane header's hand-rolled grid
  fold (now `RowsCollapse`).
- `ROW_COLON` in `attributes-editor.tsx` and the INVARIANTS ":" ruling text.
- `ontology-view.tsx`'s import of `channels/components/bits.tsx › TAB_ACTION` (cross-feature).
- Staging: every copy in §2, the stand-in hooks, the store's hand-written writes, `home/*` copies,
  `revisions/*` copies, `billing/*` stand-ins, `.uis-onto-pane`, PORTING rows for them.
- Docs: INVARIANTS ontology bullets describing the grey well, `PANEL_ROW = .bento`, the ":" row,
  lane `--home-panel` fill, 216px card; DESIGN-SYSTEM `.kanban-card` row.

## 5. Duplication to collapse

| Duplicate | Resolution |
|---|---|
| `ontology-staging/ontology/components/*` vs `src/features/ontology/components/*` | product carries the look; staging copies deleted |
| `field-list.tsx`, `object-type-actions.tsx`, `attribute-value-editor.tsx` (staging only) | one copy each, in the product |
| `ontology-staging/home/{ontology-panels,ontology-share,home-panes}.tsx` vs the desktop hosts (data-only diffs) | the host moves DOWN to `src/features/ontology/components/{home-ontology-panels,ontology-share}.tsx` and both trees mount it (INVARIANTS §1 "A /home face that two trees render is declared in `src/`"); the SPA derivation (`useHomeChannels`) stays in the SPA and is passed in |
| `ontology-staging/home/page-states.tsx`, `knowledge-panel-cards.tsx › EmptyLine` copies | `PageError` moves to `src/shared/ui/page-error.tsx` (the SPA's `page-states.tsx` re-exports it), `EmptyLine` into `src/shared/ui/empty-state.tsx` |
| staging stand-in hooks (`use-ontology`, `use-ontologies`, `use-ontology-shares`, `use-workspace-resources`, revisions hooks, billing hooks, `use-home-channels`) | replaced by one fake server behind the SPA bridge's `apiRequest` seam (`shared/lib/spa-bridge.ts`), which every product hook already calls through |
| marketing `/playground` `ontology-pane.tsx` (hand clone of the old board) | deleted (Samuel's ruling, OPEN-QUESTIONS #10) |
