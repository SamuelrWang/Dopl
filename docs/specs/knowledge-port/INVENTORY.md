# Knowledge port: inventory (branch `ui/port-knowledge`, 2026-10-26)

Port of the UI-staging Knowledge page (`/playground/knowledge`, `src/features/knowledge-staging/`)
into the product. Method follows `docs/specs/channel-page-port/PLAN.md` §1: restyle the PRODUCT
components in place, mount them from the playground, delete the staging copies.

## 1. Layer map

| Layer | Files | Who renders it |
|---|---|---|
| Desktop /home Knowledge face (host) | `apps/desktop-ui/src/pages/home/{knowledge-panels,knowledge-base-view,knowledge-panel-cards}.tsx`, `home.module.css › .kbCards / .kbCell / .page[data-face="knowledge"] .pane`, `home-skeleton.tsx › HomeKnowledgePanelsSkeleton`, `components/skeletons/knowledge-skeletons.tsx` | desktop only; the playground keeps host copies (the Next tree cannot import `apps/`) |
| Opened base (shared) | `src/features/knowledge/components/knowledge-v2/**` (controller, trees, list rail, detail panel, header, info face, entry view, CSS module) | desktop /home, desktop workspace knowledge page, web channels-v2 pages, landing preview, playground |
| Document | `knowledge/components/doc-pane.tsx`, `doc-pane-chrome.tsx` | same |
| Settings popup | `knowledge/components/base-settings-{modal,general,folders}.tsx`, `kb-sharing-section.tsx`, `kb-scope-controls.tsx`, `kb-channel-grants-section.tsx`, `agent-write-toggle.tsx` | same; `kb-scope-controls` also in the create dialog |
| Tree menus / search | `tree-context-menu.tsx`, `knowledge-search.tsx`, `move-to-dialog.tsx`, `create-base-dialog.tsx` | same |
| Changelog (shared with the ontology) | `src/features/revisions/components/{changelog-list,revision-diff}.tsx` | knowledge base info face, ontology changelog, ontology object History |
| Data | `knowledge/client/{api,hooks,hooks-channel-grants,realtime}.ts`, `revisions/client/*` | unchanged |
| Shared kit used | `shared/ui/{breadcrumb,naked-icon-button,small-action-button,status-pill,identity-face,empty-state,select-menu,form-dialog}`, `shared/layout/settings-modal/{modal-shell,settings-modal.module.css,sections/settings-panel}` | unchanged (all already on master) |

## 2. Staging → product deltas (ported)

- Header: kit `Breadcrumb` (`aria-label` kept) at `text-title`; naked-glyph download / settings / delete; search dropdown on a white card with menu-hover rows.
- Tree: 30px rows; hover `--surface-raised-1`, selected `--surface-raised-2` + medium; muted icons; indent guide under open folders; child count that yields to row actions; Enter/Space on a focused row; New file / New folder as `TEXT_LINK_BUTTON` links; one create flow (`tree-row-bits.tsx › useTreeCreate`) for root and folders.
- Info face: one `.infoColumn`; name + description edited in place (`DOC_TITLE_INPUT`, `DescriptionField`); Details is a label/value grid in a white card (Visibility a `StatusPill`, storage last); Changelog under it.
- Changelog: one white card, day-grouped hairline rows, `IdentityFace` + `who · session · time` over the change, chevron disclosure, diff in a `.card-well`, Restore `SMALL_PILL_BUTTON`, empty `EmptyState variant="well"`. Added `framed` so a host that already is a card (ontology object History) drops the list's own.
- Document: the "Overview" strip is a white head card (title + write-rule labels + presence + save state; description under); conflict banner on the pill family; 42rem measure.
- Settings popup: the profile popup's chrome and vertical underline rail; panes General / Sharing (workspace access + channels) / Folders (only with folders) / Agents, all mounted while open; text entry `UnderlineField`, choices `SelectMenu variant="bare"`, rows `SettingsRows`.
- Desktop: the Knowledge face's record pane is white; the opened-base skeleton mounts `.infoColumn` and two white cards; the unread `--kv-panel` / `--kv-accent` rebinds dropped.

