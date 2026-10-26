# Ontology staging → desktop porting map

`/ontology` (public alias `/playground/ontology`) renders the desktop **/home → Ontology**
face (`apps/desktop-ui/src/pages/home/home-panes.tsx › HomePane`, `ONTOLOGY_PANE` branch)
inside the landing demo window (`src/features/ui-staging/staging-frame.tsx`), on fake data.

Every UI file here is a COPY of a source file with only its data imports rewired. To port a
redesign back: diff the staging file against its source and carry the markup/class/style
changes over. Imports that point at `@/features/ontology/<pure module>` are the same on both
sides; imports that point at a staging stand-in (marked **do not port**) stay as they are in
the source.

## Files that are copies (port changes back)

| Staging file | Source file |
|---|---|
| `home/ontology-panels.tsx` | `apps/desktop-ui/src/pages/home/ontology-panels.tsx` |
| `home/ontology-share.tsx` | `apps/desktop-ui/src/pages/home/ontology-share.tsx` |
| `home/home-panes.tsx` | `apps/desktop-ui/src/pages/home/home-panes.tsx` (ontology branch only) |
| `home/knowledge-panel-cards.tsx` | `apps/desktop-ui/src/pages/home/knowledge-panel-cards.tsx › EmptyLine` |
| `home/page-states.tsx` | `apps/desktop-ui/src/components/page-states.tsx › PageError` |
| `ontology/components/*.tsx` (29 files) | `src/features/ontology/components/<same name>.tsx` |
| `ontology/components/ontology-row.tsx` ⚠ **REDESIGNED, ahead of its source** | `src/features/ontology/components/ontology-row.tsx` — see **Rows display overhaul** below before diffing |
| `ontology/components/kanban-board.tsx` ⚠ **Rows branch redesigned** | `src/features/ontology/components/kanban-board.tsx` — Canvas branch is unchanged; port the `display === "rows"` arms only |
| `ontology/hooks/use-board-display.ts` | `src/features/ontology/hooks/use-board-display.ts` (localStorage key renamed `dopl-staging:…`) |
| `ontology/hooks/use-rows-collapsed.ts` | `src/features/ontology/hooks/use-rows-collapsed.ts` (localStorage key renamed `dopl-staging:…`) |
| `ontology/hooks/use-last-opened.ts` | `src/features/ontology/hooks/use-last-opened.ts` |
| `ontology/hooks/use-object-draft.ts` | `src/features/ontology/hooks/use-object-draft.ts` |
| `revisions/components/changelog-list.tsx` | `src/features/revisions/components/changelog-list.tsx` |
| `revisions/components/revision-diff.tsx` | `src/features/revisions/components/revision-diff.tsx` |

Note: `src/features/ontology/components/*` and `src/features/revisions/components/*` live in
the ROOT web tree and the desktop imports them by `@/…` — porting a change there changes the
desktop (and any web surface that mounts them) in one edit.

Edits made in the copies (all marked `STAGING` in comments):
- `ontology/components/knowledge-pick-menu.tsx`: entries from `data/demo-ontology-data.ts`
  instead of `useApiQuery('/api/knowledge/bases/:id/entries')`.
- `home/ontology-panels.tsx`: `createOntology` / `setAgentsMayEdit` / snapshot invalidation
  replaced by store calls.
- `home/ontology-share.tsx`: `deleteOntology` replaced by a store call; `Channel` is the
  staging `{ id, name }` shape.

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

## Rows display overhaul (Samuel, 2026-10-22, ask 5b)

*"Start with just the row view. When the user is on the row view just overhaul this."*
Proposal and the problems each change answers: KB `orchestration-guidelines › Plans/Ontology
Page Overhaul Proposal 2026-10-22`. **Canvas was deliberately left alone** — flip the board's
display menu to see before and after on one page.

### New in staging (no source file yet — port as NEW files)

