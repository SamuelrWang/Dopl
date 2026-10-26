# Ontology staging → desktop porting map

`/ontology` (public alias `/playground/ontology`) renders the desktop **/home → Ontology**
face (`apps/desktop-ui/src/pages/home/home-panes.tsx › HomePane`, `ONTOLOGY_PANE` branch)
inside the landing demo window (`src/features/ui-staging/staging-frame.tsx`), on fake data.

Every UI file here is a copy of a source file with only its data imports rewired, and the
board, the top bar and the object panel are now REDESIGNED ahead of their sources (the identity
look: `docs/DESIGN-LANGUAGE.md`, kit and tokens only). To port: diff the staging file against
its source and carry the markup/class changes over; imports of `@/features/ontology/<pure
module>` are the same on both sides, and imports of a staging stand-in (below) stay as the
source has them.

## Files that are copies (port changes back)

| Staging file | Source file |
|---|---|
| `home/ontology-panels.tsx` | `apps/desktop-ui/src/pages/home/ontology-panels.tsx` |
| `home/ontology-share.tsx` | `apps/desktop-ui/src/pages/home/ontology-share.tsx` |
| `home/home-panes.tsx` | `apps/desktop-ui/src/pages/home/home-panes.tsx` (ontology branch only) |
| `home/knowledge-panel-cards.tsx` | `apps/desktop-ui/src/pages/home/knowledge-panel-cards.tsx › EmptyLine` |
| `home/page-states.tsx` | `apps/desktop-ui/src/components/page-states.tsx › PageError` |
| `ontology/components/*.tsx` | `src/features/ontology/components/<same name>.tsx`, except the new files below |
| `ontology/hooks/use-board-display.ts` | `src/features/ontology/hooks/use-board-display.ts` (localStorage key renamed `dopl-staging:…`) |
| `ontology/hooks/use-rows-collapsed.ts` | `src/features/ontology/hooks/use-rows-collapsed.ts` (localStorage key renamed `dopl-staging:…`) |
| `ontology/hooks/use-last-opened.ts` | `src/features/ontology/hooks/use-last-opened.ts` |
| `ontology/hooks/use-object-draft.ts` | `src/features/ontology/hooks/use-object-draft.ts` |
| `revisions/components/changelog-list.tsx` | `src/features/revisions/components/changelog-list.tsx` |
| `revisions/components/revision-diff.tsx` | `src/features/revisions/components/revision-diff.tsx` |

`src/features/ontology/components/*` and `src/features/revisions/components/*` live in the ROOT
web tree and the desktop imports them by `@/…`, so a port there changes the desktop (and any web
surface that mounts them) in one edit.

Data edits in the copies (marked `STAGING` in comments):
- `ontology/components/knowledge-pick-menu.tsx`: entries from `data/demo-ontology-data.ts`
  instead of `useApiQuery('/api/knowledge/bases/:id/entries')`.
- `home/ontology-panels.tsx`: `createOntology` / `setAgentsMayEdit` / snapshot invalidation
  replaced by store calls.
- `home/ontology-share.tsx`: `deleteOntology` replaced by a store call; `Channel` is the
  staging `{ id, name }` shape.

### New in staging (no source file yet — port as new files beside the rest)

| Staging file | What it is |
|---|---|
| `ontology/components/field-list.tsx` | `FieldList` / `objectFieldRows`: an object's fields on hairlines, each value in its kind's face. Rows records, canvas cards and the hover card all render it. |
| `ontology/components/object-type-actions.tsx` | `ObjectTypeActions`: a type's `+` and `⋯` (settings, delete behind a confirm), shared by both type headers. |
| `ontology/components/ontology-rows-group-header.tsx` | The Rows display's group header line. Do not fold it into `kanban-column-header.tsx`, the canvas lane's header. |
| `ontology/components/attribute-value-editor.tsx` | `AttrValueEditor` + `ChipStrip`, split out of `attributes-editor.tsx` for the 500-line cap. |

## Stand-ins (do NOT port — they replace network/Electron code)

