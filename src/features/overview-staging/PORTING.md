# Overview staging — porting map

`/overview` stages desktop **/home → Overview** at the **`devices-dashboard-mock` branch** version
(968aba4f8, not merged to master), on fake data, inside the shared UI-staging frame
(`src/features/ui-staging/staging-frame.tsx`). Edit the files below on the web with HMR, then port
the changes back to the desktop file named beside each.

Every copied file starts with a `STAGING COPY of …` line. Only import paths differ from the source:
desktop `#/…` modules point at the staging copies here, and data hooks point at `./stubs`.
When porting back, keep the desktop imports and carry over only markup/class/copy changes.

## Copied UI (port these back)

| Staging file | Desktop source | Version |
|---|---|---|
| `pages/home/overview-panels.tsx` | `apps/desktop-ui/src/pages/home/overview-panels.tsx` | **branch** |
| `pages/home/devices-mock/devices-overview.tsx` | `apps/desktop-ui/src/pages/home/devices-mock/devices-overview.tsx` | **branch** (new file there), **REDESIGNED 2026-10-22** |
| `pages/home/devices-mock/devices-reach.tsx` | `apps/desktop-ui/src/pages/home/devices-mock/devices-reach.tsx` | **staging-new 2026-10-22** (no desktop file yet) |
| `pages/home/devices-mock/devices-host-card.tsx` | `apps/desktop-ui/src/pages/home/devices-mock/devices-host-card.tsx` | **staging-new 2026-10-22** (no desktop file yet) |
| `pages/home/devices-mock/devices-activity.tsx` | `apps/desktop-ui/src/pages/home/devices-mock/devices-activity.tsx` | **branch** (new file there), **REDESIGNED 2026-10-22** |
| `pages/home/devices-mock/devices-ui.ts` | `apps/desktop-ui/src/pages/home/devices-mock/devices-ui.ts` | **branch** (new file there), **REDESIGNED 2026-10-22** |
| `pages/home/overview-sections.tsx` | `apps/desktop-ui/src/pages/home/overview-sections.tsx` | master (= branch) |
| `pages/home/overview-token-spend.tsx` | `apps/desktop-ui/src/pages/home/overview-token-spend.tsx` | master (= branch) |
| `pages/home/overview-usage-filter.tsx` | `apps/desktop-ui/src/pages/home/overview-usage-filter.tsx` | master (= branch) |
| `pages/home/panel-buttons.tsx` | `apps/desktop-ui/src/pages/home/panel-buttons.tsx` | master (= branch) |
| `components/overview/rank-rail.tsx` | `apps/desktop-ui/src/components/overview/rank-rail.tsx` | master (= branch) |
| `components/overview/token-spend-strip.tsx` | `apps/desktop-ui/src/components/overview/token-spend-strip.tsx` | master (= branch) |
| `components/charts/bar-series.tsx` | `apps/desktop-ui/src/components/charts/bar-series.tsx` | master (= branch) |

### The Devices section's redesign (2026-10-22, Samuel's ask 4) — what to carry back

The Devices section was rebuilt on `docs/DESIGN-LANGUAGE.md`. Samuel, verbatim: *"we should lean
away from the gray background with the header on the gray background and then different panels on
top … all the fonts and everything just look really bad."* What changed, and what each change
needs on the desktop side:

| Change | Port note |
|---|---|
| **The section is no longer a `SectionPanel`.** It is a `<section>` with a header row closed by a `border-b border-border-subtle`, then white cards straight on the pane. No grey ground, no heading on grey, no panels-on-top. | Markup only. `overview-panels.tsx` already renders it as a bare child, so the desktop needs no change there. Its SIBLINGS (Usage, Token spend, All channels) are still grey `SectionPanel`s — if Samuel approves this face, they follow in a second pass. |
| **White card fill.** `.bento`'s `--panel-surface` (#fbfcfd) is 1/255 from the record pane's `--home-card` (#fbfcfc), so a `.bento` on this pane reads as nothing. The cards wear `staging.css › .uis-dev-card`: `#ffffff` + the landing's two-layer thread-card shadow. | ⚠ **THE SECTION'S ONE LITERAL, AND IT IS DELIBERATELY IN ONE PLACE.** Port as a WHITE VARIANT of `globals.css › .bento` mirrored into `apps/desktop-ui/src/styles/kit.css` (`scripts/check-css-token-drift.ts` compares the two class sets), then swap `DEV_CARD` to it. Do not inline `#ffffff` at a call site. |
| **One Reach card leads** (`devices-reach.tsx`): three `text-stat` figures (devices online / agents running / routed today) over the fallback chain drawn as inked-first device tiles. It replaces the old Routing card's grey well, its numbered pills and the two explanatory paragraphs; the 30-second rule survives as one caption line. | New file. Needs `SECTION_HEADING_TEXT` + the `devices-ui.ts` faces only. |
| **Flat host cards** (`devices-host-card.tsx`): the `grid-cols-2` pair of `bg-bg-inset` wells per host is gone. Agents and connected devices are labelled GROUPS under `DEV_GROUP_LABEL` headings, divided by hairlines. | New file. Pure markup. |
| **Routing + Logs merged into one Activity card** with a `SegmentedControl variant="underline"`. They were two renderings of the same timestamped feed. Tab labels stay **Routing** and **Logs** (Samuel's nouns). | `devices-activity.tsx` exports `ActivityCard` now, not `RoutingCard` + `LogsCard`. |
| **Typography.** `text-label` (11px, the scale's uppercase-label role) replaces hand-composed `text-micro font-semibold uppercase`; `text-stat` arrives on the Overview for the first time; log rows moved off all-`text-caption` onto the routing feed's clock/title/meta hierarchy; one timestamp face (`DEV_TIME`) for both feeds. | All in `devices-ui.ts` as named constants — read by import, never retyped (`docs/DESIGN-SYSTEM.md`'s F-345 rule). |
| **Kit primitives replace hand-rolled controls.** Native `<select>` → `SelectMenu variant="flat"`; a hand-rolled `rounded-full` level track → `SegmentedControl`; bare bordered inputs → `.concave-field`; the red "Remove computer" footer button → a `NAKED_ICON_BUTTON` X on the host header row (Samuel's 2026-09-12 naked-icon ruling, which this section was not honouring while its own endpoint rows already wore one). | All four are already shared/`globals.css`, so the desktop gets them by import. |
| **`DeviceGlyph` by import.** The local `Glyph` duplicated `@/features/devices/components/device-glyph › DeviceGlyph` exactly (its `computer` special-case is already `DeviceKindIcon`'s `ICONS.computer`). Deleted. | Import, do not re-declare. |
| **`Map<string, string>` → `Map<string, DeviceRef>`** (`devices-ui.ts`): name **plus kind and status**, because the chain could not say WHY a question fell through with only a name. `deviceRef()` resolves a removed device to a named offline row. | `DeviceRef`/`deviceRef` live in `devices-ui.ts` on purpose: the reach card and the activity card both need them, so either component owning it makes the two import each other. |

**Five files, not one:** the redesign took the section past the repo's 500-line `max-lines` lint
cap, so each card owns a file and `devices-overview.tsx` keeps the state, the header and the
Add-device chooser. Every shared face is `devices-ui.ts`; every shared component is
`devices-bits.tsx`.

### Round 4b (same day) — bento grid + components instead of text

Samuel's two faults with round 4a: *"All these panels are really long. Their width is the full
length. I think it should look almost more like a bento"* and *"there's so much gray text or so
much text in different font stylings … A lot of this is just straight pure text and lines of text
… It's too much reading."*

| Change | Port note |
|---|---|
| **A six-column bento grid** replaces the single `flex-col`. Row 1 = three stat tiles at `col-span-2`; row 2 = Reach at `col-span-6` but one row of tiles tall; row 3 = one computer per `col-span-3`, two side by side; row 4 = Activity at `col-span-6`. **Nothing is both full-width and long any more.** `col-span-3` also means an odd host count degrades correctly (the third takes the next row's left half, it does not stretch). | Markup only, in `devices-overview.tsx`. |
| **`devices-bits.tsx` — NEW, the section's components.** `Chip` (tones `neutral`/`ink`/`quiet`, `mono`), `StatusChip`, `MiniGlyph`, `Meter`, `Pips`, `SplitBar`, `StatTile`, `HopChain`. Each one replaces a run of dot-separated grey text; the file's docblock carries the was/is table. | New file. Nothing in it is a literal — faces come from `devices-ui.ts`, colours from tokens. If these earn their keep, `Chip` / `StatusChip` / `Meter` are the three worth promoting to `src/shared/ui`. |
| **Every `·`-joined string is gone.** `"MacBook Pro 14 · Dopl 1.42.0 · Claude, Codex, Grok"` → model prose + a mono version chip + one chip per runtime. `"Working · Dopl · Claude · 3h 4m"` → state dot + channel chip + runtime chip + mono duration. `"64% battery"` → `<Meter>`. `"Online"` + a second line `"Seen now"` → one `<StatusChip status seen>`. | Markup. ⚠ The endpoint's `model` was nearly dropped and is kept as a `quiet` chip on purpose: `"Dopl web"` alone says nothing, `"Chrome on Studio Mac"` says where it runs. Losing a fact is not simplification. |
| **Routing lost a sentence per row, and the sentence was redundant.** Every `why` in the mock (*"Glasses didn't answer in 30 seconds, so it moved to your phone"*) narrates `tried` + `landedOn`. `<HopChain>` draws it: ✕ on each device tried, ✓ chip on the one that answered. Rows went from three lines to one. | ⚠ **CHECK THIS AGAINST REAL DATA BEFORE PORTING.** It holds because the mock's `why` is derivable from `tried`. If the live payload's `why` ever carries a reason the hops do not imply (a permission denial, a crash), the sentence has to come back — as a chip or an icon, not a line. |
| **Reach lost all three of its prose runs.** The two paragraphs and the numbered pills became: the chain's own left-to-right order, a `Goes here now` chip on the inked first tile, a `30s` chip ON each connector (the wait is a property of the hop), and a `Fallback` chip on the last tile. | Markup, in `devices-reach.tsx`. |
| **Log rows are one line**: severity dot, clock, device chip, event, muted detail on the right. Was two lines in a 5-column all-`text-caption` grid. | Markup. |
| **Six type faces cut to five, one role each** (`devices-ui.ts` docblock): `DEV_LABEL` 11px uppercase, `IDENTITY_NAME_TEXT` 14px, `DEV_ROW` 12.5px, `DEV_MONO` 10.5px mono, `DEV_STAT` 26px mono. `DEV_PROSE` (11.5px) survives with four callers, **all of them prose a human wrote** — a FACT never wears it, it wears a chip. The old names (`DEV_GROUP_LABEL`, `DEV_TIME`, `DEV_ROW_TITLE`, `DEV_ROW_META`, `DEV_CHIP`) are kept as `@deprecated` aliases so a half-ported call site is visible. | Delete the aliases once the desktop side is ported. |
| **Stat tiles are derived, never literal.** `tally` in `devices-overview.tsx` computes devices/online, agents/working and routes/direct from the data, and each tile pairs its figure with the total its picture needs. `direct` (routes that landed first try) makes "Routed today" a quality figure rather than a volume one. | Carry the `tally` memo across; do not hardcode. |

Grayscale held throughout: fills are `--bg-inset` / `--surface-cta`, and the severity ramp appears
only as a 6px status dot (`DESIGN-LANGUAGE.md` §5, "Green only for live/online").

### Round 4c (same day) — kill the white space, un-pill the components

Samuel rejected 4b on two counts: *"Devices Online, Agent's Running: … there are only a few lines
of text on the left. The entire 80% of the right side is just blank white space"* and *"what the
agent did was just do a bunch of pills … all it did was just change types into pills, which is not
helpful whatsoever."* Quality bar named: the identity cards
(`identities-staging/agent-identities/components/identity-section.tsx`). **Read that file's
`IdentityCard` docblock before porting this** — its question-answer table and its three-step type
ladder are the model this round follows.

**1. The white space was structural, not cosmetic.**

| Change | Port note |
|---|---|
| **The three stat tiles are DELETED**, and with them `StatTile`, `Pips`, `SplitBar` and the `DEV_STAT` 26px face. A 26px figure needs a card; a card that size needs content three numbers do not have. Padding it would have been the patch. | ⚠ Do not reintroduce a stat card. The figures live in header rows now. |
| **The figures moved into header rows**, as `Figure` (14px mono value + 11px uppercase unit): `2/5 online · 4 agents · 5 routed` in the section header, `3/5 answered first try` in the Activity header. Each header row was previously a title on the left, a control on the right and a gap between; the figure strip is `flex-1 justify-end`, so it absorbs the slack. **One change fixed the blank cards and the blank header rows.** | Markup. `tally` in `devices-overview.tsx` still derives every figure. |
| **12-column grid** (was 6), so a span can be something other than a half or a third. Reach `col-span-12` (one tile-row tall), hosts `col-span-6` (~440px, what a `name + qualifier + mark + duration` row actually needs), Activity `col-span-12`. `items-start` so a short card never stretches to a tall neighbour. | ⚠ Host width is load-bearing: narrower than ~440px and the agent rows wrap, which is the other way a grid manufactures white space. |
| **Reach lost its header row.** A label alone above three tiles is a line with one word on it. The label is the band's first COLUMN now (`w-14`, self-centered), chain `flex-1` beside it. | Markup. |
| **Each reach tile earns its width**: glyph, name, state, and the POSITION figure right-aligned (`1 now` / `2 then` / `3 last`). The right-aligned figure is what removes the blank right edge, and it is the tile's own index, not padding. | Markup. |

**2. Pills are not a design system.** The question per fact became *what kind of thing is this
fact*, with a different element per answer — the table is in `devices-bits.tsx`'s docblock. **On-screen
chip count went from about 30 to 1** (two with an endpoint in use).

| 4b chip | 4c element |
|---|---|
| `● Online · now` | `Dot` — dot + word + stamp, no box. The identity card's own bottom line. |
| `This computer` | uppercase `DEV_LABEL` beside the name: a qualifier, not a fact with a box |
| `1.42.0` | folded into the subtitle, `"MacBook Pro 14 · Dopl 1.42.0"`. ⚠ Two related facts in one subtitle is a legible line; four crammed facts was the 4b problem, not the dot separator itself. |
| `Claude` `Codex` `Grok` on the host header | **deleted.** A host's runtime LIST is capability metadata the editor owns. The runtime that matters is the one an agent is using, and that is a 14px logo on the agent's own row (`RuntimeMark`). |
| `Dopl` per agent | small muted type after the name |
| `Claude` per agent | `RuntimeMark` — the brand's own logo, 14px, falling back to its NAME when there is none (never a generic glyph: a wrong mark is worse than no mark) |
| `Agents 3` / `Connected devices 2` counts | **deleted.** The rows are visible; counting them is the reader's eye. |
| routing `Question` chip | `KindMark` — an icon per kind. Four categories read faster as four shapes than as four same-shaped pills, and it was five identical outlines down the left edge. |
| routing `from` chip, log device chip | muted type — they are qualifiers on the line beside them |
| HopChain's inked landing chip | glyph + name in ink type. Five filled black pills down the right edge were competing with the one claim on the page that should be filled. |
| `In use` | **kept, the only chip left**, and it now takes the same dot every other state wears, so the state language is one language whether or not the fact needed a box. |

`Chip`'s geometry is copied from `identity-section.tsx › IDENTITY_ROW` (h-6/h-5, hairline,
near-white well, 7px radius, 14px mark then text, natural width) — **copied, not imported**,
because that file is another worker's and carries in-flight edits. ⚠ Port target: ONE recipe in
`src/shared/ui` once both rounds land, with `Dot`, `Figure` and `Meter` the other three worth
promoting.

**Also 4c:** `RUNTIME_LOGOS` duplicated into `devices-ui.ts` from `identities-staging/data.ts` for
the same reason, and staging-only in both — in the product it comes off the runtime registry beside
`RuntimeDescriptor.label`, which carries no logo yet. Rename buttons are hover-revealed
(`group-hover//name`, `focus-visible` for keyboard) because one beside every name was itself clutter.
Four type faces left, one role each; `DEV_PROSE` has four callers and **all of them are prose a
human wrote** — a fact never wears it.

`overview-panels.tsx` and `devices-overview.tsx` are shared with the workspace Overview page in
places: `rank-rail.tsx`, `token-spend-strip.tsx` and `bar-series.tsx` are also drawn by
`apps/desktop-ui/src/pages/overview/*`, so a change to them moves that page too.

### Round 4d (same day) — drop the boxes, use the components that already exist

Samuel rejected 4c on two counts, and the second one is the important one.

**1. *"the bento is not the right route. I think having so many boxes just makes it look really
busy and weird… it should just be a section header or something like that, and then something that
clearly shows what element is in what."***

The twelve-column grid is gone, and so is the white card under every block. The section is ONE
COLUMN of labelled blocks on the open page:

| Was | Now |
|---|---|
| `ReachCard`, a card | `ReachBlock` — the label is the band's first column, the connectors already draw it as a chain, so it needs no frame |
| `HostCard` × N, half-width cards in a 12-col grid | `HostBlock` × N, full width, each opened by a hairline with its name as the header and two labelled groups under it |
| `ActivityCard`, a card | `ActivityBlock` — a header row closed by a hairline, then the feed |
| 4 permanent boxes + a stat-tile row before that | **ZERO permanent boxes.** `.uis-dev-card` has ONE caller left: the Add-device chooser, where the box IS the boundary (a transient panel over the page) |

What carries the structure instead: a hairline opens each block; the block's label or its name is
the header; inside a host, two quiet uppercase labels over row lists; row lists carry hairline
dividers, so a list reads as a list without a frame. Full-width hosts are a gain — at half width a
row had ~440px and name + qualifier + mark + duration only just fit.

**2. *"for the orchestrator devices dashboard mock, that little view with the agents, it should
show the profile of the user and have the agent icon. We have that as a set UI component. I don't
understand why the agent is not using this stuff… We have specific displays of this stuff."***

He is right, and it went further than the agent rows. The inventory, and what replaced what:

| Hand-rolled before 4d | The component that already existed | Where |
|---|---|---|
| an agent `<li>`: dot + name + channel + runtime mark + duration, built by hand | **`SettingsRow`** (leading / title / badge / meta / trailing) | `shared/layout/settings-modal/sections/settings-panel.tsx` |
| the agent row's lead: nothing, then a bare state dot | **the identity face: owner photo + runtime badge**, `DESIGN-LANGUAGE.md` §3's component | `identities-staging/identity-avatar.tsx` (the greyscale fork of `onboarding/components/paired-avatar.tsx › PairedAvatar`) |
| an endpoint `<li>`, a two-level layout by hand | **`SettingsRow`**, same four slots | as above |
| `EditableName`, ~40 lines of click-to-rename with its own input | **`DeviceNameTitle`** — the product's own device rename control | `features/devices/components/device-name-title.tsx` |
| a red text button / bare `NAKED_ICON_BUTTON` for remove | **`RowAction danger`** | `settings-panel.tsx` |
| the agent row's state: a `bg-success` / `bg-text-disabled` span written here | **`AgentLiveness`** — the product's four-tone dot-and-word, *"deliberately not a bordered pill"*, which is the same call `devices-bits.tsx › Dot` reached independently for DEVICE status. An agent's state is an agent fact, so it wears the agent component | `features/channels/components/agent-bits.tsx` |
| `.concave-field` on the rename input and the pairing code | **`wells.ts › RAISED_INPUT`** | ⚠ see the gate note below |
| hairline dividers written per list | the `divide-y divide-border-subtle` pattern `SettingsRows` uses (without its `.bento`, which is the box this round removes) | `settings-panel.tsx` |

⚠ **IT ALSO FIXED A GATE VIOLATION NOBODY HAD NOTICED.** `.concave-field` is BANNED on /home and
swept by `agent-identities/components/identity-editor-surface.test.tsx`, which reads every `.tsx`
under `apps/desktop-ui/src/pages/home/`. This section lives under there, and three of its inputs
were concave. The day the `devices-dashboard-mock` branch merged, that gate would have gone red.
`DeviceNameTitle` (which wears `UNDERLINE_FIELD`) and `RAISED_INPUT` both satisfy it.

**Hand-rolls that remain, each justified:**

| Still hand-rolled | Why no component |
|---|---|
| `devices-ui.ts › ago` / `duration` | The product component is `shared/lib/format-time.ts › formatRelativeTime` and it IS the port target. It takes an ISO string and reads `Date.now()`; this section is server-rendered against a FIXED staged clock, so an SSR label and a client label can differ and React throws a hydration mismatch. Both local helpers are pure functions of a constant. Drop them when the section reads real devices, and call `formatRelativeTime` client-side. |
| `devices-bits.tsx › Dot`, `Chip`, `Meter`, `MiniGlyph`, `KindMark`, `HopTrail`, `Figure` | Checked against `shared/ui` and the product's displays: there is no status-dot, no small fact chip, no inline meter at this scale (`usage-meter.tsx` is the billing bar, a `.concave-track`, banned here), and nothing that draws a fallback chain. These are the section's own vocabulary. ⚠ `Chip`'s geometry is copied from `identities-staging/.../identity-section.tsx › IDENTITY_ROW`; the port target is ONE chip recipe in `src/shared/ui` once both rounds land. |
| the host's own header line | `SettingsRow` is an `<li>`, and a host is the thing its lists hang off rather than a member of one. It mirrors `features/devices/components/computer-row.tsx › ComputerRow` — the product's own computer row — slot for slot (glyph, `DeviceNameTitle`, meta, remove), so the port is a swap rather than a rewrite. |

⚠ **The agent rows' owner is the VIEWER, and that is correct rather than a shortcut**: these
agents run on the viewer's own computers. `MockAgent` carries no owner field; if the product ever
shows someone else's host, the row needs one.

## Version D (whole page), 2026-10-23, round 2: restructured

Round 1 was rejected: *"The D still looks the same … Everything still looks the same."* It kept
Current's information architecture (Devices, Activity, Usage, All channels, same order, same
arrangement) and only reskinned it. Samuel: *"fully restructure Version D: new layout and
hierarchy, decide what the page leads with, cut sections that don't matter, styled like the
landing page mockups."* Round 2 rewrote `pages/home/overview-d/` from scratch.

**Switch:** staging toolbar, **Version** → `Current` / `Version D` (`stubs/staging-state.tsx ›
StagingFace`, default `current`). Current's components are unchanged; the only edit to them is
`devices-overview.tsx › AddDeviceChooser` gaining an `export`.

**What it leads with.** A person opening Home needs three answers: what is running, what is
waiting on me, and am I about to run out. The first two lead, so the page opens on ONE hero card:

| Order | Block | Shape | What is in it |
|---|---|---|---|
| 1 | **Right now** (hero) | full width, the biggest card, the Monitoring log's deeper shadow and 22px padding | three 34px figures (Working, Need you in amber, Devices online), then two columns: **Agents** as Monitoring-log rows (30px `PairedAvatar thinFrame`, name + run time, channel · computer, tinted pill: green `Working`, amber `Waiting for you`) and **Needs you** as notification cards with Approve / Deny / Answer. Out of credits becomes a needs-you card here too |
| 2 | **Spend** | small card | credits figure, 3px meter, left + reset, the month's daily bars filling the card, `At least N` tokens over 31 days |
| 2 | **Devices** | small card, the widest of the three | every device on one line: glyph, name, "Through <computer>" (or function chips for the one answering), dot + word |
| 2 | **Top channels** | small card | five channels by credits, each with a 3px meter |
| 3 | **Activity** | full width | the Monitoring log on the devices feed: Live dot, filter chips per device (inked when on), four rows, `Warning` / `Error` pills |

No section headers at all: every block titles itself, so there is no heading-over-cards layer.

**Cut, and why** (each is still in Current):

| Cut | Why it is not at-a-glance |
|---|---|
| Messages by channel | a volume figure over the same rows as credits; credits is the one that costs money |
| Credit usage by person | a team audit; on a personal Home the viewer is nearly every row |
| Top MCP tools | a diagnostic, for someone debugging traffic |
| Usage scope menu + month stepper | browsing history; the overview is this month |
| Reach order band | the device that answers right now is marked `Answering` on its own row |
| Routing tab | Routing and Logs were two feeds of the same events; one log with device filters |
| Per-computer agent lists (D · Cards) | agents moved UP into the hero, where "what is running" is answered for every computer at once; devices became one list |
| Host spec, app version, battery | facts about hardware, not about work |
| Rename / remove on devices | management belongs in Settings, not the overview |

**Landing recipes used** (`marketing.css`): `.lp-ctl-card` (hero shadow, padding), `.lp-ctl-log-*`
(row height, face size, name/time/did type, tinted pills, Live dot, filter chips),
`.lp-ont-notif` (needs-you cards), `.lp-demo-tc-btn` (pill buttons), `.lp-demo-ac-track` (3px
meter). ⚠ The landing's grey chip fill (`#f1f1f0`) became a hairline here, under the Overview
grey ban.

**Files:** `overview-d.tsx` (shell, reads, hierarchy), `overview-d-hero.tsx`,
`overview-d-cards.tsx` (Spend, Devices, Top channels), `overview-d-activity.tsx`,
`overview-d-bits.tsx`, `overview-d-data.ts` (derivations + the invented asks),
`overview-d.css` (every literal, plain scoped CSS under `.ovd`), `overview-d.test.tsx`.

**How it ports.** The hero is a new Home component fed by the session list (agents) and the
approvals queue / open decisions (asks); the support cards read the existing overview, series,
token-spend and billing payloads unchanged. `.ovd-card` / `.ovd-hero` become the white `.bento`
variant(s) in globals.css + `kit.css`; the log row, tinted pill, notification and filter chip are
the four recipes worth promoting to `src/shared/ui`. `--ovd-*` map to tokens; the tinted pill's
green/amber pairs need new tokens (none exist).

⚠ **Invented for D, staging only:** `overview-d-data.ts › NEEDS`, the two open asks (lifted from
mock events `l8` and `r5` and held open); function chips for phone/watch/web; the single agent
ring colour (slot 11); the tinted pill colours (copied from the landing's log, not tokens).

## Version E (whole page, from scratch), 2026-10-26

Samuel: *"completely redesign the overview page from scratch so we can make a new tab and call it
E … it should not copy any of the UI. I like the way that it has been doing the UI stuff for the
task."* Toolbar **Version** → `Version E` (`stubs/staging-state.tsx › StagingFace` gained `"e"`).
No Current or D component is imported or copied; E reads the SAME stubs and fixtures (and D's
`NEEDS`, the two invented asks, re-exported as DATA from `overview-d-data.ts`). Look: the channel
tasks recipe (`channels-staging`, `ui-staging/staging.css › .uis-tk*`): white cards, hairlines
between rows, `--shadow-bento`, caption-scale meta, tokens only, under the Overview grey ban.

| Order | Block | What is in it |
|---|---|---|
| 1 | Summary strip (one card, hairline-split cells) | Working n / running, Need you, Devices online n / total, Credits left n / limit + 3px meter |
| 2 · main | Needs you | out-of-credits row (plan exhausted) + D's asks with Approve / Deny / Answer |
| 2 · main | Agents | per computer: name, This computer, status; each agent: runtime logo, name, channel · runtime, run time, Working / Waiting for you |
| 2 · main | Activity | `Routing` / `Logs` tabs; routing: time, summary, kind + from (why on hover), hops ✕/✓, "n/5 first try"; logs: level dot, time, event, device · detail |
| 2 · side | Credits | used of limit, meter, left, resets, Unreconciled / Unmetered, paused note, Get more credits (unpaid); then scope picker, month stepper, total, daily bars, clipped note |
| 2 · side | Tokens | at least N, sessions, 31-day bars |
| 2 · side | Devices | online count, Add device (kind → pairing code), reach order chain with 30s waits, every device: model (+ through host), In use, battery, status + last seen |
| 3 | Channels | one table: channel (Untitled fallback), credits with meter, messages |
| 4 | People · MCP tools | name (Unknown member), role, credits · tool.op, calls; then "From the newest N events." |

States: loading = `overview-e-skeleton.tsx` (same frame, ghost lines); empty = in-card empty wells;
error = message + Try again; plans from `useWorkspaceEntitlements`. Agents, Needs, Devices,
Activity follow the Devices preview gate as in Current and D.

**Files:** `pages/home/overview-e/overview-e.tsx` (shell, reads, order), `-now.tsx`, `-usage.tsx`,
`-devices.tsx`, `-ledger.tsx`, `-bits.tsx`, `-skeleton.tsx`, `-data.ts`, `overview-e.css` +
`overview-e-parts.css` (plain scoped CSS under `.ove`), `overview-e.test.tsx`. **Port:** the reads
are unchanged; `.ove-card` is the white `.bento` variant D also needs; the summary strip, the
row recipe and the scope picker are the pieces worth promoting.

## Imported, not copied (already shared web code; edit in place, both apps get it)

`@/shared/ui/section-panel`, `@/shared/ui/section-heading`, `@/shared/ui/usage-meter`,
`@/shared/ui/select-menu`, `@/shared/ui/naked-icon-button`, `@/shared/ui/page-action-button`,
`@/shared/ui/skeleton`, `@/features/devices/components/device-glyph`,
`@/shared/layout/settings-modal/settings-modal-core`.

## Settings modal (moved out)

"Get more credits" opens `@/features/settings-staging/staging-settings-modal › StagingSettingsModal`, the
full seven-pane staged modal (2026-10-22). Its copies and porting map live in
`src/features/settings-staging/PORTING.md`; the Billing-only partial copy that stood in
`components/settings-modal/` here is deleted.

## Stubs and staging-only files (do NOT port)

| Staging file | Stands in for |
|---|---|
| `stubs/use-api-query.ts` | `apps/desktop-ui/src/hooks/use-api-query.ts › useApiQuery` (same call shape; answers from the data file) |
| `stubs/use-workspace-entitlements.ts` | `@/features/billing/components/use-workspace-entitlements › useWorkspaceEntitlements` |
| `stubs/use-home-channels.ts` | `apps/desktop-ui/src/pages/home/use-home-channels.ts › useHomeChannels` |
| `stubs/home-settings-control.ts` | `apps/desktop-ui/src/pages/home/home-settings-control.tsx › openHomeSettings` |
| `stubs/page-states.tsx` | `apps/desktop-ui/src/components/page-states.tsx › PageError` |
| `stubs/staging-state.tsx` | nothing — the staging toolbar's state |
| `overview-mock-data.ts` | every API payload. The Devices block is the branch's `devices-mock/devices-mock-data.ts`, verbatim |
| `overview-staging-page.tsx` | `apps/desktop-ui/src/pages/home/home-panes.tsx › HomePane` Overview branch + the staging toolbar |
| `overview-staging-page.test.tsx` | render smoke test (no network, every flow opens) |
| `src/app/overview/page.tsx` | the route |

### Round 4e (2026-10-22) — the Blank Space Rule, swept

`Plans/UI Standing Rules` Rule 1 is now standing law, and Samuel re-flagged this page under it:
*"I'm still seeing this issue where you have these giant long overly long bars… It just ends up
being a ton of empty space… Look at all that blank space in the middle."* Four offenders, all of
them created by a flex/grid default rather than by a decision:

| Offender | Fix | Rule 1 remedy used |
|---|---|---|
| Each host block ran the FULL pane after 4d de-boxed it. At ~1000px an agent row was a 22px face, a name, a short meta line, then ~600px of nothing before "Working · 3h 4m". | Two hosts side by side (`grid-cols-2 items-start`), so every row inside is ~480px — what `name + meta + state + duration` actually fills. ⚠ **Columns are not boxes**: the host blocks still carry no frame and no fill, so the 4d ruling stands. | §3 "more columns/items side by side" |
| The Reach band's `<ol>` was `flex-1` with `flex-1` tiles, so three devices stretched across the pane and each tile held a glyph, a short name and two words in ~300px. | `w-fit` band, `flex-none` tiles with a `max-w-[13rem]` ceiling. The band is as wide as the chain it draws; the page carries the rest. | §1 "width is earned by content" |
| The Logs search was `flex-1` — a ~700px field holding a 12-character placeholder. | `w-52`. | §1 |
| The Activity header's `Figure` was `flex-1`, which made its box 600px with the number pinned to its left edge. | Figure at natural width, title + figure clustered left, the tab strip `ml-auto` on the right. Content at both ends rather than one side and air. | §3 "leading/trailing with purpose" |

**What was checked and deliberately left stretched:** the routing and log rows' `summary` / `detail`
spans are `flex-1 truncate`, and that is the legitimate case — prose fills the middle of its own
row, which is exactly what Rule 1 asks for. The section header's figure strip (`justify-end`) was
4c's approved answer to the same problem and is unchanged.

### The grey ban, and the one exception (ruling, 2026-10-22)

Item 7 banned `--bg-inset` (`#f1f1f1`) from these pages: Samuel, *"I don't like that gray color. I
actually want to not use that gray color at all. That's what you see in the background of the
search identities button."*

🔒 **The ban targets a grey SURFACE OR FILL BEHIND CONTENT, and a meter track is neither.** Ruled
in-channel after a sweep found three kinds of `--bg-inset` on this page:

| Use | Verdict |
|---|---|
| a fill behind text (`rank-rail.tsx`'s count pill) | **BANNED.** Fixed: a hairline over the near-white surface, the face every chip on these pages wears. |
| a METER TRACK (`devices-bits.tsx › Meter`, `h-1 w-8`; `rank-rail.tsx`'s comparison rail) | **KEPT.** A 4px track must show its unfilled portion to mean anything, and near-white on a white card reads as nothing at all. The grey is the function here, not decoration. |
| the staging States toolbar's segmented background (`overview-staging-page.tsx`) | **KEPT.** Staging-only chrome; it is not product UI and never ports. |

⚠ If Samuel ever flags the tracks himself, that is his override and it wins — swap the fill for a
hairline ring and accept the softer read. Do not pre-empt it.

### Round 4e — three structures, and the 5-second test for each

After four rounds Samuel stopped asking for another pass and asked for options: *"so much small
text, with no differentiation and no clear indication of what each thing belongs under… Any user
who looks at this is not going to be able to understand what's going on here."*

**The diagnosis, which all three variants had to solve:** (1) uniform micro-text with the same meta
repeated on every row; (2) ownership invisible — a computer did not visibly own its agents and
reaches, because 4d removed the boxes and put floating `AGENTS` / `REACHES` caps-labels in their
place, and a caps-label is not a skeleton; (3) column-scale blank space.

⚠ **De-boxing itself was Samuel's call and it stands** (§4d: the bento was rejected). None of these
three is a box-heavy variant; what varies is the MECHANISM.

| | Mechanism | How a host owns its rows | The trade |
|---|---|---|---|
| **A · Weight** (`devices-variant-bands.tsx`) | rhythm and weight | the host's name sits on a rule that spans its own column; its rows are 6px under it and the next host is 28px away. The tight/loose ratio IS the signal | adds no element at all, so it is the lightest — and the most fragile: flatten the gaps and the ownership goes |
| **B · Tree** (`devices-variant-tree.tsx`) | a drawn connection | a 1px rail drops from under the host's glyph and every row is attached by a stub. The file-tree convention, which needs no teaching | one column, full width, because a rail only reads when its branches are long |
| **C · Panes** (`devices-variant-panes.tsx`) | selection | a narrow list of computers; the detail shows the selected one's rows and nothing else. Ownership is not drawn, it is enforced | cannot compare two computers at a glance; worth more at six hosts than at two |

Shared by all three, so the structure is the only variable: `devices-variant-parts.tsx` holds the
content and a THREE-STEP type ladder (host 15/600 · child 12.5/500 · everything else 11px muted),
and the meta cuts — the agent row's `"Dopl · Claude"` is gone because the runtime badge on the
face already says it, and the host's four-fact spec string is one demoted truncated line.

**The 5-second test** (item 4e §3) — can a stranger say what computers exist, what runs on each,
what each reaches, and what is wrong right now:

| | computers exist | what runs on each | what each reaches | what is wrong |
|---|---|---|---|---|
| A | yes, two bands | yes, under its band | yes, same group, told apart by the lead | a caution line at the foot of the host |
| B | yes, two roots | yes, on the rail | yes, on the same rail | inline on the host row |
| C | yes, the whole list | **selected host only** | selected host only | on every list row, where it replaces the counts |

C answers "what is wrong" best (every row carries its own trouble) and "what runs on each" worst
(one host at a time). A and B answer all four for every host at once; A is quieter, B is more
explicit. Samuel picks; the losing files and `devices-variant-types.ts › VARIANT_OPTIONS` go
with them.

### Variant D · Cards (2026-10-22) — the design language, applied to the hosts

Samuel asked for a fourth option that *"looks a lot better, like the design stuff"*: D is the
hosts block rebuilt on `docs/DESIGN-LANGUAGE.md`, switched in through the same
`VARIANT_OPTIONS` entry (`key: "cards"`, label `D · Cards`). A/B/C are untouched.

| | Mechanism | What changes vs A/B/C |
|---|---|---|
| **D · Cards** (`devices-variant-cards.tsx`) | enclosure: one white card per computer, two side by side | A/B/C drew ownership WITHOUT a box (4d). D brings back exactly one box per computer, because a computer IS a boundary; nothing inside it is boxed again |

What D does differently, row by row:

- **Card**: `#fff`, 1px `#ececec`, 14px radius, the thread card's two-layer shadow. 14px padding.
- **Status**: one pill face (dot + word, 999px hairline) on hosts and devices. Green dot
  `Connected` only when live; `Away` grey dot; `Offline` hollow dot. Amber has no caller (nothing in
  the mock waits on the user), so it stays reserved.
- **Devices show function**: each device row is name + status pill on top, its monospace function
  chips (`display` `mic` `touch` for the G2) under it, battery as a 3px meter with a mono figure.
  ⚠ `FUNCTIONS` is a STAGING literal keyed by kind (glasses from `glasses-hud-content.ts ›
  HUD_CONNECTION`; phone/watch/web are placeholders). In the product it must come off the device's
  registered tool namespaces, not a kind table.
- **Agents are identities**: `PairedAvatar d=26 thinFrame` (owner photo + runtime badge), name,
  dot + `Working`/`Waiting`, mono duration. ONE accent per scene: every ring wears agent-colour slot
  11 (`ACCENT`); the only other colour is the live dot.
- **Fewer things**: host subline = model only (no app version, no runtime list, no counts); rows
  capped at 3 per group with `N more` (drop rows, never shrink text); remove Xs hover-revealed.
- **Type**: 15/600 host, 13/500 row names, 12 muted meta, 11.5 mono for chips and times.

**Literals**: every value is in `devices-variant-cards.css` (scoped under `.dvd`, imported by the
variant), the same one-place discipline as `DEV_CARD`. **How it ports**: `.dvd-card` becomes the
white `.bento` variant already named above (globals.css + `kit.css`); the `--dvd-*` values map to
existing tokens (`--text-primary`, `--text-muted`, `--border-default`, `--success`); `.dvd-pill`,
`.dvd-chip` and `.dvd-meter` are the status pill, function chip and 3px meter worth promoting to
`src/shared/ui` as one recipe each. Host header mirrors `computer-row.tsx › ComputerRow` slot for
slot, as A/B/C do. Test: `devices-variants.test.tsx` runs D through the shared checks plus pills,
chips, faces and the row cap.

⚠ **`devices-host-card.tsx` is now UNREFERENCED and kept on purpose**: it is the 4d structure, and
nothing in this tree is committed yet, so deleting it would lose the thing the variants are being
judged against. Delete it with the losers.
