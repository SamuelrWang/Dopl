# /identities staging → desktop porting map

`/identities` stages **desktop /home → Identities**: the face the shipping desktop shows (it boots
to `/home`, `apps/desktop-ui/src/pages/boot/index.tsx` → `HOME_PATH`), rendered inside the landing
demo's window (`src/features/ui-staging/staging-frame.tsx`).

The other surface, the workspace route `/:workspaceSegment/identities`
(`apps/desktop-ui/src/pages/identities/index.tsx` → `src/features/agent-identities/components/agent-identities-core.tsx`:
Private / Team / Public sections), is NOT staged. The Home pane never opens it. It reuses the same
`IdentityPanel` / `IdentityGrid` cards and the same `IdentityEditor` staged here.

## How to port a change back

1. Edit the staging file. Reload (HMR).
2. Apply the same diff to the source file in the right column. The files are verbatim copies apart
   from import paths and a one-line header, unless the Notes column says otherwise.
3. Never port `data.ts`, `identity-store.ts`, `stubs/*`, `agent-identities/hooks/*` or
   `identities-staging-page.tsx`: those are the staging data layer.

## Desktop-local files (`apps/desktop-ui/src/`)

| Staging file | Desktop source | Notes |
|---|---|---|
| `home/identity-panels.tsx` | `pages/home/identity-panels.tsx` | `Channel` → `StagingChannel`; `channelPeople` from `data.ts` (port of `home-rows.ts`). **Also wires the redesigned card: `faceFor`, `scopeLabel`, `catalogs` — see "The card redesign" below.** |
| `home/identity-editor.tsx` | `pages/home/identity-editor.tsx` | Verbatim. |
| `home/identity-card-launch.tsx` | `pages/home/identity-card-launch.tsx` | `LaunchIntoChannelButton` verbatim. `useCardLaunch` is SIMULATED (no bridge); do not port it. |
| `home/identity-card-knowledge.tsx` | `pages/home/identity-card-knowledge.tsx` | Verbatim. |
| `home/home-skeleton.tsx` | `pages/home/home-skeleton.tsx` | Trimmed to `HomeIdentityPanelsSkeleton`. |
| `desktop/components/page-states.tsx` | `components/page-states.tsx` | Trimmed to `PageError`. |
| `desktop/components/skeletons/*.tsx` | `components/skeletons/*.tsx` | Verbatim. |

## Shared feature files (`src/features/agent-identities/`, which the desktop bundles)