| Staging file | Replaces |
|---|---|
| `ontology/hooks/use-ontology.ts` | `src/features/ontology/hooks/use-ontology.ts` + `use-ontology-creates.ts` |
| `ontology/hooks/use-ontologies.ts` | `src/features/ontology/hooks/use-ontologies.ts` |
| `ontology/hooks/use-ontology-shares.ts` | `src/features/ontology/hooks/use-ontology-shares.ts` |
| `ontology/hooks/use-workspace-resources.tsx` | `src/features/ontology/hooks/use-workspace-resources.tsx` |
| `revisions/client/hooks.ts` | `src/features/revisions/client/hooks.ts` |
| `billing/use-workspace-entitlements.ts` | `src/features/billing/components/use-workspace-entitlements.ts` |
| `billing/upgrade-modal.tsx` | `src/features/billing/components/upgrade-modal.tsx` (simplified) |
| `home/use-home-channels.ts` | `apps/desktop-ui/src/pages/home/use-home-channels.ts` |
| `store/staging-ontology-store.tsx` | the API + TanStack cache (in-memory "server") |
| `store/revision-diff-recorder.ts` | `src/features/ontology/server/service-revisions.ts` (live changelog rows) |
| `data/demo-ontology-data.ts`, `data/demo-revisions.ts` | fake data |
| `staging-ontology-page.tsx`, `staging-scenario-panel.tsx` | staging page root + the "States" switcher |

## The redesigned faces

- **Top bar** (`ontology-view.tsx`, `board-header-bits.tsx`, `ontology-switcher.tsx`): the name
  picker is `select-menu.tsx › BARE_TRIGGER_FACE` at `text-heading`; the description is a quiet
  `InlineUnderlineField` in secondary ink (no rule at rest); then the 36px row of
  `SelectMenu variant="pill"` (display), the gear on `page-action-button.tsx › WHITE_PILL`, and
  `CreateButton` ("+ Object"). The ontology view no longer imports `channels/components/bits.tsx`.
- **Object panel** (`object-panel.tsx`, `panel-section.tsx` and the four editors): one
  `.white-card`; the type as a muted eyebrow beside naked delete / close; name and description
  edited in place; each section a muted caption title over hairline rows on the card, keyed rows on
  `panel-section.tsx › PANEL_GRID` (label column, then the value with its kind as a muted `bare`
  menu and the row's ⋯ / ✕ revealed on hover or focus). A field's description is a caption under
  the value. Chips are `ontology-bits.tsx › VALUE_CHIP` (`PILL_BUTTON`); pickers trail the chips as
  a muted `+ Add` / `+ Link`. No grey well and no per-row cards: the source's `PANEL_WELL` /
  `.bento` rows do not carry over (the Agents tab still wears `shared/ui/panel-well.ts`).
- **Board** (`kanban-board.tsx`, `kanban-card.tsx`, `kanban-column-header.tsx`, `ontology-row.tsx`,
  `object-hover-card.tsx`, `ontology-skeleton.tsx`): every object is `.white-card` + `.select-card`
  (ink leading bar when selected), canvas lanes have no grey fill on the dotted ground, a canvas
  card previews its first three fields, and an `enum` value is `StatusPill`. The Rows display is on
  the same kit and has no stylesheet of its own.

## Port-time notes

1. **The product's `ontology-row.test.tsx` pins the old field-name badge.** Its assertions on
   `bg-text-secondary` (`grep -n 'bg-text-secondary' src/features/ontology/components/ontology-row.test.tsx | grep expect`)
   must move to the new face in the same change. Read the other product tests beside each file
   you port (`object-panel.test.tsx`, `kanban-board.test.tsx`, `ontology-switcher.test.tsx`,
   `field-types.test.tsx`) for class pins before porting it.
2. **`ExternalAnchor` takes the chip face through `cn`.** Its `text-link underline` lose to
   `text-text-primary no-underline` by tailwind-merge (`field-list.tsx`'s link case).
3. **`pill` renders plain, `enum` renders `StatusPill`.** `pill` is free text (Industry, Owner);
   only the closed set gets the state face. The kind's name is historical.
4. **The kind menus and the switcher pass no menu width.** The menu kit fits its options
   (`popover-menu.tsx`); drop any width class the source passes there.
5. **A Tailwind class added while the dev server runs may not compile** until a cold rebuild
   (`.next` moved aside). Production builds are unaffected.

## Not cloned

- `apps/desktop-ui/src/pages/ontology/index.tsx` / `detail.tsx` — the older workspace-shell
  route (`/:workspaceSegment/ontology`). It mounts the same `OntologyView` unpinned and
  framed; its own Delete dialog (`components/delete-ontology-dialog.tsx`) is copied but never
  opens on /home (pinned mode hands Delete to the host).
