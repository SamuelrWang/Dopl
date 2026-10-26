# /knowledge staging → desktop porting map

`/knowledge` stages **desktop /home → Knowledge**: the face the shipping desktop shows (it boots to
`/home`, `apps/desktop-ui/src/pages/boot/index.tsx` → `HOME_PATH`), rendered inside the landing
demo's window (`src/features/ui-staging/staging-frame.tsx`).

The other surface, the workspace route `/:workspaceSegment/knowledge`
(`apps/desktop-ui/src/pages/knowledge/index.tsx`), is NOT staged as its own page. It mounts the
same shared core (`KnowledgeV2PreviewCore`) as the Home pane's opened base, so the two-pane base
view staged here covers it. Its card-grid "home" mode (the hero banner) is not reachable from /home.

## The opened base is REDESIGNED ahead of its sources

The opened base (header, file tree, info face, changelog, document head) and the base settings
popup wear the identity look (`docs/DESIGN-LANGUAGE.md`, kit and tokens only). Those files say
"redesigned ahead of its source" in their header line; every other file is a **verbatim copy**
apart from import paths and that header line. To port: diff the staging file against its source,
carry the markup/class changes over, and delete what the staging file no longer renders.

What the redesign is, per area:

- **Header** (`detail/base-header.tsx`): the kit `Breadcrumb` at `text-title` (it took an
  `ariaLabel` prop so the "Knowledge base breadcrumb" name survives), naked-glyph actions
  (`NAKED_ICON_BUTTON`), the search dropdown on a `.white-card` with menu-hover rows.
- **File tree** (`list/tree-rows.tsx`, new `list/tree-row-bits.tsx`): 30px rows, hover
  `--surface-raised-1`, selected `--surface-raised-2` + medium label (the agent rail's
  `ROW_SELECTED_FACE`), muted icons, a 1px `--border-subtle` indent guide under each open folder,
  a caption child count that gives way to the row actions, Enter/Space on a focused row, the
  root New file / New folder as muted text links on `small-action-button.ts › TEXT_LINK_BUTTON`. One create flow (`useTreeCreate`) serves the root and
  every folder.