| Staging file | Port as |
|---|---|
| `ontology-rows.css` | kit classes in **both** `src/app/globals.css` and `apps/desktop-ui/src/styles/kit.css` (see note 1) |
| `ontology/components/ontology-rows-group-header.tsx` | `src/features/ontology/components/ontology-rows-group-header.tsx` (new file; do **not** fold it into `kanban-column-header.tsx`, which is the Canvas lane's header) |

### Port-time notes

1. **The CSS is scoped and literal on purpose, and both token files must move together.**
   Every selector is `.uis-window .uis-ont-*` and every colour is a literal from
   `docs/DESIGN-LANGUAGE.md` §2. That is a staging shape, not the product shape. Porting means
   turning each recipe into a kit class + tokens in `src/app/globals.css` **and**
   `apps/desktop-ui/src/styles/kit.css` / `tokens.css` — `scripts/check-css-token-drift.ts`
   fails if the two copies disagree, and that check applies to scoped tokens exactly as it does
   to shared ones. ⚠ **Do not "simplify" the port by retuning `--bg-elevated`,
   `--panel-surface`, `--text-primary`, `--text-secondary` or `--text-muted`.** Those are read
   by the whole web app and the desktop SPA; the decision (orchestrator, re #4798) is scoped
   tokens, migrating surface by surface.

2. **🔒 THE REAL `ontology-row.tsx` HAS ITS OLD LOOK PINNED BY TESTS.** Samuel replaced the
   field-name badge with a quiet grey key (channel #4801), so the badge comes out — but
   `src/features/ontology/components/ontology-row.test.tsx` asserts the badge class
   **present** on a label and **absent** on a value — **five assertions, found by
   `grep -n 'bg-text-secondary' <that file> | grep expect`, not by line number.**
   ⚠ The `| grep expect` is load-bearing, not tidiness: the bare identifier returns **six**
   hits, because the file's own docblock names the class too. A note promising five against a
   grep returning six drops its reader into the exact doubt the identifier was meant to remove
   — *has something changed?* **A pointer must return exactly what the note claims it
   returns**, or it is still a pointer resolving to the wrong thing. (Identities Polish,
   2026-10-24, correcting their own rule — the fourth time tonight a fix carried the pattern
   it was fixing.) Verified: bare grep 6, scoped grep 5. Removing
   `bg-text-secondary` without moving all five onto the new quiet-key recipe fails that file.
   Its header comment also says what is pinned is "the TOKEN, not a colour", so re-pin the
   same way: assert the new class, not a hex.
   ⚠ **CITE THE IDENTIFIER, NOT THE LINE — this note used to say "lines 102, 110 and 180,
   and 96 and 155".** Those numbers were correct when written and are a pointer whose target
   moves when anything above it changes. Demonstrated in this very tree: one fixture in
   `ontology-row.test.tsx` was quoted as three different line numbers within an hour —
   `:140`, `:148`, `:161` — **without the line itself ever being edited**, because docblocks
   above it grew. Three agents then reported on "the same line" and meant three things. A
   grep-able identifier survives edits above it; an offset does not. (Identities Polish,
   2026-10-24, and it is the one failure of the round that lived in the addressing scheme
   rather than in the code.)

3. **The 50-line badge justification comment goes with the badge.** `ontology/components/ontology-row.tsx`
   lines ~158–209 in the source argue at length for the dark filled badge (the #3031 → #3186
   thread). Left in place after the port it documents the opposite of the shipped language.
   Delete it with the badge and leave one line pointing at #4801.

4. **`ExternalAnchor` needs an element in the selector.** It hard-codes `text-link underline
   underline-offset-2` via `cn()`, and a `className` it receives cannot outrank those by string
   order. The chip face wins through specificity (`.uis-window a.uis-ont-chip`). Keep that
   shape in the port, or the link chip renders underlined and blue.

5. **The relationship label's italics are gone** (`ontology-row.tsx` and
   `object-hover-card.tsx` both had them). An edge is marked by a direction glyph on its key
   instead. The hover card still has its italics and its cursor-following `onMouseMove` —
   both out of scope this round, both still open in the proposal (P7, P8).

6. **⚠ A TAILWIND CLASS ADDED WHILE THE DEV SERVER RUNS NEVER COMPILES** — settled on a cold
   rebuild 2026-10-23, and it will bite the port exactly as it bit this build. The warm `.next`
   cache carries a stale scan set and a restart does NOT refresh it; only a cold rebuild
   (`.next` moved aside) does. ⚠ **NOT "a class present at boot compiles"** — that shorthand is
   false, and this build disproved it: `mr-2.5` was present at the 22:49:49 boot, its sheet was
   built 22:50:28, and it was still dead until the cold rebuild. Boot timing is not the
   variable; the cache is. Corrected in `Plans/UI Standing Rules`, in the **cache-invalidation
   instance of Rule 6 (prove the style exists)** — named rather than numbered because that
   heading appears TWICE on purpose, cache invalidation and subgrid toolchain, so a bare "Rule
   6" is ambiguous even when correct. It cost one real
   defect here (`mr-2.5` → the record's fold chevron flush to the card edge, markup correct,
   no CSS). **When you port, add your utilities and then cold-rebuild before judging anything
   visually**, or style it with literal CSS, which is immune. Production builds are unaffected.
   Verify a class by dumping its selector family out of the served sheet and reading it —
   `grep -oE '\.mr-[0-9a-z\\.]+ \{' .next/dev/static/css/app/layout.css` — not by probing one
   class, which gave confident wrong answers in both directions.

7. **⚠ `ui-staging/staging.css` IS GLOBAL TO ALL SIX PLAYGROUND ROUTES.** The shared frame
   (`ui-staging/staging-frame.tsx`) imports it, so every selector in it reaches /overview,
   /channels, /knowledge, /identities, /ontology and /popups alike — not just the face whose
   worker wrote it. Proof from this tree: `.uis-ap-host`, a channels-staging rule, is served in
   the ONTOLOGY route's own sheet. ⚠ **PLAYGROUND ONLY — it does NOT reach the landing page,
   and nobody should "fix" the landing page over this.** Measured 2026-10-23: the landing
   route's own sheet (`/_next/static/css/app/page.css`) contains ZERO `uis-*` classes —
   `uis-window`, `uis-ap-host`, `uis-rail-create`, `uis-idp-act` and `uis-ont-rec` are all 0.
   App-router emits CSS per route and only `staging-frame.tsx` imports `staging.css`, so it
   cannot land anywhere the frame is not mounted. A staging rule naming a `.lp-demo-*` class
   never reaches the landing page even though those classes render there too; that page loads
   `marketing.css`, which is where `.lp-demo-*` legitimately lives (5 hits in that sheet). So an
   unscoped rule added there for one face silently restyles the other five, and a rule whose
   scope rests on a single class name loses that scope the moment the name changes.
   ⚠ **CORRECTION 2026-10-23:** this note previously cited a `:has(> .uis-ap-host)` flatten
   rule as the example. That rule does not exist — `staging.css` contains no `:has(` at all. I
   reported it on the strength of a class-NAME grep hit at a line that actually held a plain
   sizing rule, without reading the matched selector. The hazard above is real and measured;
   that example was not. **That is why the rows face keeps its CSS
   in `ontology-staging/ontology-rows.css` and scopes every selector `.uis-window .uis-ont-*`
   rather than adding to `staging.css`.** Keep that shape in the port: a face's rules belong to
   the face. Verify reach by grepping the OTHER routes' served sheets, and read the matched
   selector, not just the line number — a class-name hit says nothing about what the rule does.

8. **`pill` renders plain, `enum` renders a grey pill.** Deliberate, and the one place a
   maintainer is likely to "fix" it: `pill` is free text (Industry, Owner, Version) while
   `enum` is one of a closed set, so only the closed set gets the state face. The kind's name
   is historical.

## Not cloned

- `apps/desktop-ui/src/pages/ontology/index.tsx` / `detail.tsx` — the older workspace-shell
  route (`/:workspaceSegment/ontology`). It mounts the same `OntologyView` unpinned and
  framed; its own Delete dialog (`components/delete-ontology-dialog.tsx`) is copied but never
  opens on /home (pinned mode hands Delete to the host).