## 3. Reverse gaps (product behaviour the staging copies did not exercise) and how each is kept

Every handler, hook and gate stayed in the product file it lived in; the port changed markup and
classes only. Item by item:

| Capability | Where it lives | Kept by |
|---|---|---|
| Create / rename / move / delete (base, folder, entry) | controller + `tree-rows.tsx`, `tree-context-menu.tsx`, `move-to-dialog.tsx`, `delete-base.ts` | untouched handlers; the root and folder creates now share `useTreeCreate` (stub-marked folder, reveal-before-create) |
| Editor, autosave, drafts, 412 conflicts | `doc-pane.tsx` | only the head markup changed; `ConflictBanner` keeps both actions and their disabled state |
| Sections / outline warnings | `doc-pane-chrome.tsx › writeRuleLabels / WriteRuleWarnings` | rendered on the head card's title row |
| Pins (stars) | `knowledge-panel-cards.tsx › useStarToggle`, `base-card.tsx` | untouched |
| Scopes / sharing / team grants | `kb-sharing-section.tsx`, `kb-scope-controls.tsx` | same writes; team level is a bare menu, `lockedTeamIds` still disables |
| Channel grants + guest write | `kb-channel-grants-section.tsx` | same three levels and wire values (`none` sent explicitly, `guestWrite` drops with the level), same guest reveal, same `channelScopeAllowed` refusal |
| Agent-write rule | `agent-write-toggle.tsx` | same switch and warning |
| Versions / restore | `changelog-list.tsx` + `useRevisionHistory` | same `isRestorable` gate, confirmation naming date / field, paging |
| Search | `knowledge-search.tsx` | same debounce, keyboard and result handling; dropdown restyled |
| Presence / readers | `doc-pane.tsx › usePresence` + `AvatarStack` | kept (2xs on the head row) |
| Realtime | `use-knowledge-v2-controller.ts › useKnowledgeRealtime` | untouched |
| Permissions / viewer read-only | `use-knowledge-v2-trees.ts › canEdit`, `readOnly` on the in-place fields | name/description fields keep `readOnly={!canEdit}`; the count hides when read-only |
| Uploads / attachments | none in the knowledge feature today | n/a |
| Keyboard | tree Enter/Space added; Escape on stub rename kept | `tree-row-bits.tsx › pressOnKey` |
| Loading / error / empty | `DocBodySkeleton`, list/channel/team loading lines, `PageError` | restyled in place; channel grants error uses `SettingsRowsEmpty failed` |
| Slug change + URL move | `base-settings-general.tsx` | same save + `routing.goToBase(next, "replace")` |
| Folder descriptions | `base-settings-folders.tsx` | same save-on-blur and path sort |

## 4. Deleted

- `knowledge/components/base-settings-form.tsx` (split into `base-settings-general.tsx` + `base-settings-folders.tsx`), `settings-section.tsx`.
- `kb-channel-grants-section.tsx › GrantLevelControl` (segmented radio), the tree's `OpenScaleButton` create row and the local `AddRow` / `RowIconBtn` (moved to `tree-row-bits.tsx`).
- CSS: `.crumbs`, `.crumbBtn`, `.crumbSep`, `.crumbCurrent`, `.detailTopTitle`, `.field*`, `.meta*`, `.treeRowGroup`, `.treeActionDisabled`; the unread `--kv-panel` / `--kv-accent` rebinds.
- Staging: every component/data copy under `knowledge-staging/{knowledge,revisions,stubs}/` (59 files, 8,378 lines, measured 2026-10-26 with `git diff --cached --shortstat`). What stays is the desktop-host copies, the fake DB and the in-memory API.

## 5. Duplication

- One changelog for knowledge and ontology (`framed` instead of a second list).
- One description face (`DescriptionField`) for the document head, the base info face and folder descriptions; one title face (`DOC_TITLE_INPUT`).
- One tree create flow for the root and every folder.
- Remaining by necessity: the playground's desktop-host copies (`knowledge-staging/home/*`, `desktop/*`), the same way `channels-staging/home/channel-scene.tsx` hosts the channel components.