- **Info face** (`detail/base-overview.tsx`, `detail/meta-card.tsx`): one `.infoColumn`; the
  name and description edited in place (`doc-pane-chrome.tsx › DOC_TITLE_INPUT` /
  `DescriptionField`, the kit's quiet `InlineUnderlineField`, which took a `multiline` face);
  Details is `settings-panel.tsx › SettingsPanel` over one `.white-card` label/value grid
  (Visibility as `StatusPill`, storage last).
- **Changelog** (`detail/overview-changelog.tsx`, `revisions/components/*`): one `.white-card`,
  day-grouped hairline rows, `IdentityFace` + name + time on one caption line over the change,
  a chevron disclosure, the diff in a `.card-well`, Restore on `SMALL_PILL_BUTTON`, empty state
  `EmptyState variant="well"`.
- **Document** (`doc-pane.tsx`, `doc-pane-chrome.tsx`, `knowledge-v2.module.css ›
  .editorScope`): the "Overview" strip became a `.white-card` head (title in place with the save
  state, presence and write-rule labels on its row; the description under it); a 42rem measure;
  prose on the app scale with token links, quotes and code.
- **Settings popup** (`base-settings-modal.tsx` and its panes): the profile popup's chrome
  (`ModalShell` wide, `settings-modal.module.css › .nav` / `.pane`, the vertical underline rail),
  four panes — General (`base-settings-general.tsx`), Sharing (`kb-sharing-section.tsx` +
  `kb-channel-grants-section.tsx`), Folders (`base-settings-folders.tsx`, drawn only when there
  are folders), Agents (`agent-write-toggle.tsx`). Panes stay mounted while the popup is open.
  Text entry is `UnderlineField`, choices are `SelectMenu variant="bare"`, rows are
  `SettingsRows`, verbs are `SMALL_PRIMARY_PILL` / `SMALL_PILL_BUTTON`.
- **Ground** (`knowledge-staging-page.tsx` passes `recordClassName="uis-white-pane"`,
  `ui-staging/staging.css › .uis-white-pane`, shared with the ontology face): the record pane is
  `--bg-overlay` white, not the frame's `--home-card`; cards keep their hairline and shadow. Port
  target: `apps/desktop-ui/src/pages/home/home.module.css` → `.page[data-face="knowledge"] .pane`.

`base-settings-form.tsx` and `settings-section.tsx` have NO staging copy any more: on port, the
source `base-settings-form.tsx` splits into `base-settings-general.tsx` and
`base-settings-folders.tsx`, and `settings-section.tsx` is deleted.

## Desktop-local files (`apps/desktop-ui/src/`)

| Staging file | Desktop source | Notes |
|---|---|---|
| `home/knowledge-panels.tsx` | `pages/home/knowledge-panels.tsx` | Only change: `Channel` → `StagingChannel` (`data.ts`). |
| `home/knowledge-panel-cards.tsx` | `pages/home/knowledge-panel-cards.tsx` | Verbatim. |
| `home/knowledge-base-view.tsx` | `pages/home/knowledge-base-view.tsx` | Verbatim. |
| `home/home.module.css` | `pages/home/home.module.css` | `.kbCards` drops the unread `--kv-panel` / `--kv-accent` rebinds. |
| `home/home-skeleton.tsx` | `pages/home/home-skeleton.tsx` | Trimmed to the two face skeletons. |
| `desktop/components/page-states.tsx` | `components/page-states.tsx` | Trimmed to `PageError`. |
| `desktop/components/skeletons/knowledge-skeletons.tsx` | `components/skeletons/knowledge-skeletons.tsx` | The opened-base ghost follows the redesign (naked-glyph header, `.infoColumn`, white-card sections). |
| `desktop/components/skeletons/*.tsx` (the rest) | `components/skeletons/*.tsx` | Verbatim. |

## Shared feature files (`src/features/knowledge/`, which the desktop bundles)

| Staging file | Source |
|---|---|
| `knowledge/components/**` | `src/features/knowledge/components/**` (same relative path), except the new files named above |
| `knowledge/client/hooks.ts` | `src/features/knowledge/client/hooks.ts` (verbatim) |
| `knowledge/client/hooks-channel-grants.ts` | `src/features/knowledge/client/hooks-channel-grants.ts` (verbatim) |
| `knowledge/types.ts`, `scope.ts`, `url.ts` | re-export shims of the real modules |
| `revisions/components/changelog-list.tsx` | `src/features/revisions/components/changelog-list.tsx` (redesigned) |
| `revisions/components/revision-diff.tsx` | `src/features/revisions/components/revision-diff.tsx` (redesigned) |

⚠ These are shared with the web app. Porting a change into `src/features/knowledge/components/`
changes both the desktop and any web surface that mounts them. ⚠ The revisions list is ALSO the
ontology's (object History, ontology changelog); `src/features/ontology-staging/revisions/` holds
its own verbatim copy, so the two staging faces differ until this redesign is ported.

## Staging data layer (never ported)

| Staging file | Stands in for |
|---|---|
| `knowledge/client/api.ts` | `src/features/knowledge/client/api.ts`: same exports and signatures, bodies hit `fake-store.ts` |
| `knowledge/client/realtime.ts` | `src/features/knowledge/client/realtime.ts` (no-op) |
| `stubs/revisions-api.ts`, `stubs/revisions-hooks.ts` | `src/features/revisions/client/{api,hooks}.ts` (knowledge scopes only) |
| `stubs/use-teams.ts` | `src/features/members/hooks/use-teams.ts` |
| `stubs/use-my-access.tsx` | `src/features/members/hooks/use-my-access.tsx` (everything resolves to `edit`) |
| `stubs/use-channel-members.ts` | `src/features/channels/hooks/use-channel-members.ts` |
| `stubs/use-current-profile.ts` | `src/shared/auth/use-current-profile.ts` |
| `stubs/use-presence.ts` | `src/shared/realtime/use-presence.ts` (Grace is always reading) |
| `data.ts` / `fake-store.ts` | the database. Reset on every page mount. |
| `knowledge-staging-page.tsx` | `pages/home/home-panes.tsx › HomePane`'s Knowledge branch (props from boot) |
| `ui-staging/staging-scenario-switch.tsx` (shared) | nothing: the floating "States" pill (channel / role / home space); identities uses it too |