| Staging file | Source | Notes |
|---|---|---|
| `agent-identities/components/identity-section.tsx` | `components/identity-section.tsx` | ⚠ **NOT verbatim — the card is redesigned here** (see below). Panel, grid and every existing prop unchanged. |
| `view/identity-view-dialog.tsx` | — (new) | The read-only identity popup, item 2d. See "The view popup". |
| `view/identity-modal-shell.tsx` + `view/identity-view.module.css` | — (new; copies `shared/layout/settings-modal/modal-shell.tsx` + that module's chrome) | The popup's shell, copied before restyling. The CSS header lists the three deltas and the port target. |
| `view/identity-view-mocks.ts` | — (staging data layer, never ported) | Tools, rules, escalations, the activity log and the running list. ⚠ Three of those are not fields on an identity yet. |
| `view/identity-view-dialog.test.tsx` | — (staging only) | Proof the popup mounts, all four tabs switch, every tab is input-free, and Edit hands over. `curl` cannot see a portal opened by a click. |
| `agent-identities/components/identity-editor.tsx` | `components/identity-editor.tsx` | Verbatim; `useLaunchSelection` → `stubs/use-launch-selection.ts`. |
| `agent-identities/components/knowledge-scope-picker.tsx` | `components/knowledge-scope-picker.tsx` | Verbatim. |
| `agent-identities/components/knowledge-scope-tree.tsx` | `components/knowledge-scope-tree.tsx` | Verbatim; `useKnowledgeTree` → `stubs/use-knowledge-tree.ts`. |

Imported unchanged (pure, not copied): `components/identity-editor-rows.tsx` (field rows, team chips),
`components/identity-picker.tsx › authorMarker`, `lib/*`, `client/api.ts › agentIdentityErrorMessage`,
and every `@/shared/ui/*` kit primitive (`FormDialog`, `ConfirmDialog`, `SectionPanel`, `EmptyState`,
`OpenScaleButton`, …). Copy one in first if a redesign needs to change it.

⚠ The shared files are shared with the web app: porting into `src/features/agent-identities/`
changes both.

## The card rebuild (2026-10-22, items 2 + 2b)

Item 2's ask: *"overhaul the identity cards … they could also have 'Shared in this channel' and
icons for the user profile and what runtime it is if they have a runtime selected"*. That pass
made only the named edits and was sent back (*"I said to do an overhaul"*), so **item 2b rebuilt
the card**, with one amendment that governs it: *"it doesn't need to look at any template. It just
needs to use the design elements… Just think about what it should have."*

So the LANGUAGE is `docs/DESIGN-LANGUAGE.md` (white card on a hairline, one soft shadow, grey wells
inside it, the identity avatar, the type ladder, green only for live) and the CONTENT is reasoned
from what a person does with the page: pick a role. The four questions the card answers, in order,
are in `identity-section.tsx › IdentityCard`'s docblock, along with what is deliberately left for
the editor. Scope throughout: **cards and their sections only** — no page reskin (two of those were
reverted).

Card anatomy now: identity avatar (38px) + name + the owner's line, the roster stack for a shared
row, the description at 12px, a chip row, the scope line, the state line (live count + last used),
and for a personal row an action block holding the dashed add-knowledge row and a full-width Launch.

🔒 **ONE CONCEPT PER CONTAINER (item 2c, Samuel: *"if the runtime is Claude it doesn't really make
sense for the knowledge or whatever to be placed on the same thing"*).** 2b had put the model and
the knowledge count in one box, which claims they belong together. They are two facts, so they are
two chips side by side — runtime logo + model, and the product's own knowledge glyph + the count.
**Nothing is appended to a chip that is not that chip's own concept**, and a chip is as wide as its
fact rather than stretched. The rule is pinned at `identity-section.tsx › IDENTITY_ROW`; keep it
when porting, and when adding a fact give it its own chip rather than the nearest one.

What changed, and what each piece needs to land in the product:

| Change | Where | To port |
|---|---|---|
| Card face: pure white at the 12px card radius (`docs/DESIGN-LANGUAGE.md` §1 rule 1, white surfaces not grey, and §2), still `.bento` + `.card-lift` | `identity-section.tsx › IdentityCard`, `shell` | `rounded-xl bg-white` are literals on the staged card. In the product add the recipe beside `.bento` in `globals.css` + `apps/desktop-ui/src/styles/kit.css` (the CSS drift gate compares the two) and use it by name. The same call is open for the staged white panel (`ui-staging/staging.css`). |
| The identity avatar: owner photo + runtime badge, 30px | `shared/ui/identity-face.tsx › IdentityFace` with `ring="neutral"` | The shared face (2026-10-26; the staging fork `identity-avatar.tsx` is deleted). The badge is ABSENT when no runtime is selected and the ring is the raised hairline, because an identity has no agent colour. The §3 ratio is `IDENTITY_RING_PX`. |
| `faceFor` prop: who owns the row and what it runs on | `identity-section.tsx › IdentityGrid`, `IdentityCardFace` | Staging answers it with `data.ts › identityCardFace`. **The product has neither half yet:** the photo needs a roster entry for `identity.createdBy` (the channel payload's `peers` + the caller's own avatar — `useContainerAuthorMarker` already reads `peers`, so the names are there and the avatars are not), and the logo needs a runtime→logo map, which does not exist outside the login journey's `WEB_LOGIN_IMAGES` / the landing demo. Add it beside `RuntimeDescriptor` (`features/channels/lib/runtime-capability.ts`) so every surface reads one table. Absent either half the card still renders: no photo = the profile glyph, no logo = no badge. |
| `scopeLabel` prop: "Shared in this channel" on every shared card | `identity-section.tsx`, passed by `SharedIdentitySection` | Hand down the section's own `label` (`lib/visibility.ts › SECTIONS_CONTAINER[0]`). Never type the words in a component. The Personal section passes none on purpose. `IdentitySection` (the workspace page's Private/Team/Public) passes none either, so that page is untouched. |
| The authorship marker is now the owner's line under their photo, not a grey pill | `identity-section.tsx › IdentityCard` | Still `identity-picker.tsx › authorMarker`, still on every row the viewer did not write (INVARIANTS §5A). It is a security signal: port it as a visible line, do not drop it. |
| The fact chip (`IDENTITY_ROW`) and the dashed add row (`IDENTITY_ROW_ADD`) | `identity-section.tsx` | Both are Tailwind recipes on existing tokens (`--border-default`, `--bg-elevated`, `--text-caption`), exported so the card and its controls cannot drift. In the product they belong in the kit beside `.bento`, in BOTH copies (the CSS drift gate compares them). |
| `statsFor` prop: running count, last used, who wears it | `identity-section.tsx › IdentityCardStats` | **All three are mock in staging** (`data.ts › identityCardStats`, allowed by ask §2b) and all three exist in the product already, unjoined: `running` is the live session list filtered by `identityName` (`channels/components/agents-tab-cards.tsx` prints that field), `lastUsed` is `updatedAt` through a relative formatter, `wornBy` is `channel.peers`. ⚠ `lastUsed` is a formatted LABEL, not a timestamp: the staged clock is fixed, and a relative label computed against the real clock differs between the server and client renders. Format it client-side in the product. |
| The knowledge control no longer lists attachments | `home/identity-card-knowledge.tsx › AddKnowledgeWell` | It was a grey box of white bars plus the words, the heaviest thing on a personal card, saying what the spec bar now says as a count. It is one dashed add row. The dialog and `refs` on the signature are unchanged, so the caller and the save path are untouched. |
| Launch is full width at the foot of the card | `home/identity-card-launch.tsx` | `className` only — `OpenScaleButton`'s face is untouched and layout is the caller's by that component's own division. The pill tucked right read as a secondary control. |
| Model chip reads "Sonnet 5", not "Claude Sonnet 5" | `home/identity-panels.tsx`, `catalogs` | `agentModelShortLabel` only has a `short` when handed the catalogs, and /home never handed them over — the card has accepted the prop all along. In the product /home, read them from `use-launch-selection.ts` (`{ kind: "defaults" }`) as the editor already does. Without them the chip falls back to the long prettified id, which crowds a 4-up card. |

## Staging data layer (never ported)

| Staging file | Stands in for |
|---|---|
| `agent-identities/hooks/use-agent-identities.ts` | `src/features/agent-identities/hooks/use-agent-identities.ts` |
| `agent-identities/hooks/use-identity-save.ts` | `src/features/agent-identities/hooks/use-identity-save.ts` |
| `agent-identities/hooks/use-attachable-bases.ts` | `src/features/agent-identities/hooks/use-attachable-bases.ts` |
| `stubs/use-knowledge-tree.ts` | `src/features/knowledge/client/hooks.ts › useKnowledgeTree` |
| `stubs/use-launch-selection.ts` | `src/features/channels/hooks/use-launch-selection.ts` (runtimes + model catalogs) |
| `data.ts` / `identity-store.ts` | the database. Knowledge rows are `/knowledge`'s seed. Reset on mount. `identityCardFace` + `RUNTIME_LOGOS` stand in for the roster and the runtime registry (see "The card redesign"). |
| `identities-staging-page.tsx` | `pages/home/home-panes.tsx › HomePane`'s Identities branch |

## The view popup (item 2d)

A card click used to open the EDIT FORM. Samuel: *"that should not be the case… the popup needs to
show just the identity as is in a non-editable format. We actually need to overhaul that entirely
because right now it looks really mediocre… There can be a button at the top right or something
where the user can click Edit… It shouldn't be a ton of scrolling. I think we probably need to make
maybe different tabs."*

So `onOpen` now opens `view/identity-view-dialog.tsx`, and the editor is reached from its Edit
button. `identity-panels.tsx` holds a second piece of state (`viewing`) carrying the same
`where` the editor needs, so Edit hands the row to the mount that writes into its own workspace.
**Create still opens the editor directly**: there is nothing to view about a row that does not
exist yet.

Four tabs, Samuel's own four axes in his order, in a FIXED box so the frame never moves when a tab
changes and only the body scrolls:

| Tab | Holds | Where the data comes from |
|---|---|---|
| Identity | description, instructions as a quoted standing order, runtime + model, knowledge paths, custom fields | the real `AgentIdentity`, all of it |
| Tools and rules | tools with an Allowed / Off chip, rules as lines, "Escalates to you" | ⚠ **MOCK.** None of the three is a field on an identity. The landing sells all three (`multiplayer-content.ts`); `Plans/Identities Page Ideas 2026-10-22` §C11 is the open call |
| Activity | one summary line, then one row per action: what it did, where, the permission when it was not plain Auto, the time | mock, shaped on the landing's Monitoring log (`control-content.ts › LOG_ROWS`). The product has the audit trail; it is not joined to an identity |
| Running | one row per live agent: name, channel › thread, how long | mock. The product has the live session list; `identityName` is already on it |

Decisions worth keeping when porting:

- **Read-only means read-only.** A tool's grant is a chip, not a toggle; a rule is a line, not a
  field. The landing draws toggles because it is selling the editor. The test asserts the popup
  holds zero inputs on every tab.
- **The head never changes with the tab** (face, name, owner marker, scope), so the popup always
  says whose role you are reading. The author marker is passed in from the card's own
  `authorMarker`, not recomputed (INVARIANTS §5A).
- **`auto` draws no permission chip.** A chip on every row is exactly the bloat Samuel named.
- **The edit form was NOT redesigned here.** He said it is "probably a slightly different UI", and
  it already is one (`FormDialog`). If he wants that surface reworked it is its own item.

## The page's own surfaces (item 3c)

Samuel's picks off `Plans/Identities Page Ideas 2026-10-22` § "Page-level ideas": active identities,
runtime readiness, a page activity feed, an all-channels view with a scope-down control, and
search / sort / filter. Not the teaching intro, not credits. Layout was left to the agent, with
*"I don't know if it should be a strip"* as the only steer.

### Arrangement, and why

Three surfaces above the grid, in this order, each where its job puts it:

1. **`page/identity-page-head.tsx`** — the scope control and runtime readiness. These two change
   what the grid MEANS, so they sit above it. Two containers on one row, because they are two
   facts (the 2c rule). Readiness is one muted line with a green dot when everything can launch and
   only grows a word and an amber mark when something needs you.
2. **`page/identity-activity-panel.tsx`** — one panel, two tabs: Active now and Recent. One
   concept (what my roles are doing) at two tenses, which is what tabs are for; the live count
   rides on its own tab as a badge rather than being said twice. Above the grid because both
   answers are time-sensitive and the panel is three rows tall. NOT a right rail: four cards across
   is Samuel's ruling and a rail costs a card per row.
   ⚠ **SUPERSEDED by Item 8 (2026-10-24): Samuel asked for the right rail, 3/4 | 1/4.**
3. **`page/identity-controls.tsx`** — search, runtime filter, sort. Directly above the grid,
   because a control belongs beside the thing it changes; the scope control is in the head because
   it changes what the page is, these only rearrange what is on it.

Rows, not cards, for events: a card is for picking a role, and giving an event a card face would
make the page look like it has twice as many roles.

### What each piece needs in the product

| Piece | To port |
|---|---|
| The shared read is no longer bound to the selected channel | `identity-panels.tsx` now reads the shared set directly instead of `channel?.workspaceId`. **The product needs a new server read**: the shared identities across every channel the caller is in, each carrying which channels it reaches. Today `GET /api/agent-identities` takes one workspace. |
| Which channels a shared row reaches (`identity-page-data.ts › sharedReach`) | ⚠ **AN OPEN PRODUCT QUESTION, NOT JUST MISSING DATA.** A shared identity lives in ONE link container, so "shared in #releases and #tech-debt" assumes either that a container can back several channels or that a row can be lent to several. Samuel's call. The UI shows the shape either answer needs. |
| Runtime readiness | A real desktop fact that no web page can read: the registered runtimes come from `use-launch-selection.ts` and the signed-in state is the runtime prompt's. Mock here, switchable on the States pill (All ready / Needs re-auth / Not signed in). |
| Active now, and the page feed | Mock, but both exist in the product unjoined: the live session list already carries `identityName`, and the audit trail is the feed. A log row carries `at` (minutes ago) and NOT a clock string, because the page feed interleaves every identity's rows and because a label derived from a constant is hydration-safe. |
| The shared section heading varies with scope | At "all channels", `SECTIONS_CONTAINER[0].label` ("Shared in this channel") is simply false. `visibility.ts` needs a second form, or the heading becomes the page's to compose (it is, here). |
| `scopeLabel` became `scopeFor` on `IdentityGrid` | Per row, not per section: the grid now shows rows from several channels at once. |
| The search field is NOT the kit's `SearchField` | `SearchField` is `.concave-field`, and concave surfaces are BANNED on /home (swept by `identity-editor-surface.test.tsx`). It wears `select-menu.tsx › TRIGGER_FACE.flat` instead, so the three controls read as one family. **Port target: a flat variant of the kit's search field**, not a fourth hand-rolled input. |
| Three row faces, declared together | `identity-section.tsx › IDENTITY_ROW` (card chip), `IDENTITY_ROW_WIDE` (popup value row), `IDENTITY_ROW_EVENT` (page event row). Whole faces, never layered: `cn(IDENTITY_ROW, "h-8")` leaves which height wins to Tailwind's output order. Same rule the kit states at `select-menu.tsx › TRIGGER_FACE`. |
| `home/identity-sections.tsx` is new | The two card sections, lifted out of `identity-panels.tsx` when the page surfaces pushed it past the 500-line lint ceiling. Nothing about them changed in the move; the desktop source needs the same split or keeps them inline. |

### One thing left open

**Launch still follows the SELECTED channel, not the page scope.** Launching is "into this
conversation", so it needs a target, and the pane's own channel is still that target. With the page
spanning every channel there are now two notions of channel on one surface. The alternatives are to
make the scope control the launch target when it names one channel, or to ask at launch. Samuel's
call; nothing was guessed. Creating a shared identity already follows the scope: the create button
appears only when the page is narrowed to one channel, and the section caption says so.

## Item 2e — the view popup's formatting

⚠ **2d's popup FAILED Samuel's look**: *"no formatting… hodgepodge of random stuff"*, against the
identity cards' *"very clear-cut elements"*. The content and the tab structure were right; the
composition was four tabs in four different languages — full-width bars on the Identity tab, bare
bullet lists on Tools and rules, bordered boxes on Running, borderless rows on Activity.

**The fix is a vocabulary, in `view/identity-view-parts.tsx`.** Four elements, and every tab is
composed of them and nothing else (the clear-cut-elements rule): `Group` (a labelled region; two sit side
by side where their content is short), `Chip` (one fact, **as wide as the fact**), `Fact` (a label
above a value, in a 3-across grid), `EventRow` (lead · a fact in the MIDDLE · trail). Prose stays
prose. `Lines` draws rules and escalations as discrete marked lines, never a paragraph.

🔒 **The Blank Space Rule (Standing Rule 1) drove three of those shapes:**

| Was | Now | Why |
|---|---|---|
| runtime + model + every knowledge path as `IDENTITY_ROW_WIDE` bars | `Chip`s, wrapped | at 680px of body a bar was a 14px mark, nine characters and 600px of nothing |
| "Runs on" and "Knowledge" stacked | side by side (`GroupPair`) | two groups of two short chips, stacked, are two half-empty rows |
| custom fields one per full-width row | a 3-across `Facts` grid | a field is a short label over a short value |
| "Rules" and "Escalates to you" stacked | side by side | same reason |
| the Activity tab's "6 actions today" on its own line | the group label's `hint` | a count is a label's job, not a row's |
| Running rows each in a bordered box | the SAME `EventRow` as Activity, un-boxed | two tabs of one popup looked like two products |

Also folded in here (item 7's page-wide grey ban, `--bg-inset` out): the state chip is a hairline
over the near-white surface, the live tab count is a dot and a number with no pill, and the
knowledge dialog's selected set is a hairline well.

⚠ `view/*` imports `IDENTITY_ROW` from `agent-identities/components/identity-section.tsx`
**read-only** — one chip recipe for the card and the popup. That file belongs to another worker
(boundary agreed in-channel 2026-10-22); if `ROW_INK` or a row face changes there, this follows it.

## Item 7 — the page's granular polish (worker: Identities Polish)

Samuel's seven named fixes on `/playground/identities`, plus the Standing Rules (`KB
orchestration-guidelines › Plans/UI Standing Rules`) that landed mid-task. Scope: the PAGE
surfaces — `page/*`, and the one-token grey swap in the avatar's photo-less fallback (now `IdentityFace`). `view/*` and
`overview-staging` are item 2e's (boundary agreed in-channel, 2026-10-22).

| Fix | Where | To port |
|---|---|---|
| 1. Dropdowns lose the pill: label + bare arrow | — | **Ported (2026-10-26)**: the kit's `select-menu.tsx` has the `bare` face (value + muted chevron, ink-only hover) and the content-fit menu width; this page passes `variant="bare"` and the staging copy is deleted. |
| 2. The grey (`--bg-inset`, `#f1f1f1`) banned from the page | `page/*`, `shared/ui/identity-face.tsx` | Nothing in the product needs adding: every replacement is an existing token. Chips and the readiness button are `border-border-default` over `bg-white`/`bg-bg-elevated` (the card's own chip family); hovers are `--surface-raised-1`, the kit's one sanctioned option-row hover, which is a 2% ink tint and not a grey fill. The avatar's photo-less fallback is `bg-bg-elevated`. ⚠ **The ban is kept by construction, not by a rule to remember:** the three controls that wore the grey all wore it via `SelectMenu variant="flat"`, and `bare` has no fill at all. |
| 3. The search bar is the app's own rounded one | `page/identity-search-field.tsx` (new) | **Zero new CSS and nothing hand-rolled.** It wears `.search-expand` + `.search-expand-shell` + `.search-expand-input` + `.search-expand-toggle` — the kit recipe `pages/home/home-search.tsx` already wears, which ships in BOTH CSS copies (`globals.css` + `apps/desktop-ui/src/styles/kit.css`), so the port is a file move. Two deltas from `home-search.tsx`, both because this is a filter and that is a popup host: `data-open` is pinned true, and it carries a clear (×). Still NOT the kit's `SearchField` — that is `.concave-field`, banned on /home and swept by `identity-editor-surface.test.tsx`. |
| 4. Activity rows became a grid | `page/identity-activity-panel.tsx › EVENT_GRID` | One six-column template on every row, so columns align down the panel: face · what it did · two middle facts · state · when. Rows went from two lines to one. **`IDENTITY_ROW_EVENT` is no longer used by this panel** (it is `flex w-full` with a hairline and a fill — a box inside a box that is already a panel) and is left in place, unreferenced, for whoever owns `identity-section.tsx`. **Port target: declare `EVENT_GRID` beside the other three row faces there**, so an edit to the family reaches all of them; it is here only because that file was being edited by another worker in the same hour. |
| 5. Activity filters | same file | Two bare menus beside the tabs: whose identity (Everyone / Just mine / each owner present) and what state. ⚠ **The owner options are built from the rows ON SCREEN, never from the roster**, so the menu cannot offer a filter that empties the panel; and `createdBy` is nullable, so an author the roster cannot name offers no filter (the same refusal `authorMarker` makes, INVARIANTS §5A). In the product the current user is a prop; staging reads `STAGING_USER_ID` so that `identity-panels.tsx` needed no edit. |
| 6. Bigger profile icons | same file, `FACE_PX` | 22px → 28px. One number: the §3 ratio and the badge are both derived from the diameter. |
| 7. Descriptive state on the RIGHT, filterable, never ended | `page/identity-page-data.ts`, same panel | The leading green dot is DELETED. `ActiveRun.state` is two-valued (`working | idle`) and the column says the word; the dot survives only as the live mark beside "Working…". ⚠ **`ended` is dropped in `activeEverywhere`, not in the view**, and `ActiveRun.state` has no `ended` member, so no surface can draw one by forgetting. In the product, `runState()` is DELETED: the live session list reports its own state (that table's column is literally `working | idle | ended`); the 30-minute line exists only to get a mixed list out of fixtures that carry nothing but an elapsed label. |

### The ended-run pool is not padding

`identity-page-data.ts › ENDED_RUNS` adds finished runs to the staging pool on purpose.
`identity-view-mocks.ts › running` holds only live rows, so a filter written against it alone
drops nothing, passes, and leaves fix 7's one absolute ("I don't think it should show ended
agents") unenforced the moment the page is wired to real data — the product's session list really
does return ended rows. A first pass had exactly that bug: the ended rows named threads that did
not exist in the mock, so the gate was green while enforcing nothing. `identity-page-data.test.ts`
now pins both halves: the pool contains ended rows, and `activeEverywhere` returns none of them
while keeping the live run on the same identity.

### What the Standing Rules changed, beyond the seven

| Rule | What it caught here | Fix |
|---|---|---|
| 1 — Blank Space | `IdentityControls` pinned its "N of M" count with `ml-auto`, leaving ~400px of nothing between the menus and it; `RuntimeReadinessRow` did the same with most of the pane | `ml-auto` deleted from both. These rows are not containers, so they end where their content ends and the rest is page (1.3's first and last options). |
| 1 — Blank Space | A five-column first pass still failed when MEASURED at pane width: one `1fr` sentence track ended around 190px and the next column did not start for 300 more | A second middle fact per tab, and four of six tracks capped, so the row cannot grow a hole as the pane widens. |
| 1 + 4 | "whose identity" as that fact printed the same word twice on three of five live rows (`run.agent` is the agent's name and agents are named after the role they wear: "Flake Hunter · Flake Hunter"). Meanwhile the live tab's own two facts sat in ONE string, `"#releases › Cut 1.7.24"` | The live tab's middle columns are the channel and the thread, split; the Recent tab's are the identity and the place, which were `name · where` in one string. A column that repeats its neighbour is worse than the hole it filled. |
| 5 — structure before font styling | The row carried three text stylings where the column edges already separated the facts | The two middle facts share one styling. The skeleton is the grid, not a second shade of grey. |

**Verified:** `curl` 200 on `/playground/identities` with no error overlay and the rows rendering
three distinct facts each; `tsc --noEmit` clean for both staging trees (the one repo error is a
stale generated `.next/types/validator.ts` for a route that does not exist); `eslint` clean;
`vitest` 12/12 in `identities-staging`, including the three new gates above.

### Correction: the activity grid shipped a regression, and what replaced it

The first item-7 grid gave "what it did" a `1fr` track, so the row filled the pane. Samuel saw it
immediately: *"Look at the activity… There's even more blank space… It is actually getting worse."*
He was right. I had measured the track against the **Recent** tab, where that column holds a
sentence — but the panel OPENS on **Active now**, where it holds a short agent name. ~95px of text
in a ~330px track is a ~235px hole, in the default state, on the one surface whose blank middles
were the entire complaint. The diagnosis offered first ("stale tab") was also wrong: the dev server
was proven current and serving the new markup, so the only explanation left was the code.

What replaced it: the tracks moved onto the LIST (`EVENT_LIST`), all six are `auto` except one
`minmax(0,26rem)` cap on the sentence, and each row borrows them with `grid-cols-subgrid`
(`EVENT_ROW`). A column is then exactly as wide as the widest thing in it and the table exactly as
wide as its columns, so intra-row slack has no mechanism to form. Subgrid is what makes it align:
per-row grids with `auto` tracks each size to their own row and align with nothing. Horizontal
padding may not go on the row — padding offsets a subgrid's borrowed tracks.

**Pinned, because the break looked green** (200, typecheck clean, tests passing, hole on screen):
`page/identity-activity-panel.test.ts` asserts the tracks are declared once on the list and
borrowed, that no `1fr` or `grid w-full` survives, that the row carries no horizontal padding, and
that the longest fixture on EACH tab fits inside the cap. jsdom does no layout, so these are source
and fixture assertions rather than a rendered width — the point is that the rule and the data the
rule depends on are both checked.

**Practice, for anyone porting this:** measure every state and tab a surface can open in, default
state first. A width check against one tab's content is not a width check.

### The activity grid is hand-written CSS, and why that is not a style choice

**Tailwind emits nothing for a class unique to `src/features/identities-staging/`.** Proved
2026-10-22 with two canary utilities, one in a NEW file and one in an EXISTING one: neither reached
the compiled stylesheet after a rebuild, while `.uis-*` rules from `ui-staging/staging.css` did.
Corroborating data points, all absent from the compiled CSS: `min-h-[104px]` (the card shell) and
`place-items-center`, whose only four users in the repo are all inside staging trees. Classes that
also exist in scanned trees (`w-fit`, `rounded-[7px]`) compile fine, which is why the page looked
mostly styled and only the rare utilities were dead.

Consequence: `grid-cols-[…]`, `grid-cols-subgrid` and `col-span-6` were all inert, so the rows were
`display: grid` with NO template — one column, every cell on its own line. That is the vertical
stack Samuel screenshotted, and it had been live since the FIRST item-7 grid edit. Two verifies
passed over it because a class present in the HTML proves nothing about whether a rule exists.

⚠ **A `page.css` check is not an emission check.** The Tailwind utility layer is served in
`app/layout.css`; `staging.css` lands in the route chunk `app/playground/<face>/page.css`. Probing
one and concluding about the other is a false negative either way.

**PORT ITEM, SAMUEL'S CALL (not done here):** the real fix is a Tailwind v4 `@source` line in
`src/app/globals.css` pointing at the staging trees, so their utilities compile like everything
else. That is a product-file edit affecting the real app build, so it was not made from a staging
task. Until then, staging layout that needs a rare utility belongs in a `.uis-*` block in
`ui-staging/staging.css` (append-only, own prefix, `.uis-window`-scoped).

### Measured, in a real engine

Verified with `chrome-headless-shell` over CDP (no browser pick needed from anyone), at a 1600px
viewport giving a 1156px panel — because the two previous verifies were greps and both passed while
the page was broken. `CSS.supports("grid-template-columns","subgrid")` is true in Chrome 143.

| Tab | table width | rows | layout | worst per-cell slack |
|---|---|---|---|---|
| Active now (default) | 461px | 5 | every row one line, 1 y-centre | 47px |
| Recent | 628px | 7 | every row one line, 1 y-centre | 134px (shortest sentence against the widest) |

The measurement also caught a SECOND hole of the same family as the original `1fr`:
`minmax(0, 26rem)` resolves to its 416px **maximum** under `width: fit-content`, so the column sat
at 416px with 70px of text in it. `fit-content(26rem)` is the function that sizes to content and
clamps only past the cap. `identity-activity-panel.test.ts` now pins `fit-content` and forbids
`minmax`/`1fr` in the primary rule, and pins the `@supports` fallback that stops a no-subgrid
engine stacking again.

**One Blank Space Rule question (point 2) left open, deliberately not guessed:** the table is content-width (461px)
inside a full-width panel (1156px), so the panel's right side is empty. Options are to narrow the
Activity panel to its content, to go two-up (which does not fit the Recent tab's sentences at this
width), or to accept the trailing space. The panel is shared with the card sections, so the choice
is Samuel's.

### ⚠ CORRECTION to the section above: it was a dev-server cache bug, not Tailwind detection

The root cause recorded above is **WRONG and withdrawn**, including the `@source` port item. The
real behaviour, settled by a cold build (`.next` moved aside, server relaunched on the same
command and port):

- `layout.css` went from 188,645 B to **204,395 B**, and `min-h-[104px]` and `col-span-6` — both
  reported dead above — came **alive**. Detection was never missing these trees.
- A canary added AFTER the cold server booted is in the HTML and **not** in the CSS.

⚠ **RETRACTED 2026-10-24 — the first clause below was WRONG and this is the corrected rule.**
"Present when the dev server boots compiles" is disproved by measurement on the ontology surface:
`mr-2.5` was written at 22:2x, a server booted at 22:49:49, `layout.css` built at 22:50:28 — present
at that boot and **still dead** until the cold rebuild's 00:03 sheet. **Boot timing is not the
variable.** The measured rule: **the warm `.next` carries a stale scan set across restarts, so only
a cold rebuild refreshes it.** A class whose only demander is a new file stays dead; a class some
already-scanned file also demands is live regardless — which is why 24 of 25 utilities in one tree
worked and the 25th did not. Novelty is the symptom the cache produces, not the cause.

**The rule as originally written here, kept so the retraction has something to point at: a Tailwind
class present when the dev server boots compiles; a class added while it
runs never does, and a plain restart does not help because `.next` is reused.** Everything written
tonight was inert, which is why utilities looked "dead" by tree and why a restart changed nothing
(`layout.css` was byte-identical across it).

Consequences worth keeping:

1. **No product change is needed.** No `@source` line, no Tailwind config edit. Previous advice
   here to take that to Samuel is withdrawn.
2. **Verify against a cold build, or use literal CSS.** The `.uis-idp-act-*` rules survived three
   servers unchanged precisely because hand-written CSS in `staging.css` is immune to this. They
   stay as they are — the Tailwind path would now work after a cold build, but a staging surface
   that must be reviewable mid-session should not depend on that.
3. **A mid-session class being absent from the compiled CSS proves nothing about detection.** It is
   the expected result of this bug. Only a cold build can tell the two apart.

Re-measured on the cold build, since previously inert classes elsewhere could have shifted the
layout: Active now 5 rows / 461px / 0 stacked / 40px rows / worst slack 47px; Recent 7 rows /
628px / 0 stacked / worst slack 134px. Unchanged.

⚠ Housekeeping: the old build cache is parked at `.next.bak-000331` (732M) and is safe to delete.

### `staging.css` is GLOBAL to every playground route (@rail-fix, 2026-10-23)

`ui-staging/staging.css` is imported once by `staging-frame.tsx`, and every staged face mounts in
that frame, so **an unscoped rule in it applies to all six `/playground/*` pages**, not just the one
it was written for. Every rule must therefore be `.uis-window`-prefixed and own-prefixed by face.

This block complies: all four of its selectors are `.uis-window .uis-idp-act-*`, verified with
comments stripped (a naive regex over the raw file reports false positives from comment prose).
The `@supports` children are scoped too.

Five selectors elsewhere in that file are top-level and unscoped (`a.lp-demo-top-tab`,
`.lp-demo-top-tab[data-disabled="true"]`, `button.lp-demo-top-profile`,
`button.lp-demo-top-search`, `button.uis-rail-create`, lines 48-73). They are cross-route **within
the playground**, which for the shared top bar is the intent. Not this face's rules.

⚠ **I first wrote that those rules also reach the LANDING page, because `.lp-demo-*` is
`marketing.css`'s namespace and renders in `banner-demo/`. THAT WAS WRONG** (corrected by
@rail-fix, measured 2026-10-23). The app router emits CSS per route; `staging.css` is imported only
by `staging-frame.tsx`, so it ships in the playground routes' sheets and nowhere else. The landing
route loads `app/layout.css` + `app/page.css`, and those contain **zero** occurrences of
`uis-window`, `uis-rail-create`, `a.lp-demo-top-tab`, `uis-idp-act` or `uis-ap-host`; its
`.lp-demo-top-tab` rules come from `marketing.css` alone. Nobody should "fix" the landing page over
this.

🔒 **The lesson, which is the same one twice:** a selector's presence in a source file says nothing
about which page it styles — only the shipped bundle does. That is the inverse of the mistake that
caused the stacking bug (a class in the HTML saying nothing about whether a rule was emitted), and
I made both. **Read the bundle the route actually loads, not the file the rule lives in.**

## Item 8 — Activity as a right rail (2026-10-24)

Samuel: *"put the activity as a panel on the right side… three-fourths of the identities page on
the left side, and then another quarter's on the right side"*, and *"each agent that's working
should have some sort of box that's probably white… It doesn't need to be so long. It doesn't
really need to say what channel it's in"*.

| Piece | File | What changed |
|---|---|---|
| Layout | `home/identity-panels.tsx` | `.uis-idp-layout` (size container) › `.uis-idp-cols` › `.uis-idp-main` (head, controls, Shared, Personal, unchanged) + `<aside class="uis-idp-aside">` (Activity). Dialogs sit outside the columns. |
| Layout CSS | `ui-staging/staging.css › THE IDENTITIES PAGE RAIL` | `@container (min-width: 760px)`: `grid-template-columns: minmax(0, 3fr) minmax(0, 1fr)`, each column `overflow-y: auto`. Below 760px of PANE it is one column (rail after the identities) and the pane scrolls. Replaces item 7's `.uis-idp-act-*` grid entirely. ⚠ A container query styles descendants only, so the container (`-layout`) and the switching box (`-cols`) are two elements; the first version used one and stayed a column. |
| Run card | `page/identity-activity-panel.tsx › RunCard`, `.uis-idp-run` | One per running agent. White, 1px `--border-default`, 12px, the §2 message-card shadow. Line 1: `IdentityFace` (owner photo, runtime badge, agent-colour ring from `agentColorKey`) + name (600) + elapsed time (muted). Line 2: status pill (white on hairline, dot + word, green dot only when working) + the thread title (muted, truncates with `title`). |
| Dropped | same | The channel (Samuel's lean; the thread is the better "what"), the context meter, token footer and pill button of the full §4 recipe, and the STATE filter (every card states its state; working sorts first). The owner filter ("Just mine") stays as the panel's header control; the tabs moved under the heading. |
| Recent | same, `.uis-idp-feed-row` | Rows, not cards (the 3c rule). Two lines: the sentence (clamped to 2), then identity name + when; the permission chip below when not `auto`. |
| Grid 4 → 3 | `agent-identities/components/identity-section.tsx › IDENTITY_GRID` | ⚠ **Samuel's call to confirm.** Four across the 3/4 column measured 173px per card with every name truncated; three measure 234px, the width four had before the rail. Still fixed, not auto-fill. The skeleton ghost now imports the staging grid (`section-panel-ghost.tsx`, its one deviation from verbatim) and `home-skeleton.tsx` mirrors the two-column frame. |
| Avatar fallback | `IdentityFace` | No runtime, no badge; the ring stays the agent's colour. In the product the session knows its runtime and colour key; `agentColorKey` is staging only. |

### Measured (built-in browser, 1440×900 viewport, staging pane 1020px, 2026-10-24)

- Columns 765px | 255px (0.750 / 0.250). No horizontal overflow in the columns or the rail.
- Main column scrolls on its own (1202 / 756px); the rail does not move with it.
- Run cards 211px wide, 77px tall; name track 118–125px; all five fixture names untruncated
  (the pill on line 1 left 62px and truncated four, which is why it moved to line 2). One thread
  ("Device token expiry") truncates by a few px, with a `title`.
- Pane forced to 700px: one column, rail 12px below the identities, pane scrolls.
- Pre-existing, not from this change: two grid-card names ("Release Captain", "Postmortem Writer")
  truncate by ~8px beside the worn-by face stack; they did at the old 235px card width too.

### To port

Kit recipes for the rail layout and the run card in BOTH CSS copies (`globals.css` + desktop
`kit.css`), the desktop `pages/home/identity-panels.tsx` split into two columns, and a real
session colour slot + runtime on each active row.


## Item 9 — all white, title chips instead of wells (2026-10-24)

Samuel: *"make the entire panel… white… remove the gray from the 'Shared across your channels'
and 'Personal' lines… no more gray backgrounding… just have it be a gray box behind just that
text"*.

| Piece | Where | What |
|---|---|---|
| White pane | `ui-staging/staging.css › ITEM 9`, `.uis-idp-layout` | `background: #ffffff` (was the record's `rgb(251,252,252)`). |
| No wells | same, `.uis-idp-layout [data-section-panel]` | `bg-home-panel` well, 12px padding and border neutralised for Shared, Personal and Activity (and the skeleton ghosts, which carry the same attribute). Kit untouched: hooked on `SectionPanel`'s own `data-section-panel`, scoped to this page. Wins because `staging.css` is unlayered and Tailwind utilities are layered. |
| Title chip | same, `> div:first-child > h2` | `#f5f5f5` (DESIGN-LANGUAGE §2 well), 8px radius, `3px 10px` padding on the h2, which is already content-width as a flex item. Header row's `px-1` removed so the chip and the cards share one left edge. Caption and "+ Agent Identity" unchanged. |
| Rhythm | same + `home/identity-panels.tsx` | Column gap 12 → 28px between sections; the page head and grid controls are wrapped as one 12px group so they stay together. |

Measured (1440×900, 2026-10-24): pane white; all three panels transparent; chips 269 / 96 / 83px
around 249 / 76 / 63px of text (20px padding, nothing more); chip left edge = card left edge;
create button vertically centred on its chip; columns still 765 | 255, no horizontal overflow.
⚠ The CSS edit did not hot-swap in the running dev server; a page reload picked it up.

To port: a "flat" `SectionPanel` variant and a title-chip recipe in the kit (both CSS copies), not
these overrides.
