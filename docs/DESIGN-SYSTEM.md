# Dopl Design System — the official UI layer

**The rule: no hand-rolled UI values.** Every page uses the tokens and kit
classes below. Never hardcode hex colors, raw px font sizes, or shadow/border
recipes in a component. If a recipe you need is missing, add it HERE (globals
+ this doc), then use it — don't fork it locally.

Source of truth: `src/app/globals.css` (`@theme` block + `:root` palette +
"UI kit" section). Design language: Samuel's study-notes app, verbatim —
neutral grays, hairline borders, floating bento cards, concave (pressed-in)
fields and raised 3D buttons. Currently wired: Knowledge (v2 + the shared
dialogs/doc-pane), Ontology, Chats, Skills, Overview (both the workspace page and
/home's Overview face, which share `BarSeries` and `pages/overview/overview-bits.tsx`),
Workspaces (invite/join/create cards), Billing, MCP-connect.
⚠ **MEMBERS AND SETTINGS LEFT THIS LIST ON 2026-08-30, AND THEY WERE NEVER
MEASURED ONTO IT.** They are on the token palette like everything else, but
neither uses ANY of the seven primitives that now define the dialog kit —
`StandardDialog`, `DialogField`, `DialogActions`, `DIALOG_TITLE`,
`DIALOG_BTN_PRIMARY`, `DIALOG_BTN_SECONDARY`, `RAISED_INPUT`. Measured over the
paths those two surfaces occupy (`src/features/members`,
`src/features/workspaces/components`, `src/shared/layout`,
`apps/desktop-ui/src/pages/{members,settings}`,
`apps/desktop-ui/src/components/settings-modal`) the sweep returns **0 lines** —
re-measured 2026-08-30 AFTER the members-v1 tab and the settings-modal members
section were deleted, so this is the v2-only tree's number and not a leftover.
"Currently wired" is a claim about the KIT, so re-derive it rather than
inheriting it: `grep -rln 'StandardDialog\|RAISED_INPUT' src apps`.
Exempt: marketing pages and auth + onboarding (their own glass/3D
kit). The F-022 legacy Button/Dialog primitives are retired (deleted
2026-07-17). Every new page starts on this system.

## Type scale

Semantic `text-*` utilities (Tailwind, from `@theme`). Pick by role, not px:

| Utility        | Size    | Role                                                        |
| -------------- | ------- | ----------------------------------------------------------- |
| `text-micro`   | 10.5px  | timestamps, counts, mono ids                                 |
| `text-label`   | 11px    | uppercase section labels — always `uppercase tracking-wide font-semibold` |
| `text-caption` | 11.5px  | metadata, sublines, secondary chips                          |
| `text-small`   | 12px    | tree rows, tabs, menu items, compact buttons                 |
| `text-body`    | 12.5px  | default body, row titles, inputs                             |
| `text-lead`    | 13px    | prose/document body, emphasized text                         |
| `text-title`   | 14px    | pane headers, card titles                                    |
| `text-display` | 18px    | page/document titles                                         |
| `text-stat`    | 26px    | large dashboard figures (stat cards, period totals) — always `font-mono tabular-nums`, never prose |

No sizes between or outside these. `text-sm`/`text-xs`/`text-[13px]` are all
forbidden in app UI (marketing/landing pages excepted).

**THE 14px PANE-HEADER FACE HAS A NAME, AND IT IS READ BY IMPORT:**
`agent-templates/components/template-section.tsx › TEMPLATE_NAME_TEXT`
(`text-title font-medium text-text-primary`) — the template card's name, the /home
Overview's **Credit spend** heading, the Usage card's scope controls, the Agents
tab's gray-well headings, and **since 2026-09-13 the CHANNEL HEADER's channel name
and the view dropdown beside it** (Samuel: *"the dropdown and the name of the
channel should be that font styling"*; `channels/components/message-pane-header.tsx`,
`channels/components/channel-single-column.tsx`, pinned in
`channels/components/channel-single-column.test.tsx`). ⚠ **NEVER RE-TYPED** — a hand-written
`text-title font-medium` reads identically today and drifts the day the constant
moves, and Samuel names this face by pointing at a surface rather than at a size.
⚠ **NOT `TEMPLATE_NAME_TEXT_LG`** (18px, `shared/ui/section-heading.ts`), whose one
reader is the /home **Usage** panel heading; he rejected its spread by name
(*"I only asked you to change the usage size to be bigger"*). ⚠ The channel header's
name came DOWN in weight (`font-semibold` → the constant's `font-medium`) in that
change, deliberately; in a thread the crumb's channel half takes the size and keeps
its own muted resting ink.

## Color tokens

Utilities generated from `@theme` (values live in `:root`):

| Utility                                       | Value            | Role                       |
| --------------------------------------------- | ---------------- | -------------------------- |
| `text-text-primary`                           | `#232a31`        | primary ink                |
| `text-text-secondary`                         | `#57606b`        | secondary / muted labels (darkened 2026-08-19) |
| `text-text-muted`                             | `#98a2ad`        | faint / placeholders       |
| `text-text-disabled`                          | `#c4cad1`        | disabled                   |
| `text-danger` / `bg-danger/10`                | red              | destructive text / soft bg |
| `text-success` / `text-caution` / `text-warning` / `text-danger` | green → yellow → amber → red | the severity RAMP, in order. `caution` sits between success and warning; it exists so a four-band meter has a yellow that is not the amber `warning`. |
| `bg-bg-elevated`                              | `#fbfcfd`        | card / panel surface       |
| `bg-card-surface-subtle`                      | `#f4f6f9`        | header strips, inset cards |
| `bg-bg-inset`                                 | `#f1f1f1`        | concave body fill, wells   |
| `bg-surface-raised-1/2/3/4`                   | 2–7% black       | hover / active row tints   |
| `bg-chart-bar`                                | `#e8e8e8`        | THE HISTOGRAM BAR's resting fill — **SOLID, and that is the whole reason it exists** (Samuel, 2026-09-08, against the reference chart: *"their bars are not transparent"*). The `surface-raised-*` row above it is alpha ON PURPOSE, so a bar wearing one picks up whatever card it stands on and reads as a smudge rather than an object. Its inked twin is `bg-surface-cta`, which the highlighted bar already wore. One consumer: `apps/desktop-ui/src/components/charts/bar-series.tsx`. |
| `border-border-subtle/default/strong/highlight` | 6/8/12/16% black | hairlines, by emphasis   |
| `divide-border-subtle`                        | 6% black         | list dividers              |
| `bg-home-frame`                               | `#2f3542`        | THE APP FRAME — the dark slab behind shell root + surface + sidebar + account rail (darkened a notch 2026-08-25; scope widened to the workspace shell 2026-08-30) |
| `bg-home-panel`                               | `#f1f3f5`        | THE PANEL — `.page-float`'s fill, i.e. every full-page card in the app |
| `border-home-panel-line`                      | `#7a7a7a`        | THE PANEL LINE — `.page-float`'s 2px edge and the /home record pane's. ⚠ The header selector's track is `--seg-fill` now, so the token's `bg-` variant has NO consumer (`grep -rn 'bg-home-panel-line' src apps` is empty); only the `border-` utility is live. ⚠ It was `#e2ecf0` until 2026-09-08, when Samuel ruled the light-blue panel edge to a neutral DARK GRAY; the value is a first guess to be tuned live, and the token's own comment in `globals.css` names the two neighbours (`--raised-light-line`, `--border-active`). |
| `bg-home-card`                                | `#fbfcfc`        | THE CARD — the /home record pane's fill, one step warmer than the panel |
| `--agent-color-01 … -16` (no utility) | `oklch(0.62 0.17 H)`, H every 22.5° | **THE AGENT COLOUR BANK** — one hue per LIVE agent in a channel (Samuel, 2026-09-13; docs/specs/agent-colors.md). ⚠ **THEY ARE IDENTITY, NEVER STATUS**: the severity RAMP two rows up (`success` → `danger`) says how an agent is DOING, and `agent-01` being red says nothing about its health. ⚠ **NO `text-*` / `bg-*` UTILITY, AND THAT IS DELIBERATE** — the member is chosen by DATA (a key off a peer's projection), and a Tailwind class cannot be built from a runtime key. `src/features/channels/lib/agent-colors.ts › agentColorVar` is the ONLY place the token name is spelled; consumers pass its `var(--agent-color-NN)` into an inline `style`. ⚠ ONE SATURATION AND ONE LIGHTNESS, HUE ONLY, so no two read as "the same colour, darker" and all sixteen carry equal weight against the transcript's white ground. ⚠ NO `-soft` COMPANION SET: since 2026-09-14 the colour is a STROKE and a 3px BAR with no filled area at all, so a tint would have no consumer (⚠ the stroke was a `ring` until 2026-09-16 and is a 3px `border` now — one drawn shape, see "The AGENT POST ACCENT" below). ⚠ SIXTEEN is one more than the agent cap (15, 2026-09-01), so a full room still has a spare. ⚠ The key set is mirrored in four more places — re-derive with `src/features/channels/agent-color-schema.test.ts`, never by hand. |

**These are the APP FRAME palette, and the old "/home ONLY" note on them is
SUPERSEDED** — Samuel, live review 2026-08-30: *"the workspace pages adopt
/home's frame model and palette — the two surfaces must match."* The `--home-`
PREFIX is kept deliberately: it has outgrown its name, and renaming to
`--frame-*` would touch every consumer, both token copies and six docs for zero
behaviour change. Still never fold them into `--bg-*` — the frame is cooler and
the card warmer than that ramp on purpose.

### The frame model ALTERNATES — four levels, and the dark is level 0 only

Samuel, same review, over the first cut: *"it should be the sidebar panel gray,
then the inner panel is white, and panels on top of that go back to that sidebar
panel gray — it's alternating. Look at the home page, that's literally what it
looks like."*

**THE PANELS NEST — there is ONE float per surface, and everything else is
inside it.** *"The right panel sits ON TOP OF the gray panel that holds the
sidebar."* `pages/home/index.tsx` is the literal spec: a single
`page-float bg-home-panel` `<main>` spanning everything right of the rail, the
relationship list standing directly on that gray, the record pane a white card
floating inside. The workspace shell is that structure with the nav where the
list is.

| Level | Face | Who wears it |
| --- | --- | --- |
| 0 · FRAME | `--home-frame` | `app-shell.module.css › .root` + `› .surface`, `account-rail.module.css › .rail` |
| 1 · PANEL | the kit's `.page-float` (`--home-panel`, 2px `--home-panel-line`, r14) | ONE per surface: `› .panel` on the workspace shell, `<main>` on /home |
| 2 · CARD | `--home-card` / `--panel-surface` | `› .pageCard` (the routed page), /home's record pane, `.bento`, `› .wordsCard`, the active `.raised-tab` chip |
| 3 · WELL | `--home-panel` again | `[data-section-panel]` — `SECTION_PANEL_GROUND` on a workspace page, `pages/home/home.module.css › .frame` on /home |

🔒 **AND THE AGENT POP-OUT WEARS THE ALTERNATION AT WINDOW SCALE (Samuel,
2026-09-13):** *"notice that it's a white panel that's inset now on a darker
background. … It should be the same color that we have on our current site."*
The window's own ground is **level 1** (`bg-home-panel`, painted by
`channels/components/agent-window-shell.tsx`) with the agent's view a
**level 2** `.bento` card inset `gap-3` inside it
(`› agent-window-frame.ts › INSET_PANEL`) — so a frameless OS window is the same
frame → card alternation as a page, with the tab strip and the collapsible agents
rail standing directly on the gray the way nav chips stand on level 1. ⚠ **THIS
SUPERSEDES THE 2026-08-27 "A POP-OUT IS THE PANEL, EDGE TO EDGE" RULING FOR THIS
WINDOW ONLY** — the thread pop-out still paints `--panel-surface` to its own
edges (the row above), and the two now differ on purpose: one shows a
conversation, the other holds tabs over a rail. ⚠ **THE WINDOW'S GEOMETRY IS ONE
MODULE, BECAUSE EVERY RULE IN IT IS AN EQUALITY BETWEEN TWO COMPONENTS THAT DO
NOT IMPORT EACH OTHER** (`› agent-window-frame.ts`, 2026-09-13's second pass): the
**Dopl mark and the rail's selected-agent tile are ONE 36px square**
(`TILE` — *"It should be the exact same size as that for the selected agent. That
kind of needs to be normalized"*), a **tab label and a rail row are ONE type
recipe** (`AGENT_NAME_TEXT`, `text-body` regular — *"I think it should be the
smaller one"* — on the rail's own `px-2`), the **active tab's underline is the
popup field's** (`TAB_UNDERLINE`, 2px black square-ended, checked against
`shared/ui/form-dialog.module.css › .line::after` rather than copied), the **rail
is 56px collapsed and exactly 2.5× that expanded** (*"it should only increase in
size to maybe double the size of the collapsed view or maybe 2.5x"*), and the
**strip starts at `railWidth + FRAME_GAP`, which IS the panel's left edge**
(*"the tab switcher should start on the left side and be aligned with the start of
the white panel"*). ⚠ **`min-w-0` ON EVERY ANCESTOR OF THE PANEL IS PART OF THE
FACE, NOT AN OPTIMISATION** — a flex item's automatic minimum size is its
content's min-content width, so one missing link made expanding the rail PUSH the
panel and the window controls off a root that clips (*"the right side just gets
completely cut off … the top right, all of those things just get pushed out"*).
Pinned in `channels/components/agent-window-frame.test.ts` and
`apps/desktop-ui/src/pages/agent-window/frame.test.ts`.

🔒 **AND SAMUEL'S 2026-09-15 PASS OVER THAT WINDOW MOVED THE RULES BELOW** — the list is the count,
which is why none is given here. Each is still an equality or an absence, and each is pinned in
`channels/components/agent-window-frame.test.ts` / `› agent-window-chrome.test.tsx` /
`› agent-window-rail.test.tsx` / `› agent-window-ended.test.tsx`:

- **A tab label and a rail row are one type SIZE, in TWO weights.** `AGENT_TAB_TEXT`
  (`text-body font-semibold`) is the tab, `AGENT_NAME_TEXT` (`text-body font-normal`) is the rail
  row — *"I want the name of the tab, like 'New Agent', to be bolded."* ⚠ **A second constant, not
  `font-semibold` beside `AGENT_NAME_TEXT` at the call site**: two `font-weight` utilities on one
  element are resolved by Tailwind's EMIT order, which is the trap `SelectMenu`'s variant row
  already records.
- **A tab HUGS its label and caps at `TAB_MAX` (200px).** *"Make it unfixed so that the tab will
  only go as long as the name is and the X will just be to the right of that. … if the name is
  super long then you should fix it to a certain width."* ⚠ This **supersedes the `w-[180px]`
  reading of the 2026-09-13 *"It's a fixed size"*** — the surviving half of that sentence is *"and
  it does not get cut off"*, i.e. the `truncate` on the label, not the box. The active tab's
  underline is `inset-x-0`, so it follows the new width for free.
- **An INACTIVE tab's hover fill is `bg-surface-raised-2`** (*"it should highlight gray or
  something so I know that I can click on it"*), with `cursor-pointer`. ⚠ **Measured off this
  window, not picked**: that is the rail's hover AND its `ROW_SELECTED_FACE`, and a tab and a rail
  row are already one object in two places. The ACTIVE tab takes neither.
- 🔒 **The collapsed rail's padding is asymmetric — `RAIL_PAD_COLLAPSED` (`pl-4 pr-1`) — and that
  is the fix, not the bug.** *"In the collapsed sidebar, there's still more spacing to the right of
  the individual agent icons. … I want the right side to have the same amount of distance to the
  icon as it is from the left side."* ⚠ **`RAIL_PAD`'s `px-2.5` was ALREADY symmetric**, so the
  padding was never what he was looking at: `FRAME_GAP` sits to the right of the column, so the
  gutter measured 10px left against 10 + 12 right. `16 + 36 + 4 = 56` keeps the rail at its
  spec width and `4 + 12 = 16` balances it — the panel's left edge does not move. **Expanded keeps
  `RAIL_PAD`** (*"Actually, that looks fine"*).
- **No "AGENTS" heading in the expanded rail** (*"remove the line that says the word 'agents.' …
  It's obvious to the user."*) — the minimal-copy rule over a label above a list of agent names in
  a `<nav aria-label="Other agents">`, which is what still carries the fact for a screen reader.
- 🔒 **THE AGENT'S BADGE — ENDED *AND* LIVE — RIDES THE THREAD LINE, RIGHT-ALIGNED, AND THE
  CHROME'S CORNER SAYS NOTHING ABOUT AN AGENT.** Samuel moved it twice on 2026-09-15: *"I don't
  want the badges to be there. … 'Ended by you' should be the badge"*, then, on seeing it at the
  foot, *"put it on the right of the line where it says 'in main channel'. Similarly, for where you
  see 'running', 'thinking', or 'working' (all of those little things), put that in the same spot …
  but to the right, aligned to the right."* `channels/components/agent-window.tsx › AgentWorkingOn`
  is now a `flex items-center` row: the `↳ in <thread>` half is `min-w-0 flex-1` and TRUNCATES, the
  badge is `shrink-0` — `agent-bits.tsx › AgentLiveness` for a live agent, `› AgentEndedPill`
  (`bg-surface-cta` / `text-text-on-cta`) for a dead one, over **main's own end sentence**
  (`dopl-desktop-app/main/session-effects.js › endedStatusText`), which `agent-stream-lanes.ts ›
  splitEndNote` lifts out of the work log so the end is stated once. ⚠ **The chrome's `status` prop
  is DELETED, not passed empty** (delete-don't-disarm) — the right group is Expand + Close. ⚠ **The
  short-lived `AgentEndedFooter` is deleted with it**; do not re-derive a bottom-left badge from
  this row. ⚠ The other surfaces are unchanged: the Agents-tab cards and the slide-out header still
  say the bare "Ended" (`AgentEndedPill` took a `label` prop, not a second face), and the slide-out
  panel ALREADY right-aligns its badge on the header row carrying its own `in <thread>` line
  (`agent-panel.tsx › AgentPanelHeader`) — which is exactly the shape this ruling asks for, so it
  was not touched. ⚠ The stream's live tail (`agent-stream-working.tsx`) stays: Samuel's 2026-09-14
  *"not only in the header's corner"*.
- **The pickers row sits the same distance from the line above it and the meter below it**
  (*"Decrease the amount of padding there so that it is the same as the distance between the
  pickers and the top"*) — `agent-posture.tsx`'s own `py-2.5` above, `mt-2.5` below. ⚠ **The
  20px he saw was not a padding**: `shared/ui/usage-meter.tsx` defaults its `className` to `mt-3`
  and that stacked on the block's margin, so the caller now passes `className=""` and one owner
  holds the gap.

The sidebar is a **region of level 1**, not a level of its own: it paints
nothing — no fill, no border, no margin, no radius — and the nav chips stand
directly on the panel gray.

⚠ **THE PANEL BUTTS THE RAIL ON BOTH SURFACES** (`--shell-gap-left: 0`, plus each
panel zeroing `.page-float`'s own left margin — `› .panel`, and `!ml-0` on
/home's `<main>`). The visible dark column must be the 54px rail EXACTLY: an 8px
sliver of frame beside it reads as part of the same column and a rail-centred
tile then looks shifted left. /home found this first; the workspace shell kept
the sliver until 2026-08-30, which is why the same rail read differently on the
two hosts.

⚠ **THE SELECTED RAIL TILE OWNS THE ONLY HORIZONTAL LINE IN THE RAIL.** A 22×1
divider rule used to draw the account/container boundary between Home and the
workspace tiles; on a workspace page it sat 7px above the SELECTED tile and
stacked with `.raised-tab`'s hairline into a doubled border. The boundary is
rhythm now — `.workspaces` opens with 4px on top of the rail's 7px gap, so the
break is 11px against a 7px tile-to-tile gap. Do not put the rule back.

⚠ **TWO WRONG CUTS, BOTH REJECTED ON SIGHT, BOTH EASY TO RE-MAKE.** (1) The
sidebar painted `--home-frame` — nav rows floating on bare dark. **The dark is
FRAME ONLY**: the margin around panels, never a surface content sits on. A
short-lived `--home-frame-ink` / `--home-frame-hover` pair served that mistake
and is **deleted**. (2) The sidebar given its own panel face — sidebar and page
as two SIBLING floats with a 2px line between them. **The panels nest.**

⚠ **THE LEVEL DECIDES THE FACE, NOT THE COMPONENT.** `SectionPanel` is a gray
WELL in both hosts because in both it is drawn inside a white card — on a
workspace page that card is `.pageCard`, on /home it is the record pane. One
component, one colour, two rules that agree. Pinned end to end in
`apps/desktop-ui/src/components/app-shell/frame-palette.test.ts`.

⚠ **INSIDE THE WORKSPACE SHELL A PAGE'S OWN `.page-float` COLLAPSES** —
`.pageCard :global(.page-float)` resets its face and margin (never its
`flex: 1; min-width: 0` sizing). Sixteen surfaces across both trees compose that
class; the ones that still supply their own surface — /home's `<main>`, the
pop-out thread window, the web playground — keep the real recipe, which is why
the shell overrides rather than the pages dropping it.

## Kit classes (globals.css "UI kit" + auth-3D sections)

| Class            | What it is                                                             |
| ---------------- | ---------------------------------------------------------------------- |
| `.page-float`    | THE full-page surface: raised 14px-radius card floating on the app FRAME (margins `7px 8px 9px 8px`, which is what reveals the frame above, below and beside it). One per page. **Fill `--home-panel`, edge `2px --home-panel-line`** since 2026-08-30 — the same line, at the same width, that /home's record pane wears; it was `--panel-surface` on a 1px `--border-strong` hairline, which is why the workspace panel and /home's did not match. Compose flex direction yourself. ⚠ **IT ALSO CARRIES THE SIZING — `flex: 1; min-width: 0` — and that is the trap (2026-08-28).** A view composed with it gets filling its host for free and never says so, so the day a mount DROPS the float (an embedded copy inside another panel) it silently drops the sizing too and renders at content width: half a pane of view, half a pane of page-gray. **A view that can be mounted without the float states `flex: 1; min-width: 0; min-height: 0` on its own shell class**, so the float and the embedded mount are the same box and the only difference between hosts stays the surface. Worked example: `knowledge-v2.module.css › .shell`, pinned in `src/features/knowledge/components/knowledge-v2/layout-rules.test.ts`. |
| `.bento`         | Soft floating inner card (border-default, soft double shadow).          |
| `.glass-panel`   | Frosted card for a PUBLIC page standing on the landing's white ground — `.bento`'s geometry (radius 18) with the opaque fill traded for `rgba(255,255,255,0.62)` plus `backdrop-filter: blur(18px) saturate(1.5)`, a `--border-default` hairline and a soft ambient drop. Added 2026-08-31 for `src/app/link/[token]/claim-card.tsx`; re-derive consumers with `grep -rn 'glass-panel' src apps`. ⚠ **The fill must stay translucent** — swapping it for `--panel-surface` leaves the blur computed and unseen and collapses the panel into a flat `.bento`. ⚠ Not the same thing as `shared/design › LiquidGlass`, which REFRACTS a backdrop (an image, a dark slab) and does nothing over flat white. |
| `.concave-field` | Pressed-in input well (`#e9eaec`, inset shadows, focus ring). Alias of `.auth-field-3d`. Its focus signal is `--focus-line` + `--focus-halo` — THE app-wide "this one is live" pair (2026-08-24), shared verbatim with the open search pill and `.selected-ring`. State it once; never re-type those rgba values. |
| `.concave-track` | Recessed switcher track (radius 10, 4px pad) that tab pills sit inside. |
| `.seg-pill`      | Resting face of one stadium pill in a TRACKLESS segmented row — flat `--seg-fill` fill, fully rounded ends, **INSET** ring hairline (inset since 2026-08-25: an outset ring painted a pixel beyond the box on every side, so unselected pills measured 2px larger than the selected `.raised-tab` beside them and the selection looked shrunken). `SegmentedControl` renders one per option; active swaps to `.raised-tab` (2026-08-12). |
| `.raised-tab`    | White-gradient raised face for the ACTIVE item inside a `.concave-track` — also composed onto the active `.nav-chip`, the active `.seg-pill` option and the `Switch` thumb. ONE elevation with `.auth-btn-3d-light` (2026-08-15): identical gradient (`#fff → #f2f2f2`), hairline (`#d4d4d4`), bevel and drops. Its hairline is an `inset 0 0 0 1px` RING, not a `border`, because the class is toggled onto content-sized elements whose resting face has none — a real border would make every active chip 2px wider than its siblings. THE selected state app-wide (2026-08-17) — toggled chrome (History/Rooms toggles, doc-toolbar marks) and open-menu triggers (session pills, composer intent pill) wear it too; there is no pressed-in selected face. ⚠ It supplies the FILL, so a consumer's resting `bg-*`/`hover:bg-*` utilities must be conditional on NOT-active: Tailwind's utility layer outranks the kit layer and a stray `bg-bg-elevated` flattens the gradient to nothing. Resting face only; behavioural states belong to the consumer. |
| `.nav-chip`      | Hug-width sidebar/nav chip (`--shell-chip` fill — `#e8e8e8`, lightened one step 2026-08-30 on Samuel's *"the grayed resting backgrounds one step lighter"*; it is this class's ONLY consumer, and both mounts wanted the shift — radius 10, h36) for `<a>` and `<button>`. Active = `.nav-chip-active` + `.raised-tab`. THE nav recipe — app sidebar + settings modal both compose it; never fork it locally. ⚠ **BOTH grounds are a light gray panel and the recipe is written for exactly that** — the settings modal's `--shell-surface` rail and, since 2026-08-30, the app sidebar's `--home-panel` panel. A dark-ground rebind of this class existed for one iteration of the frame ruling and was **deleted** when the sidebar became a panel instead of a slab of frame; do not re-add one. The resting/active pair IS the alternation at chip scale: flat chip on gray, `.raised-tab` white when active. |
| `.btn-light`     | Small raised light button (toolbar / compact chrome).                   |
| `.auth-btn-3d`   | Raised black primary CTA. (`.auth-btn-3d-light` = white variant.) ⚠ **ITS HOVER AMBIENT DROP IS `--shadow-raised-hover` SINCE 2026-09-16** — extracted, not copied, because the transcript's agent badge had to wear the same step (Samuel: *"when I hover over like one of the black buttons, it translates up, and the shadow gets darker/larger … Can we add the same functionality"*). The rule keeps its own two INSET bevel lines; only the two drops moved to the token. Declared in `globals.css` and mirrored in `tokens.css` (gated by `scripts/check-css-token-drift.ts`). `.auth-btn-3d-light` is THE white-raised elevation reference: `.raised-tab` and the app-shell's `.brandPill` are the same face at other scales. **Since 2026-08-24 both are BUILT FROM `--raised-light-face` / `--raised-light-line` / `--raised-light-bevel` / `--raised-light-shadow`** (`:root`, tokens.css + globals.css), so the "one elevation" rule is enforced by construction rather than by matching two hex lists — and a scoped override can wear the face without forking the recipe (/home's sender pills do exactly that). Change the face in ONE place: the vars. |
| `.selected-ring` | THE selected face for a raised-light control (2026-08-24) — `--focus-line` hairline + `--focus-halo`, i.e. the signal the search pill wears while OPEN, held permanently instead of only while focused. Compose onto `.auth-btn-3d-light`; it re-states itself on `:hover` so a pointer cannot wash the selection out. ⚠ Not a border of its own and not a fill swap. 🔒 ⚠ **/home's CHANNEL LIST NO LONGER WEARS IT — ITS SELECTED ROW IS THE PAGE'S BLACK BUTTON (Samuel, 2026-09-15):** *"for the channel picker, for the selected channel, can we have it turn into like the black button UI? And drop the shadow that currently goes on the selected?"* `pages/home/channel-row-marks.tsx › HOME_CARD_FACE_SELECTED` is `.auth-btn-3d` + the row's radius + `text-text-on-cta` — **the same kit recipe `pages/home/panel-buttons.tsx › PAGE_ACTION_BTN` wears**, by reference and never a copied gradient. ⚠ **THE TWO FACES ARE ALTERNATIVES, NEVER LAYERS, AND THAT *IS* THE "drop the shadow"**: the row was `HOME_CARD_FACE` + this ring + a module rule for the line, three elevations over one row; `.auth-btn-3d` sets `background`, `border` and `box-shadow` in one rule, so swapping the face leaves nothing to layer. **Do not re-add a ring there.** ⚠ Same 1px border on the same radius, so selection cannot shift the list. ⚠ **THE ROW'S INK TRAVELS WITH THE FACE**: there is exactly ONE on-dark ink token in either file (`--text-on-cta`), so the quieter lines take it at an ALPHA (`text-text-on-cta/70`, the idiom `channels/components/agents-tab.tsx` already holds) rather than naming a grey the palette does not have, and the two unread marks INVERT their token pair (`MentionBadge`, `UnreadDot`) because a black pill on a black card is an invisible badge, not a quiet one. ⚠ **THE RING ITSELF IS UNTOUCHED AND STILL HAS READERS** — the header's open search pill, and the landing page's scripted /home demo (`marketing/components/banner-demo/demo-home-chrome.tsx`), which is why this ruling changed a CALL SITE and not the recipe. ⚠ **`--home-row-line-selected` and `home.module.css › .rowSelected` (the 2026-09-09 darker line) are DELETED with it** — that rule was the token's only consumer, and a darker line means nothing on a face that brings its own black edge. |
| `.menu-card` / `.menu-row` / `.menu-divider` | THE dropdown surface, its row face and its section rule (2026-08-15). Ported from the landing Menu dropdown — `src/features/marketing/marketing.css › .lp-nav-menu-card` / `.lp-nav-menu-item` / `.lp-nav-menu-divider` plus the `lpMenuIn`/`lpMenuOut` keyframes, replicated in the global layer as `menuCardIn`/`menuCardOut` (marketing.css is page-scoped and the app never loads it — edit both together). Card: 16px radius, 7px padding, white→`#f6f6f6` gradient, `#dcdcdc` hairline, top inset bevel + three drops, unfolding on a 7° `rotateX`. Row: 10px radius, and its face is the GLOBAL OPTION-HOVER RULE below — **option hover = `--menu-item-hover-bg`, the Add-item gray; never an elevated face** (Samuel, 2026-09-10; `:focus-visible` is the same face, `:active` one step down the ramp). It was a white→`#f0f0f0` gradient with a 1px lift and a drop shadow until then — *"when I hover over options in a dropdown, it turns this like white elevated button looking thing"*. The token is `var(--surface-raised-1)` BY REFERENCE — the same gray `info-card-rows.tsx › InfoCardAddRow` wears — and `bg-menu-item-hover-bg` is its Tailwind alias for option rows that miss `.menu-row` (the mention list, `scope-share-popover.tsx`). ⚠ The landing nav's `.lp-nav-menu-item` KEEPS the elevated face: marketing is exempt from this kit, so that copy deliberately no longer matches. **Only `Popover` composes these** — never hand-roll a menu surface. |
| `.graph-substrate` | Dotted world surface (24px pitch) behind a board or graph view. THE dot recipe. ⚠ **THE ONTOLOGY BOARD LEFT IT ON 2026-09-10 AND CAME BACK ON 2026-09-11** (Samuel: *"I don't see the dots, the dotted grid. I want to bring that dotted grid back"*). The 09-10 removal read the grid as the inner panel of a *"double panel"*; what he objected to was the FILL, and this recipe paints dots and no background — so `kanban-board.tsx` and `ontology-skeleton.tsx` compose it again on a board that is still the page panel itself. Consumers, measured 2026-09-11: `grep -rn 'graph-substrate' src apps`. |
| `.kanban-substrate` | Modifier on `.graph-substrate`: halves the pitch to 12px so a lane board's geometry lands on the grid (288px lanes = 24 tiles, 12px gutter = 1, 24px board padding = 2), and `background-attachment: local` so the dots cover the whole scrollable area and travel with the lanes. ⚠ **BACK ON THE LIVE ONTOLOGY BOARD SINCE 2026-09-11** — see the row above. ⚠ **AND IT BRINGS NO FILL WITH IT**: `pages/home/ontology-panels.test.tsx` pins both halves in one test — the grid IS on the scroller and the scroller carries no `bg-*`, because the white panel is still a ruling. |
| `.graph-node-lift` | Elevation applied to a graph card WHILE dragging (deeper shadow + grabbing cursor). |
| `.graph-port`    | Raised connector dot on a workflow step card edge; `data-active` = drag source, `data-target` = live drop target, `data-variant="output"` = inked source dot. |
| `.graph-node` / `.graph-node-selected` / `.graph-node-target` | Graph card resting / selected-ring / connect-drop-target surfaces. ⚠ **DEAD — ZERO consumers, measured 2026-08-30** (`grep -rn 'graph-node' src apps packages \| grep -v '\.css:'` → no hits). This row said *"only the Workflows cards are left"*; the Workflows page was **deleted 2026-08-11**, and the last caller went with it. Kept until a deliberate deletion pass, and named here so the next reader does not compose a group that paints nothing. ⚠ Do NOT take the substrates down with them: `.graph-substrate` / `.kanban-substrate` are still live, on the playground pane AND on the ontology board again (2026-09-11). |
| `.search-expand` / `-shell` / `-toggle` / `-input` | THE collapsing search: a 36px round button that GROWS to a 260px pill (2026-08-24, /home's header). Port of `src/features/marketing/marketing.css › .lp-nav-search*` scaled to 6/7 of the landing's own measurements (landing 42/300/42/42+16px pad/14px text → 36/260/36/36+14px pad/`text-small`). The RATIO is what is held: 42÷14 and 36÷12 are both 3.0, so it reads as the same control a notch down. Only colour comes from tokens. Same overlay trick (the slot stays one button wide, the shell is pinned `right: 0` and grows leftward, so no sibling moves) and the same delayed-in/instant-out input reveal. The shell composes `.auth-btn-3d-light` in the TSX and is never swapped for a field; while `[data-open]` its hover/press face is suppressed and only `.concave-field`'s FOCUS signal is borrowed. Marketing.css is page-scoped and the app never loads it — edit both together. |
| `.channel-info-slide` | The channels info column's slide shell (2026-08-24) — 0 ↔ **`var(--info-w, 380px)`** on a 200ms width transition. ⚠ **THE OPEN WIDTH IS THE OPERATOR'S SINCE 2026-09-13** (`channels/components/use-info-resize.ts` writes `--info-w` on the SURFACE ROOT; `InfoResizeHandle` in the components table is its face), and `[data-info-resizing="true"] .channel-info-slide` drops the transition for the length of a drag so the column does not lag the pointer by 200ms. **380px is now the FALLBACK and the FLOOR, not the width** — the pane never gets narrower than it was, and never wider than half the surface, `overflow: hidden`. WIDTH, not transform: the column is a flex sibling of the message pane, and a transform would slide it over the transcript instead of handing the space back. The panel inside keeps its own `w-[380px] shrink-0` so it never squashes mid-slide. ⚠ **380 IS A MATCH, NOT A TASTE (2026-08-25, Samuel): it is `channels/components/agent-panel.tsx`'s width** — which is the SAME `var(--info-w, 380px)` expression since 2026-09-13, so the match is kept by construction rather than by two literals**, and that panel is absolutely positioned against the SAME right edge — at 340 the divider jumped 40px sideways the moment an agent view opened. Change one and change the other. ⚠ Coupled to `channels/components/use-info-slide.ts › useInfoSlide` (which holds `INFO_SLIDE_MS`; it stood in `channel-surface.tsx` until 2026-09-04, when the web's one-column layout took that file to the cap), which keeps the panel mounted one transition past close, and to the `prefers-reduced-motion` block that turns the transition off. |
| `.collapse-grid` | **THE COLLAPSE (2026-09-13, Samuel, over the Agents tab's gray wells: *"I want the drop-downs collapsing and expanding to be a smooth animation … like the gray box increases in size"*)** — `grid-template-rows: 0fr → 1fr` over `overflow: hidden`, 200ms on the app's own `cubic-bezier(0.22,0.61,0.36,1)`, the same duration and curve as `.channel-info-slide` above and `.menu-card`'s unfold. ⚠ **IT ANIMATES TO THE CONTENT'S HEIGHT WITH NO MEASURED PIXEL**, which is the whole reason for the `fr` trick: `height: auto` does not transition and a `max-height` is a number somebody has to keep true. ⚠ **`min-height: 0` ON THE CHILD IS LOAD-BEARING** — a grid item's automatic minimum size floors the track at its content height, so without it `0fr` animates nothing at all; the recipe states it (`.collapse-grid > *`). 🔒 ⚠ **`overflow: hidden` CLIPS EVERY SHADOW INSIDE, AND THE CONSUMER MUST GIVE IT BLEED ROOM ON THE THREE EDGES THAT ARE NOT THE GROWTH EDGE.** This row read *"accepted, because every alternative reintroduces a measured height"* until 2026-09-15, when Samuel saw what it costs: *"there are these like weird vertical shadows/the shadows are being cut off."* With the clip box exactly as wide as its content, each card's drop shadow is sliced flush with its own left and right edges — a hard vertical rule down the list, which is worse the heavier the elevation (`HOME_CARD_FACE`'s hovered `0 10px 20px` reaches **10px** sideways and its `.selected-ring` halo **3px**; a `.bento` card's `0 6px 18px` reaches **9px**). **The fix costs no measured height: widen the CLIP BOX with a negative margin and re-inset the content by the same amount** — `channels/components/collapse-wells.tsx › Well` is the worked example, `-mx-3` on the `.collapse-grid` against `px-3` on its column, i.e. the WELL'S OWN `p-3`, so the clip lands on the well's border box and nothing moved. ⚠ **12px is also the MAXIMUM there**: a wider bleed would paint shadow outside the gray. ⚠ **THE GROWTH EDGE — the BOTTOM — still clips tight, and that is structural**: a `0fr → 1fr` track grows downward, so its bottom clip IS the animation. Every fix for that one (bottom padding inside the box, a negative bottom margin, `overflow-clip-margin`) either leaves the collapsed box taller than its header or jumps its height on toggle. ⚠ Drive it with `data-open`; LAYOUT (the gap, the column) is the consumer's, as with `.crossfade`. ⚠ A consumer that UNMOUNTS its content on close must wait exactly 200ms and drop that wait under reduced motion, where the `prefers-reduced-motion` block turns the transition off — `channels/components/collapse-wells.tsx › WELL_COLLAPSE_MS` / `› useWellContent` is the worked example (ONE module, THREE surfaces since 2026-09-15 — the Agents tab, the Threads tab and /home's channel list; ⚠ **it was `recency-wells.tsx` until that day**, when the box was split off the four time spans so a caller could bring its own well set), and it also shows the `-mt-2` / `pt-2` pair that moves a well's own `gap-2` INSIDE the animated box (a permanent zero-height flex child would otherwise leave a collapsed section 8px taller than it was). 🔒 ⚠ **THAT `pt-2` IS CONDITIONAL ON THERE BEING A BODY (2026-09-15), AND THE REASON IS `box-sizing: border-box`: a padded box CANNOT BE SHORTER THAN ITS OWN PADDING.** An empty column — a section rendered with no rows, or one whose rows are unmounted behind a closed header — therefore still stood 8px inside a zero track and hung a dead band under the heading, which is Samuel's *"when the gray box is retracted, the text isn't vertically centered"*: 12px of padding above the label and 20px below it. **Padding belongs to the content it separates; with no content there is none**, and the collapsed box is padding + header + padding with the header in the same place it holds when open. |
| `.crossfade`     | THE content swap: `opacity` 150ms each way, `[data-out]` is the way out. Recipe only — layout belongs to the consumer, because a swap happens in panes and in columns alike. Driven by `Crossfade` (below); coupled to its `FADE_MS` and to the `prefers-reduced-motion` block that drops both. |
| `.seg-track`     | Flat pill track for `SegmentedControl variant="track"`. Not `.concave-track` (that one is pressed-in and hosts tab pills); this is a page-header selector and its FILL comes from the consumer's `bg-*` token utility — the value in the kit is only a fallback. Active option stays `.raised-tab`. ⚠ Its fill is `--seg-fill` — the same gray the trackless pills wear, so the page-header selector and the info column's switcher cannot drift (2026-08-25). ⚠ Its 3px pad is arithmetic, not taste: at `size="lg"` it turns 30px options into the 36px control height the header's other controls share, and it does not scale with them — under 3px a track stops reading as a track. |
| `.kanban-card`   | White card floating inside a flat inset lane — the ontology board's column header card and every object card. ONE class, three states: resting hairline elevation, a shallow hover lift, and a highlight ring on `data-selected="true"`. Sets border COLOR + shadow only; radius/border-width/`bg-bg-elevated`/layout stay in the component. Flatter than `.bento` and `.graph-node` on purpose — these sit on an inset lane, not on the page surface. |

Composition pattern (CSS modules welcome for layout, recipes come from kit):

```tsx
<div className={cn("page-float", styles.shell)}>         // page surface
<div className={cn("concave-field", styles.search)}>     // search well
<div className={cn("concave-track", styles.tabs)}>       // tab track
<span className={cn("raised-tab", styles.tabThumb)}>     // sliding active thumb
<button className={cn(styles.toggle, on ? "raised-tab" : "bg-bg-elevated")}>  // selected chrome
```

Shared React primitives (`src/shared/ui` + `src/shared/hooks`):

| Primitive | Use |
| --------- | --- |
| `Popover` / `MenuItem` / `MenuDivider` (`popover-menu.tsx`) | ALL dropdowns/kebabs/filter/context menus. Trigger-anchored by default; pass `at={{x,y}}` for portal/cursor-positioned menus (viewport-clamped). `MenuItem` takes `icon` + `destructive`; `MenuDivider` is the section rule (a `border-t` on a group wrapper runs into the card's corner radius). Never hand-roll the backdrop/Escape/clamp pattern. Wears the kit's `.menu-card`/`.menu-row`, so a consumer's `className` is for WIDTH, not for the surface. The card outlives `open` by 140ms to play its exit — while it does it carries no `role` and is `inert`, so a dismissed menu leaves the a11y tree and the tab order immediately; `prefers-reduced-motion` skips the phase. |
| `SelectMenu` (`select-menu.tsx`) | Pick ONE value from a small fixed set where each option needs a plain-words second line — anywhere a native `<select>` would go. Composes `Popover` in COORDINATE mode (these sit in scrolling, overflow-clipping panes where an anchored panel is a clipped sliver). **THREE trigger faces, and each owns its WHOLE face** (`select-menu.tsx › TRIGGER_FACE`): `variant="flat"` (default) is the inset pill for settings rows; `variant="raised"` (2026-08-27) is `.auth-btn-3d-light` at the 36px control height — THE dropdown inside a `StandardDialog`; `variant="raisedField"` (the 1.22.0 wave) is **a SIZE of `raised`, not a fork** — the same `.auth-btn-3d-light`, boxed to `h-6`/`text-small` for the composer panels' Template and Model rows, because a `h-9` trigger inside a `py-2.5` field card makes that one row ~56px against ~40px neighbours and a form whose rows are two heights reads as broken alignment rather than as two kinds of control. ⚠ They do not compose: `flat`'s `hover:bg-surface-raised-2` would flatten the raised gradient, and font size/padding live in the variant so a caller's `className` never fights them in Tailwind's emit order. ⚠ This row said **"Two trigger faces"** until 2026-08-30 — **a doc defect the wave that minted the third introduced**, whose rationale was written into the code and never reached here. ⚠ **AND IT OMITTED `variant="text"` ENTIRELY UNTIL 2026-09-13 — the same defect a third time, over the face that is now on every settings row.** It is the SETTINGS-ROW face (Samuel, 2026-09-06: *"the dropdowns aren't pills anymore but just the text and an arrow"*): no border, no fill, no underline, REGULAR weight (unbolded and un-underlined 2026-09-10), so the CHEVRON is the only standing hint of a menu and may not be dropped. **Its hover is `--menu-item-hover-bg`** (Samuel, 2026-09-13: *"when I hover over the dropdowns in the agent settings, it should have a gray highlight. Anything that can be clicked"*) — the row above's ONE hover gray, with `rounded-md -mx-1.5 px-1.5` so the highlight wraps the value WITHOUT moving it (these triggers sit in a right-aligned settings cell) and `disabled:hover:bg-transparent` so an inert control does not light up. Pinned by `shared/ui/select-menu-face.test.tsx`. It reaches every settings row on both channel Settings faces, the thread Mode row, the ontology attribute/template editors and /home's Usage month filter — `grep -rn 'variant="text"' src apps`. |
| `SettingRow` / `SettingDivider` (`channels/components/settings-agent-rows.tsx`) | **ONE SETTING ON THE SETTINGS TAB, AND THE HAIRLINE ABOVE IT** — a NAME, its eye (`settings-help.tsx`), and one control right-aligned on the same line (the 380px panel is why they share a line). ⚠ **THE LINE IS `bits.tsx › MetaRowDivider`, BY IMPORT** (Samuel, 2026-09-13: *"in between each setting, add a horizontal line, like how we have in the channel info area"* — the Info tab's own rule between `MetaRow`s). **Never a hand-cut `border-t`:** one recipe, so the two panels in one column cannot separate their rows at two insets. ⚠ **EVERY ROW DRAWS ITS OWN LEADING LINE AND `first:hidden` KEEPS IT OFF THE TOP OF A GROUP** — half these rows are gated on a desktop bridge, so WHICH row is first is a render-time fact and a static flag would be wrong on exactly the machines that render fewest rows. `always` is the opt-out, for a group that CONTINUES the column above it (the responder row). ⚠ **A GROUP'S CONTAINER MUST SHARE THE PADDING OF THE COLUMN IT CONTINUES** (`px-3.5`): the line is inset `mx-2` inside its container, so a narrower group draws the same rule wider. Pinned as a MEASUREMENT by `channels/components/settings-dividers.test.tsx` — `lines === rows - 1` over `data-settings-row` / `data-settings-divider`, on the channel face AND the thread face. |
| `OpenScaleButton` / `OPEN_SCALE_ICON` (`open-scale-button.tsx`) | **THE SMALL PILL BUTTON (2026-08-28, Samuel)** — `--action-h-sm` (**30px since 2026-09-08**, Samuel; the token is declared in `src/app/globals.css` and mirrored in `apps/desktop-ui/src/styles/tokens.css`, gated by `scripts/check-css-token-drift.ts`, and `channels/components/composer.tsx`'s Launch / Discard read the same one, ⚠ the composer's TOOLBAR GLYPHS read it for ONE LOOK on 2026-09-08 and went BACK to the 24px `h-6 w-6` face the same hour (`channels/components/composer-toolbar.tsx › TOOLBAR_ICON`, glyph 15; Samuel: *"decrease it back to its original size, but keep the icon on the right"*) — only that trial's ORDER (Discard · Dictate · Send) survives. ⚠ **`send-button.tsx` STILL WRITES `h-[30px]` AND HAS NOT ADOPTED THE TOKEN** — the two agree at today's value and would part the day the scale moves; open question, not a claim that they share a declaration) — three faces, one height), `.btn-light` face, stadium ends, `text-small` 500, 12px side pad, 5px gap. It was the knowledge card's Open button and nothing else (`knowledge-v2.module.css › .cardOpen`, now DELETED) until Samuel ruled that every /home button wearing the old hand-written `h-6 … px-2.5 text-caption` recipe adopts that face. Callers: `knowledge-v2/home/base-card.tsx` (the card's own Open — it renders this, it does not restate it), and /home's four small buttons — `pages/home/panel-buttons.tsx › CreateButton` (both tabs' section headers, one component since the two panels each declared a byte-identical copy), `pages/home/agent-share.tsx › ShareIntoChannelButton` (it was the deleted copy dialog's `UseInThisChannelButton` until B15 replaced the copy with a grant), and the Agents section's retry. ⚠ **It is the FACE and the SCALE, nothing else** — behavioural states stay with the caller through `className` (each converted button kept its own `disabled:opacity-60`), and the glyph is the caller's, sized with `OPEN_SCALE_ICON` rather than a re-typed 12. ⚠ Its colour reads `var(--kv-text, var(--text-primary))`: inside a knowledge surface the alias is bound, on a /home section header there is no `--kv-*` scope and an unbound `var()` would silently inherit the row's ink. Pinned by `pages/home/panel-buttons.test.tsx`, which compares the RENDERED classes of the card's Open and /home's buttons and scans `pages/home` for a returning `h-6`. **Two more callers since 2026-08-28**, both in the opened knowledge base: the folder tree's New file / New folder (`knowledge-v2/list/tree-rows.tsx › AddRow`, replacing a module-private `.addBtn` hover tint). ⚠ **AND THOSE TWO BOUGHT THE FACE ITS `white-space: nowrap` + `flex-shrink: 0`** (Samuel's live review the same day: "New file" rendered as "New / file"). The pill is a FIXED `--action-h-sm`, so a wrapped label is a second line drawn OUTSIDE the button's own face; nowrap without `flex-shrink: 0` only converts the wrap into a clip. It survived four callers because every label was ONE WORD — the first multi-word one in a narrow column exposed it. A parent that cannot fit two pills wraps the ROW (`knowledge-v2.module.css › .addRow`), never the pill. Pinned in `src/shared/ui/open-scale-button.test.tsx`. ⚠ **THE CHANNELS CARD ACTION CAME DOWN TO THIS SCALE ON 2026-09-08 BUT DOES NOT WEAR THIS FACE** (Samuel: *"make the open button a little thinner, like we have another button UI … Make sure this applies across the entire product"*, then the same day *"just have it be the word open as the button"*) — `channels/components/bits.tsx › CARD_BUTTON` was a hand-written `h-9 px-[15px] text-small font-medium` string, briefly composed this pill, and is now `cn(SMALL_TEXT_BUTTON, …)`: the same `--action-h-sm` height, no `.btn-light` elevation, ink only. So the Threads tab's Open/Viewing, the Agents tab's Open/Viewing, the posted request card's Open thread, the Knowledge tab's Open + retry and the entry pane's Edit/Cancel all moved from 36px to 30px in one edit. The CSS module is imported in `open-scale-button.tsx` and nowhere else. The 36px scale is `bits.tsx › TAB_ACTION`'s alone now. |
| `OpenScaleIconButton` / `OPEN_SCALE_ICON_ONLY` (same file) | **THE SAME PILL, GLYPH ONLY (2026-08-28)** — `.openScale` plus `.openScaleIcon`, which drops the pad and the gap and pins the width at 26px. ⚠ **NOT 1:1 SINCE 2026-09-08**: the pill's height moved to `--action-h-sm` (30px) and this width did not, so the box is 26×30 — Samuel ruled the small ACTION height, not the toolbar glyph, and both the CSS rule and the component docblock carry the open question. NOT a second face: it composes the identical rule, so an edit to the pill's height, radius, elevation or ink reaches both shapes. `aria-label` is REQUIRED by the type — a control with no text has no other name. Its glyph is 14, not `OPEN_SCALE_ICON`'s 12, because it is alone in the pill rather than sized against a label. Callers: the knowledge base header's download / settings / delete and the folder rail's collapse toggle. ⚠ **It exists because a file-private `ICON_BTN` string did** — a bare 28px hover tint, one of SIX such declarations in `src/` (re-measure: `grep -rn "ICON_BTN" src apps`). The other five are untouched debt, **F-345**; do not add a seventh. |
| `AgentName` (`channels/components/agent-rename.tsx`) | **THE AGENT'S NAME ON A CARD, AND NO ID ANYWHERE BESIDE IT (Samuel, 2026-09-15).** The title is `text-body font-semibold text-text-primary`, click-to-rename behind a hover pencil. ⚠ **A `discriminator` PROP RENDERED A MUTED `font-mono text-micro text-text-muted` `#<agentId>` FOR PART OF THAT DAY AND IS DELETED**: it tie-broke two own-agent cards wearing one face, and his second ruling removed the case rather than the display — no two ADDRESSABLE agents in a channel can share a name, because the second is stored `Coder-1` (`dopl-desktop-app/main/agent-name-unique.js`). ⚠ **ENDED agents may share a name and are shown unsuffixed on purpose** — nothing is being chosen between, and an id on a finished run is the leak the wave removed. ⚠ An agent with no name of its own reads `New Agent` (`shared/lib/agent-name.ts`, INVARIANTS §11); the suffix, where there is one, IS part of the name and is edited with it. |
| `Avatar` (`avatar.tsx`) | Profile pictures with neutral initials fallback. No gradients — identity color belongs to teams. |
| `AvatarStack` (`avatar-stack.tsx`) | Overlapping faces for "who else is in here". ⚠ **THE OVERFLOW CHIP COUNTS WHAT IS HIDDEN, NOT THE TOTAL** — `+2` beside three faces means five people; a caller wanting the total says it in text beside the stack. Dedupe and ORDER are the caller's job. ⚠ **`xs`/`sm`/`md` ARE `avatar.tsx › SIZE`'s OWN KEYS AND PIXELS**, because a stack and a lone `Avatar` share rows in the same list and a stack one step off changes a row's height when a second person joins. **`2xs` (20px) IS THE ONE EXCEPTION AND HAS NO `Avatar` TWIN ON PURPOSE (2026-09-13)** — it exists for /home's channel row second line, beside an 18px badge under a `text-body` title, on a row whose height Samuel fixed; nothing renders a lone avatar on that line. **Do not add 20px to `avatar.tsx` to "match"**, and do not shrink a stack by selecting on its internal `h-6`/`w-6` utilities. The overlap (`-space-x-*`) lives in that same size map, so a new size cannot forget one. |
| `MentionBadge` / `UnreadDot` (`apps/desktop-ui/src/pages/home/channel-row-marks.tsx`) | /home's channel-row UNREAD MARKS (Samuel, 2026-09-13): an **`@ N` pill** — `bg-surface-cta` + `text-text-on-cta`, `text-micro font-medium`, 18px, `rounded-full`, the same token pair `PAGE_ACTION_BTN` wears — and a 6px `bg-text-primary` **dot**. ⚠ **THE PILL IS HIDDEN AT ZERO**, never an inked `@ 0`, and **the two are EXCLUSIVE**: the pill already says the louder version of what the dot says. ⚠ **A NUMERIC badge is legitimate here ONLY because a real count backs it** (`HomeChannel.unreadMentions`); the channels sidebar deliberately has none, since `Channel.unread` is a BOOLEAN and inventing a number for it is forbidden (`channels/components/sidebar-rows.tsx`). ⚠ The dot is `bg-text-primary`, not the sidebar's `bg-link`: /home's account palette has ink for its only accent. Same file holds `HOME_CARD_FACE`, the raised card face the channel rows AND the header's "{Name}'s Home" bar share. |
| `AvatarWithPresence` (`avatar-with-presence.tsx`) | `Avatar` wrapped in a presence ring — `ring-success` online / `ring-text-disabled` offline, floated off the avatar by a transparent `p-0.5` gap so it reads on any surface. Prefer over a standalone presence dot wherever an avatar is shown. |
| `InfoResizeHandle` (`channels/components/info-resize-handle.tsx`) | **THE DRAG HANDLE ON A COLUMN DIVIDER (Samuel, 2026-09-13: *"a vertical black line … a little thick, rounded at the edges, and centered. If I hover over it, it should show the left and right arrows"*)** — a `w-1 h-10 rounded-full bg-text-primary` pill centred on the rule, flanked on HOVER-or-FOCUS-or-DRAG by 12px `ChevronLeft`/`ChevronRight` in `text-text-secondary`, over an INVISIBLE `w-3` `cursor-col-resize` strip. ⚠ **THE WRAPPER IS `w-0`**, so the handle is a zero-width flex sibling and the row's box math does not move — and it sits OUTSIDE `.channel-info-slide`, whose `overflow: hidden` would clip the left half of a centred pill. ⚠ **`z-[2]` IS BETWEEN TWO EXISTING LAYERS**: above the info column (`z-index: 1`) and below the agent overlay (`z-20`), which covers the column this would resize. ⚠ **HOVER IS REACT STATE, NOT `group-hover:`** — the arrows are a fact in the DOM, which is what lets `info-resize-handle.test.tsx` assert the behaviour instead of reading a class back as a string. ⚠ **THE PILL'S CENTRE IS THE LINE'S CENTRE, WHICH IS HALF A BORDER RIGHT OF THE COLUMN'S EDGE (Samuel, 2026-09-13: *"right now it's sitting to the left. I want it to be perfectly on the vertical line"*).** The wrapper is `w-0`, so `left-1/2` resolved to 0 — the divider's FIRST pixel, not its middle — and half the 4px pill sat on the transcript. The strip is now `left-[calc(var(--channel-divider-w,1px)/2)] -translate-x-1/2`. ⚠ **THE `1px` IS A FALLBACK, NOT THE WIDTH**: the divider is `channels/components/info-panel.tsx`'s `border-l border-border-default`, a kit hairline on the workspace channels page and **2px inside /home's record pane**, where `apps/desktop-ui/src/pages/home/home.module.css › .frame` widens that shape AND declares `--channel-divider-w: 2px` in the rule block beside it so the pair cannot drift (pinned: `pages/home/channel-divider.test.ts`). **A literal here is the bug.** The width itself, its two limits and the per-device memory are `channels/components/use-info-resize.ts`; this row is the FACE. ⚠ **ONE consumer and it is a SHARED surface** — `channels/components/channel-surface.tsx` renders it, so the workspace channels page and the desktop /home pane get it from one mount point (there is no third host of that surface). |
| `NAKED_ICON_BUTTON` / `NAKED_ICON` (`naked-icon-button.ts`) | **THE GLYPH WITH NO BUTTON FACE (Samuel, 2026-09-12: *"for the trash and X buttons, just have it be naked icons, no more button UI"*)** — muted ink, primary on hover, a hit area made of PADDING alone (`p-2` around a `NAKED_ICON` 14px glyph = 30px; the /home month stepper passes its own 18px glyph = 34px, since 2026-09-13 — the FACE is the constant, the glyph size is the caller's), no border/fill/shadow in any state. ⚠ **NOT `OpenScaleIconButton`**, which is the small `.btn-light` PILL holding a glyph; these are alternatives, never layers. ⚠ **A `.ts` CONSTANTS MODULE**: behavioural state (`disabled:`), layout and the REQUIRED `aria-label` stay with the caller, the same division `PAGE_ACTION_BTN` holds. ⚠ **IT WAS FILE-PRIVATE IN `ontology/components/object-panel.tsx` UNTIL 2026-09-13**, when /home's Usage month arrows became the second caller — **F-345 (the row above) forbids a seventh hand-written icon-button string by name**, so the second surface PROMOTED the first's constant rather than copying it. Callers: the object panel's trash + ✕, `pages/home/overview-usage-filter.tsx › MonthStepper`. |
| `SegmentedControl` (`segmented-control.tsx`) | ALL scope/filter tab rows AND page-header selectors. Never compose `.seg-pill`/`.seg-track`/`.raised-tab` tabs by hand. ⚠ **FOUR forms since 2026-09-08, not two** — `underline` (text only, the current option marked by a 2px ink rule; the channel info column) and `plain` (`pills` MINUS `.seg-pill`'s hairline — same `--seg-fill` gray, same `.raised-tab` selected face) both landed that day, `plain` for Samuel's popup-panel ruling: *"for the unselected items, just have it be a gray background, no additional gray borderline"*. ⚠ **AND A THIRD SIZE, `"md"` = `var(--action-h-sm)` / `text-caption`** — the 30px small-action scale the KB card's Open button and the channels composer's Launch/Discard already read, asked for by name (*"make the dimensions that of the 30px"*). Two option fields are optional: `hint` renders a muted suffix INSIDE the option button (🔒 it carries the template authorship marker into the accessible name — INVARIANTS §5A) and `ariaLabel` names the `role="tablist"` wherever a visible word labels the row from outside it. `variant="pills"` (default) is the TRACKLESS filter row — hug-width `.seg-pill` per option; `variant="track"` (2026-08-24, /home's Chat/Knowledge/Agents) puts them in one flat `.seg-track`, inactive options bare so only the selected face is raised, and takes the track's fill from the caller's `bg-*` utility. Active is `.raised-tab` in both. `size` is `"sm"` (the app-wide filter-row scale) or `"lg"` = **the app's 36px control height, `text-small`** — the landing nav's `.lp-menu-btn` at 6/7. Side pad differs by form and it is a WIDTH BUDGET, not taste: tracked takes 15px, trackless 12px, because the trackless `lg` row is the channel info column's four options with two count badges and 15px a side overflowed it at the 340px that column was when this was measured (it is 380px since 2026-08-25, so the budget now has headroom the value does not spend — 12px is also the ramp's own "compact buttons" step, which is why it stays) (landing measures 42/18/14px; same 3.0 height-to-text ratio, and 12px is the ramp's "compact buttons" step) — THE header control height, shared with the black `auth-btn-3d` CTA beside it. The two forms take different option heights to reach it (trackless the pill is the control at 36px; tracked it is 30px inside the 3px pad). |
| `SectionBox` (`section-box.tsx`) | Labelled section card, PRESSED IN (see Patterns below). |
| `SectionPanel` (`section-panel.tsx`) | THE FLAT labelled section — `SectionBox`'s opposite number, and the two are a real choice. No frame, **no header strip, no inset body, no resize grip**: a heading row (+ optional `action`), an optional one-line `caption`, then the content, all on ONE ground. ⚠ **It paints NOTHING** — fill/border come from the caller's `className`, which is the whole scoping story: a page states the ground it stands on without this module ever naming one, and a `tone="home"` prop here would turn a per-mount decision into an enum one autocomplete away from every page. (This read "`bg-home-panel` et al are /home-ONLY" until 2026-08-30; that scope is superseded — see the frame-palette note above — while the rule is not.) ⚠ It renders **`data-section-panel`** as a page-scoping hook (the `[data-composer-panel]` idiom): `/home`'s record pane repaints every panel inside it in ONE rule — `pages/home/home.module.css › .frame :global([data-section-panel])` — so the Knowledge and Agents tabs cannot diverge. ⚠ **`SECTION_PANEL_GROUND` (same file, 2026-08-28) is the DEFAULT ground for a WORKSPACE page** — `border border-border-subtle bg-home-panel`, the gray WELL, frame-model level 3: a workspace page renders inside `.pageCard`, the white card floating in the one gray panel, so a section panel drawn on it is exactly where /home's record-pane wells are and takes the same token. ⚠ It was `bg-card-surface-subtle` (#f4f6f9) until 2026-08-30 — the same colour said a second way, and 3/255 from `--home-panel`. The hairline stays here and /home's `.frame` rule clears it: that page's record pane is already a bounded card, a workspace page's is not. It is a default, not the component's face: `SectionPanel` still paints nothing, /home passes no ground at all, and a page palette selects itself by passing something else. It exists because that pair of utilities was typed inline in two features. Callers: `agent-templates/components/template-section.tsx › TemplatePanel` (the workspace Agents page), `pages/home/knowledge-panels.tsx` (2026-08-27, replacing `SectionBox`), and **the opened knowledge base's info face** — `knowledge-v2/detail/meta-card.tsx` (Details) and `knowledge-v2/detail/overview-contents.tsx` (Contents), 2026-08-28, which is where INVARIANTS §5A's recorded `SectionBox` divergence was resolved. ⚠ **`SECTION_PANEL_SHELL` (same file, 2026-09-13) is the OTHER half of the well — its radius and padding**, which this component applies for every caller whatever ground it is handed. It is exported so a surface that needs the WELL without this component composes the same box from two constants instead of measuring it: **`shared/ui/panel-well.ts › PANEL_WELL`**, this geometry (`› WELL_BOX`) plus `bg-home-panel` and **NO hairline** — ⚠ **and since 2026-09-15 that file has a SECOND fill on the SAME geometry, `› PANEL_WELL_ON_PANEL` (`--seg-fill`), for a well whose own ground is already `--home-panel`; the `Well` row below carries the ruling** — i.e. the /home Overview's usage well (`pages/home/overview-token-spend.tsx › TokenSpendPanel`) reached by import. ⚠ **THIS ROW SAID THAT WELL IS `SECTION_PANEL_GROUND` ON THIS GEOMETRY AND THAT WAS NEVER TRUE OF THE CODE** (corrected 2026-09-13, same day it was written): `SECTION_PANEL_GROUND` carries `border-border-subtle`, and Samuel had ruled the hairline off this well hours earlier (*"you're adding this extra border line around the gray. I did not ask for that"*). ⚠ **AND IT LIVED IN `ontology/components/panel-section.tsx` UNTIL THE AGENTS TAB TOOK THE SAME WELL** that afternoon (Samuel: *"I want us to apply that gray background on top of that Agents page"*). INVARIANTS §1 forbids `channels → ontology`, so the string moved to `shared/` and **`panel-section.tsx` RE-EXPORTS `PANEL_WELL` / `PANEL_ROWS`**, which is still the import path of record for `ontology/`. Readers: `ontology/components/panel-section.tsx › PanelSection` (the object panel's field sections) and `channels/components/collapse-wells.tsx › Well` (**the collapsible gray wells, THREE SURFACES THROUGH ONE MODULE** — `› agents-wells.tsx › AgentWells` for the Agents tab and `› threads-tab.tsx` for the Threads tab, both filed by `› recency-wells.tsx › wellFor` into the four time spans; and `pages/home/relationship-list.tsx` for /home's channel list since 2026-09-15) — re-derive with `grep -rn 'panel-well' src apps`. ⚠ **THAT COMPONENT HAS ONE SHAPE AND A `face` PROP THAT VARIES THE FILL ONLY (2026-09-15).** 🔒 A `variant="tab"` — the header lifted out into a hugging tab over a fully-rounded panel — shipped and was RETRACTED the same day by the person who asked for it (*"Okay, I actually don't like the tab look. Instead, let's just make it match the agents one directly … Just make the gray dropdowns match exactly those instead."*), together with its class strings and its folder-tab overlap. **Do not re-derive it from this row.** Every well is now the Agents tab's: one gray box, the header INSIDE it, full width, the same chevron and collapse. 🔒 ⚠ **WHAT SURVIVED THE RETRACTION IS THE SECOND FILL, AND IT IS NOT A SECOND LOOK — IT IS WHAT MAKES THE SAME LOOK VISIBLE** (Samuel, same day: *"there's no gray background on this at all"*). `PANEL_WELL` reads as *"that gray background right behind the white pane"* because every one of its readers is ON WHITE (a record pane, a workspace page card); /home's channel column stands on a `<main>` that is ITSELF `bg-home-panel` (`pages/home/index.tsx`), so the same class there is `#f1f3f5` on `#f1f3f5`. That column passes `face={PANEL_WELL_ON_PANEL}` — the same `WELL_BOX` geometry over `--seg-fill` (#e9eaec). ⚠ **THAT FILL IS MEASURED, NOT MINTED** — it is the one gray the app already draws ON `--home-panel`, on this very page: the /home header's selector is `SegmentedControl variant="plain"`, whose unselected pills are `bg-[var(--seg-fill)]` against that ground. `--bg-inset` (#f1f1f1) is 0/2/4 from the panel and `--card-surface-subtle` (#f4f6f9) is LIGHTER than it. **Do not mint a fourth gray for one box, and do not let `face` grow into a layout.** ⚠ **`showEmpty` (same day) DRAWS A WELL WITH NOTHING IN IT** — *"I want there to be something there, like the gray box. Basically, it will just be empty until the user actually puts something in it, but I still want it to be there."* It **defaults to `false`**, which is the Agents and Threads tabs' hide-when-empty rule unchanged; /home passes it because its three wells are the column's STRUCTURE. An empty well is the box, its header and an empty column — **no placeholder sentence** (minimal copy). | ⚠ **2026-09-13/14:** the `titleClassName` slot is DELETED; every section heading is `shared/ui/section-heading.ts › SECTION_HEADING_TEXT` (`text-display` semibold, normal case). Dialog titles (`standard-dialog.tsx › DIALOG_TITLE`) are that face + CSS `capitalize`; `DIALOG_TITLE_AS_TYPED` (`titleCase={false}`) is the named exception for titles that interpolate an operator-typed name (a base called "iPhone leads" must not become "IPhone Leads").
| **The /home credit bar** (`apps/desktop-ui/src/pages/home/overview-sections.tsx › CreditCapacityBar`) | **NOT A NEW RECIPE — it is `UsageMeter`, cloned from the billing surface (Samuel, 2026-09-01, as a CORRECTION).** The reference is `src/features/billing/components/billing-usage-pane.tsx › BillingUsagePane`'s "Usage this period" card: a `UsageMeter` whose label is WALLET-DERIVED since 2026-09-07 — **"Your credits"** on a seat, **"Personal credits"** on a home-space wallet, plain **"Credits"** when `credits.wallet` is null (an older cached payload) — over `used`/`limit`, with a `Resets {formatDate(periodEnd)}` line under it. ⚠ **THE /home BAR HAS NO LABEL AT ALL SINCE 2026-09-13** (Samuel, over the Usage block: *"for the usage credits, remove the credits and the 'Credits used' text"*) — it passes no `label`, which drops the SPAN and leaves the `used / limit` pair where it was; the histogram's `Credits used` heading went in the same ruling, replaced by the scope dropdown. It read plain **Credits** from the 2026-09-05 rename (from "MCP credits") until then, and only the billing pane's label is wallet-derived, because /home is always the reader's own home space. The pressed-in look is `.concave-track`, which is the whole point — ⚠ **an earlier pass APPROXIMATED it** with a hand-rolled track and an `.auth-btn-3d` fill, on the reasoning that /home forbids concave surfaces, and Samuel rejected that: **a design reference IS the spec, clone it exactly.** The no-concave sweep (`agent-templates/components/template-editor-surface.test.tsx › no concave surfaces`) now bans `UsageMeter` by name across /home and records this ONE file as the sanctioned exception, so the rule still binds every other surface there. ⚠ **THE OFFER IS THE PAGE'S BLACK BUTTON SINCE 2026-09-13, READING "Get more credits"** (Samuel, over the same bar: *"right where the full-length bar is, I need to change the upgrade button to be more like the new channel button, like the black background stuff. Change it to 'Upgrade' or change it to 'Get more credits'"*) — `pages/home/panel-buttons.tsx › PAGE_ACTION_BTN` **by import**, i.e. the "New channel" button's own 36px class list, BELOW THE BAR (moved from the top right the same day: *"It should be below the bar"*), under a **"Credit spend"** heading at the top of the card (`overview-panels.tsx › UsageCard`, in the Usage heading's own type). ⚠ The `"…credits spent"` sentence is DELETED (Samuel, 2026-09-13: *"remove that specific line"*); the caption row keeps "N left" and "Resets …" only of the bar's card. ⚠ **THE PREVIOUS SHAPE IS SUPERSEDED, NOT LAYERED:** from 2026-09-08 it was a one-word **Upgrade** TEXT action (`font-semibold text-text-primary`, hover underline) in the same `text-caption` row as "…credits spent" / "…left" / "Resets …", on the reasoning that INVARIANTS §5's minimal copy wants a word beside the numbers it is about. That word is gone; do not re-add it beside the button. The button still renders ONLY when the caller passes `onUpgrade`, which `overview-panels.tsx › CreditsBar` does only on a NON-PAID home container — so the bar never has to know what a plan is. It calls `pages/home/home-settings-control.tsx › openHomeSettings("billing")`, a one-slot module registry rather than a prop drilled through the page (that page measured 499 lines against the 500-line cap on the day this landed — `wc -l` it before repeating the number). |
| `UsageMeter` (`usage-meter.tsx`) | THE "used / limit" bar — label row + `.concave-track` well + a bare `h-1.5 rounded-full` fill with an inline width %. ⚠ **`label` IS OPTIONAL SINCE 2026-09-13 AND EXACTLY ONE CALLER OMITS IT** (the /home credit bar — Samuel had the noun removed; the row above carries the ruling). Omitting it drops the SPAN, not the row: the number stays right-aligned above the track. A meter on a surface that does not already say what is being measured must still label itself. The only progress-bar recipe; it was module-private in the billing pane until a second meter (Credits) needed it, and the billing page's Usage tab is the third caller. **`over` is a verdict the CALLER passes**, not `used >= limit` arithmetic — an entitlement gate decides it. `tone` picks the fill: `"cta"` (default) is the flat CTA ink; `"ramp"` colours it by how full (<50 success / <75 caution / <90 warning / else danger, bands module-private) — for meters that get GLANCED at rather than read (`knowledge-v2/storage-meter.tsx` is the only one). Never hand-roll `.concave-track` + a fill. |
| `BarSeries` / `PLOT_HEIGHT_CLASS` (`apps/desktop-ui/src/components/charts/bar-series.tsx`) | **THE bar histogram (2026-09-01)** — labelled Y axis, gridlines on round numbers, one bar per bin, the newest bar inked `bg-surface-cta`. 🔒 **PIXEL-MIRRORED ONTO SAMUEL'S REFERENCE CHART ON 2026-09-08** (*"our bars are too thick/wide … their bars are not transparent … i like the slanted dates, it makes it able to fit. we should be able to fit 30 days … their font colors are black not gray"*), and the four rulings are ONE picture, not a menu: (1) a bar fills **80% of its slot** (`BAR_SLOT_RATIO`) and the gaps share the other 20% — stated in **container-query units** (`cqw`) off the plot column, NOT measured with a `ResizeObserver`, so the bar's width and its floor are the same number by construction instead of one re-derived from the other a frame late; (2) the fill is **`bg-chart-bar`, solid** — the alpha `surface-raised-4` it wore is what "transparent" named; (3) a bar is **never shorter than it is wide** (`min-height: min(<width>cqw, `PILL_FLOOR_CAP`)`), which is what makes `rounded-full` a stadium PILL at both ends rather than the dot a proportional radius used to collapse a near-zero bar into — ⚠ the cap is load-bearing, because the bin count is not fixed and a 7-bin plot would otherwise stand every empty day up as a ~95px slab; (4) **EVERY bin is captioned**, rotated **−45° about its top-right corner** and absolutely positioned by `right` so the anchor lands on its own BAR'S CENTRE. ⚠ **`labelEvery` IS GONE, and both callers lost their divisor with it** (`ActivityChart`'s `LABEL_EVERY`, `UsageChart`'s `labelEveryFor`) — it existed because 31 horizontal `31/12`s did not fit, and the slant is what bought the other 30. Slanted captions are parallel lines whose spacing is the SLOT's, not the text's, so label width stopped mattering; they crowd only under ~13.5px of slot, i.e. a **420px** plot (`THIN_CAPTIONS_BELOW`, a CONTAINER query — **no caller reaches it**, the SPA window's floor is 960px and the tighter plot, the workspace Overview's, is ~530px there). ⚠ **INK, NOT GRAY**: both axes and both cards' headings and period totals are `text-text-primary` now; the inked day is separated by `font-medium`, because the colour it used to be separated by is now everyone's. ⚠ **EXTRACTED FROM `pages/overview/activity-chart.tsx`, NOT WRITTEN BESIDE IT**, when /home's Overview face needed the same picture over a different series: a second `niceCeiling` is a second axis ladder one retune away from disagreeing with the first. What stayed in `ActivityChart` is the CARD — heading, period total, metric switcher — because those are that page's copy; `BarSeries` renders a plot and owns no words, which is why the reference's header row is the CALLERS' and not this component's. `highlightKey` names the inked bin and defaults to the LAST point, which is today in both callers. ⚠ **PLAIN DIVS, NO CHART LIBRARY, AND THAT IS A STANDING DECISION**: ~31 bars on a fixed axis is layout, and a dependency here would arrive with its own colours and type scale to fight the tokens. Callers: `pages/overview/activity-chart.tsx`, `pages/home/overview-sections.tsx › UsageChart`. ⚠ `PLOT_HEIGHT_CLASS` is EXPORTED so `overview-skeleton.tsx` imports the height instead of re-typing it (DRIFT-LEDGER P9's example of a claim-by-reference nothing enforced); pinned in `components/skeletons/page-skeletons.test.tsx`. The geometry rulings are pinned in `components/charts/bar-series.test.tsx`. |
| `Crossfade` (`crossfade.tsx`) | ONE surface whose CONTENTS change: fade out, replace, fade in, with the frame and the driving control staying put (/home's record pane switching conversations; the channel info column switching tabs). ⚠ Takes a RENDER FUNCTION and hands back the token still ON SCREEN — React swaps `children` instantly, so fading live children fades out the thing you just picked. Props for the token already shown pass through unfaded: only a token CHANGE is a swap. ⚠ The outgoing subtree stays mounted for the fade — not for teardowns that must be immediate. Tests that click and assert must `findBy`, not `getBy`. **Third caller since 2026-08-28: the opened knowledge base's detail column** (`knowledge-v2/detail/detail-panel.tsx`), swapping the base's INFO face for an open file. ⚠ **That one shows what "the outgoing view is a pure function of the token" costs a caller**: the entry BODY belongs to the current selection and is already `null` by the time the old face fades, so the pane latches the last fully-loaded entry and consults it only when the shown token names it. A caller whose face needs data the parent has already moved on from must hold that data itself. |
| `EmptyState` (`empty-state.tsx`) | Centered icon + title + description placeholder for empty panes. |
| `SearchField` (`search-field.tsx`) | Search-icon + concave-field input well (`sm`/`md`). Never inline the recipe. |
| `Switch` (`switch.tsx`) | Boolean toggles (concave track, raised thumb). |
| `Skeleton` / `SkeletonBar` (`skeleton.tsx`) | Loading placeholders — `animate-pulse` on `surface-raised-2`. No local `Bar` clones. Composed shapes live in the same file and every loading surface uses one: `SkeletonLine`/`SkeletonText`/`SkeletonRow` (atoms), `TwoPaneListSkeleton` (list+detail pages — knowledge/chats/skills/members/channels; takes `detail` to swap the right pane), `DetailPaneSkeleton`/`DetailDocSkeleton` (right pane), `TranscriptSkeleton` (message columns), `PageShellSkeleton` (single-surface pages; what the desktop `PageLoading` renders). ⚠ **ONLY THE TWO PAGE-LEVEL COMPOSITES CARRY `role="status"` + `aria-busy` + an `sr-only` label — `TwoPaneListSkeleton` and `PageShellSkeleton`** (measured 2026-08-25: `grep -n 'role="status"' src/shared/ui/skeleton.tsx`). The shimmer is `aria-hidden`, so a composite without them announces NOTHING, and the three that lack them are a live gap, not a licence — REFACTOR-FINDINGS **F-318**. New page-level loading states take the trio; do not hand-roll a wrapper at the call site. **No text loaders**: "Loading…" as visible copy is not a loading state. |
| `PENDING_ROW` / `pendingRow()` / `PendingRow` (`pending.ts`) | An OPTIMISTIC row awaiting the server: the real content, dimmed (`opacity-60`) and inert (`pointer-events-none`), carrying `data-pending`. **Not a skeleton** — a skeleton says "no content yet", and a pending row has the content; what it lacks is a commit. Compose it over the row's own classes (`{...pendingRow(isPending, "rounded-[10px] border …")}`), never restyle the surface. |
| `CopyButton` (`copy-button.tsx`) + `useCopyToClipboard` (hook) | Copy-to-clipboard. Icon-button case = `CopyButton`; custom chrome keeps its JSX and uses the hook. |
| `ScopeSharePopover` / `ScopeShareMenu` (`scope-share-popover.tsx`) | The private/team/workspace sharing control (chats + skills wrap it). |
| `ConfirmDialog` (`confirm-dialog.tsx`) | In-app confirmations. |
| `StandardDialog` / `DialogField` / `DialogActions` + `DIALOG_TITLE` / `DIALOG_BTN_PRIMARY` / `DIALOG_BTN_SECONDARY` (`standard-dialog.tsx`) | **THE create/edit dialog (2026-08-27, Samuel).** ONE width (`ModalShell size="narrow"`, `min(92vw, 640px)` — **not a prop**), ONE heading (`text-title` **centered + uppercase**, uppercased in CSS so `title` stays the `aria-label` every `getByRole("dialog", { name })` matches), ONE footer row (`leading` = the destructive slot, then a spacer, then the pair — **both fully rounded**). Body is `flex flex-col gap-4 p-6` and owns the scroll. `DialogField` is the uppercase `text-label` header + optional `normal-case` hint. The agent-template editor was the REFERENCE; New knowledge base and Add person (a Popover until then) were standardised onto it. ⚠ **/home's New channel LEFT this recipe on 2026-09-15** (Samuel: *"match it to the other pop ups UI, like the new agent pop up"*) — `apps/desktop-ui/src/pages/home/new-channel-dialog.tsx` composes `form-dialog.tsx › FormDialog` now, so it no longer wears `DialogField` / `RAISED_INPUT` / `DIALOG_BTN_*`. See the **Popup forms** conformance table. ⚠ **THERE ARE TWO "NEW CHANNEL" DIALOGS ON TWO RECIPES, and this row claimed one** (corrected 2026-08-30). The one the WORKSPACE channels page mounts — `src/features/channels/components/create-channel-dialog.tsx` — is a hand-rolled `ModalShell size="narrow"` and composes none of these primitives. Re-derive rather than trusting the sentence: `grep -rln StandardDialog src apps`. ⚠ Text controls inside it wear `RAISED_INPUT`, and dropdowns wear `SelectMenu variant="raised"` — never the flat inset pill. |
| `FormDialog` / `FormSection` / `UnderlineField` / `PillChoice` (`form-dialog.tsx`) | **THE POPUP FORM (2026-09-08, Samuel).** Composes `StandardDialog` into the bold-label / underline-field / 30px-pill / Discard+verb recipe. Rules, kit exports and the live conformance table: the **Popup forms** section below — stated ONCE there, not restated here. |
| `KnowledgeScopePicker` (`agent-templates/components/knowledge-scope-picker.tsx`) | **THE CHECKABLE TREE PICKER (2026-09-08, Samuel: *"i dont think a dropdown is the best way to do it"*).** Selected scopes as removable chips (`Base`, `Base / Folder`, `Base / Folder / Entry`), one **Add** button opening a `Popover` in COORDINATE mode holding a `role="tree"` — bases at the root, folders and entries lazily per base (`useKnowledgeTree`), a check glyph per row. Checking a base or a folder IMPLIES its subtree: descendants render checked and `aria-disabled`, and the set keeps ONE row. Arrows move focus, Space/Enter check, ArrowRight/Left expand. ⚠ It does NOT reuse `knowledge-v2/list/tree-rows.tsx`: that component's eight props are the base EDITOR's (create/rename/move/delete/download + an inline-edit context) and it has no checkbox mode — the rows here are ~40 lines and live in `› knowledge-scope-tree.tsx`. ⚠ `ChipMultiSelect` (`template-editor-rows.tsx`) is TEAMS-ONLY since this landed: a team set is flat, a knowledge set is a forest. |
| `FIELD_WELL` / `CHIP` / `RAISED_WELL` / `RAISED_INPUT` (`wells.ts`) | Class recipes for fields on section bodies: concave add-row well, raised pill chip, raised block field (inputs/code wells on inset), and the "pillow" text-control FACE (`RAISED_WELL` + type + placeholder ink + focus hairline) every standard-dialog input wears. Promoted from ontology-bits and (for `RAISED_INPUT`, 2026-08-27) from `agent-templates/components/template-editor-rows.tsx` — both re-export them. ⚠ `RAISED_INPUT` is the FACE; height/padding (`h-9 px-3`, `px-3 py-2`) belong to the caller. |
| `useApiQuery` (`use-api-query.ts`) | Every client GET hook (TanStack Query over `apiRequest`). `useApiGet` is gone (members pass migrated the last consumers). |
| `formatRelativeTime` / `formatDate` / `formatLastActive` (`shared/lib/format-time.ts`) | All timestamp display. No per-feature date formatters. |

## Popup forms

**Every dialog that COLLECTS INPUT is a `FormDialog`.** A dialog that only asks a yes/no question
stays `src/shared/ui/confirm-dialog.tsx › ConfirmDialog` — it has no fields, so it has nothing this
kit gives it. Menus and popovers are OUT OF SCOPE: they are not dialogs. Samuel ruled the kit on
2026-09-08, off the New agent popup: *"i want to start conforming all pop ups to the UI of the one
we just made, we should make a design system for this."*

The anatomy, top to bottom:

1. `StandardDialog`'s shell — ONE width, the uppercase title top-left of a close ×.
2. Stacked sections: a SEMI-BOLD label **above** its control, never beside it. The weight lives in
   `src/shared/ui/form-dialog.module.css`, never on a caller.
3. Text entry is the UNDERLINE — no box; a 1px `--border-strong` rule at rest, a 2px ink line
   sweeping in from the LEFT on focus. Reduced motion keeps the state and drops the sweep.
   ⚠ The active class is React state, not `:focus-within` — jsdom loads no stylesheet, so a pure-CSS
   rule cannot be pinned on a rendered tree.
4. A single choice is `src/shared/ui/segmented-control.tsx › SegmentedControl` at
   `variant="plain" size="md"` — 30px, REGULAR weight, gray fill, no hairline, one option
   preselected, an optional muted hint. A LIST of values is not this control (see the table's note).
5. The footer pair: a TEXT Discard on the left, the `auth-btn-3d` verb on the right, both at
   `--action-h-sm` (30px) and `rounded-[8px]`. ⚠ The 36px scale belongs to the PAGE button that
   OPENS a popup (`channels/components/bits.tsx › TAB_ACTION`); a dialog cut to it is the drift this kit
   exists to stop.
6. ONE exit: the ×, the backdrop, Escape and Discard are all `onDiscard`, and Discard CLEARS.

The kit: `src/shared/ui/form-dialog.tsx › FormDialog` (shell + footer) ·
`› FormSection` (label above control) · `› UnderlineField` (text, `multiline` swaps the element and
nothing else) · `› PillChoice` (the fixed `plain`/`md` row).

7. **A LONG-PROSE FIELD IS ONE ROW TALL AND GROWS WITH ITS OWN TEXT** — `UnderlineField`
   `multiline` at `minRows={1}`, over `form-dialog.module.css › .inputMultiline`'s
   `field-sizing: content` (Samuel, 2026-09-08 and again on 2026-09-13 over the New agent popup's
   **Instructions** field: *"don't make it like multiple lines as the default height. it will only
   increase in height if the user types more"*). ⚠ **NO MEASURING SCRIPT AND NO `useAutoGrow` ON A
   POPUP FORM** — the composer's mechanism exists because that card caps and scrolls its own body;
   here the CSS does it, capped at `40vh` so a pasted essay cannot push the footer off screen.
   ⚠ `minRows` IS A STARTING HEIGHT, NOT A MINIMUM MEANING: raising it is how a field announces it
   expects a paragraph, and the default of 1 is what makes it read as a line.

8. **THE LINE HAS THREE FACES AND THEY ARE RESTING STATES OF ONE RECIPE, NOT THREE FIELDS** —
   `form-dialog.module.css › .input` (the default: a 2px `--border-strong` rule at rest, as tall as
   its own text), `› .inputAction` (the same line in a 36px box, for a field sharing a row with a
   36px action — the two Descriptions, board header and object panel, Samuel 2026-09-10 and
   2026-09-14) and `› .inputQuiet` (**NO rule at rest**, for a field sitting in a dense ROW of cells
   — the object panel's attribute / relationship / action / template rows, Samuel 2026-09-14: *"I
   want to remove the gray underline, and have it so that the black underline only appears when a
   user clicks on a field item (vertical center the text also)"*). ⚠ **THE `::after` SWEEP IS THE
   SAME BLACK LINE IN ALL THREE** — only the RESTING rule differs, so "the line turns black when you
   click it" is one behaviour with one declaration. ⚠ `.inputQuiet` makes the resting border
   TRANSPARENT rather than dropping it, and pays back the 2px in `padding-top`, because a border
   that disappears takes 2px off the box and shifts every cell on the row against the dropdown
   beside it; the symmetric padding is also what makes an `items-center` row centre the TEXT rather
   than the box (the glyphs sat 1.5px high under `.input`'s 2px/3px+2px).

### Conformance — measured 2026-09-08

Re-derive rather than trusting the rows: `grep -rln 'FormDialog' src apps`.

| File | Class | Status |
| ---- | ----- | ------ |
| `agent-templates/components/template-approval.tsx` | CONFIRMATION | Done |
| `agent-templates/components/template-editor.tsx` | INPUT FORM | **Done** |
| `agent-templates/components/knowledge-scope-picker.tsx` | PICKER | Done (out of scope — a popover, not a dialog) |
| `agent-templates/components/template-editor-rows.tsx` | INPUT FORM ¶ | **Done** |
| `agent-templates/components/template-picker.tsx` | MENU | Done (out of scope) |
| `billing/components/billing-cancel-plan.tsx` | CONFIRMATION | Done |
| `billing/components/upgrade-modal.tsx` | CONFIRMATION | Done |
| `channels/components/agent-delete.tsx` | CONFIRMATION | Done |
| `channels/components/channel-manage.tsx` | CONFIRMATION | Done |
| `channels/components/launch-agent-dialog.tsx` | INPUT FORM | **Done** |
| `channels/components/new-thread-dialog.tsx` | INPUT FORM | **Done** |
| `channels/components/posture-warning.tsx` | CONFIRMATION | Done |
| `channels/components/settings-help.tsx` | MENU | Done (out of scope) |
| `channels/components/thread-manage.tsx` | CONFIRMATION | Done |
| `channels/components/create-channel-dialog.tsx` | INPUT FORM | Todo |
| `ontology/components/new-object-dialog.tsx` | INPUT FORM | **Done** (2026-09-11 — born on the kit) |
| `channels/components/direct-message-dialog.tsx` | INPUT FORM † | Todo |
| `channels/components/go-public-dialog.tsx` | CONFIRMATION | Done |
| `channels/components/invite-dialog.tsx` | CONFIRMATION | Done |
| `chats/components/detail-pane.tsx` | CONFIRMATION ‡ | Done |
| `chats/components/list-pane.tsx` | MENU ‡ | Done (out of scope) |
| `knowledge/components/base-settings-modal.tsx` | INPUT FORM | Todo |
| `knowledge/components/create-base-dialog.tsx` | INPUT FORM | Todo |
| `knowledge/components/delete-base-confirm.tsx` | CONFIRMATION | Done |
| `knowledge/components/knowledge-v2/knowledge-v2.tsx` | CONFIRMATION ‡ | Done |
| `revisions/components/changelog-list.tsx` | CONFIRMATION | Done |
| `knowledge/components/move-to-dialog.tsx` | INPUT FORM † | Todo |
| `members/components/create-team-dialog.tsx` | INPUT FORM | Todo |
| `members/components/invite-dialog.tsx` | INPUT FORM | Todo |
| `members/components/member-bits.tsx` | MENU | Done (out of scope) |
| `members/components/members-v2/member-facts.tsx` | MENU | Done (out of scope) |
| `members/components/members-v2/tab-settings.tsx` | CONFIRMATION | Done |
| `members/components/members-v2/team-detail-pane.tsx` | CONFIRMATION ‡ | Done |
| `ontology/components/delete-cluster-dialog.tsx` | CONFIRMATION | Done |
| `ontology/components/object-panel.tsx` | CONFIRMATION ‡ | Done |
| `skills/components/create-skill-dialog.tsx` | INPUT FORM | Todo |
| `apps/desktop-ui/src/pages/home/add-person-dialog.tsx` | CONFIRMATION § | Done |
| `apps/desktop-ui/src/pages/home/agent-share.tsx` | CONFIRMATION | Done |
| `apps/desktop-ui/src/pages/home/new-channel-dialog.tsx` | INPUT FORM | **Done** (2026-09-15) |
| `apps/desktop-ui/src/pages/home/ontology-share.tsx › OntologyShareDialog` | INPUT FORM † | **Done** |
| `apps/desktop-ui/src/pages/home/ontology-share.tsx › DeleteOntologyConfirm` | CONFIRMATION | Done |

Paths are under `src/features/` unless they start with `apps/`. **14 INPUT FORM (5 done), 20
CONFIRMATION, 5 MENU** — re-counted 2026-09-13, when Samuel's one-launch-surface ruling DELETED the
launch sheet rather than conforming it: its row was the table's oldest `Todo`, and its three jobs
are the New agent popup's Model row, its new **Instructions** field and this kit's own footer at the
30px scale (*"the buttons aren't the right size, the title is off too. The popup as a whole doesn't
match our popup UI"*). ⚠ **A `Todo` ROW CAN LEAVE THIS TABLE BY BEING DELETED, AND THAT IS THE
CHEAPEST CONFORMANCE THERE IS** — a second form for a lane that already has one is drift wearing a
checklist. It was 15/20/5 on 2026-09-09, when the home-ontology wave
added the two `ontology-share.tsx` dialogs (14/18/5 on 2026-09-08) and the CHANGELOG lane added the
restore confirm (19 CONFIRMATION earlier the same day). ⚠ The changelog's Restore is a
`ConfirmDialog` and NOT a `FormDialog`, which is this section's own first rule applied: it collects
no input, it asks a yes/no question, and it NAMES THE DATE of the version it would write back —
the one thing a person cannot re-derive from a list of near-identical rows. ⚠ The
share dialog is one `FormSection` per home channel, each holding THREE `PillChoice` rows (Members /
Guests / My agents) — the † case below, three times over — and its Save is `disabled` with a `hint`
when the server says `canManage` is false, which is rule 4 rather than an exception to it. The
delete confirm is a `ConfirmDialog` that NAMES the channels the ontology is lent into (spec Q4).

† A modal that collects a CHOICE and no text is still an input form; what it is not is a
`PillChoice`. That control is a SINGLE choice, and a roster the operator picks one of — or a list
they address several of — is a different payload wearing the same word. `channels/components/new-thread-dialog.tsx`
states the case: its addressees are removable `bits.tsx › AgentTargetPill`s under a `FormSection`
label, because `toUserIds` is plural.
‡ A PANE or a page, not a dialog. Classified by the popup it HOSTS, and it is on the row so a sweep
of this table does not read its absence as "no popups here".
§ Collects nothing — a copyable link on `StandardDialog`. Neither class fits; it needs no form.
¶ A dialog that is not a PAGE's — `template-editor.tsx`'s Add-field card, opened over the editor.
It is on the table because a `grep -rln 'FormDialog'` re-derive finds it, and a row that a sweep
finds but the table lacks reads as a miss. ⚠ **Its inline key/value ROWS stay `RAISED_INPUT`**: a
repeating list under one `FormSection` is not a popup form field, and the kit has no recipe for it.
The same is true of the editor's own Fields and Knowledge-bases rows.

Reference implementations: `src/features/knowledge/components/knowledge-v2/`
(CSS-module layout + kit recipes + `--kv-*` aliases onto global tokens) and
`src/features/ontology/components/` (utility-class styling on the same
tokens).


### The AGENT POST ACCENT — ONE framed pill and a side bar, and who does NOT get one (2026-09-14; one shape 2026-09-16)

Samuel's ruling (docs/specs/agent-colors.md; `channels/components/authored-row.tsx ›
AuthoredRowAccent`). ⚠ **It REPLACED the 2026-09-13 box** — a `rounded-[14px]` 2px frame with a
full-width coloured top bar holding the pill — in his words: *"instead of it being an entire box,
I want to change it to instead be a vertical bar … have the colored box, instead of this long
box, make it just around the pill, like a bordering, rounded to fit. and it's attached to a
vertical bar, that travels the length/amount of lines of the messages from that agent."*
**There is no frame, no top bar and no second row component** — the 2026-09-13
message-box-agent component is deleted: an agent's post is a person's post plus the two marks below.

- 🔒 **The frame** — `authored-row.tsx › ACCENT_FRAME`, a `border-[3px]` in the agent's colour on
  a WRAPPER around the attribution pill, **square and BORDERLESS on the side the bar is on**
  (`› ACCENT_FRAME_EDGE`). ⚠ **IT WAS A `ring-[3px]` UNTIL 2026-09-16 AND SAMUEL COUNTED THREE
  OBJECTS**: *"it looks like, the borderline, the badge, and the vertical line, are 3 different
  components, is it possible to make it a single component? Because here, you see that the lines
  overlap and cause it to be darker. And also, since the shadow is attached to the badge, it gets
  covered behind the borderline."* He was describing the geometry exactly — the bar's fill, the
  wrapper's ring laid ON TOP of it, and the PILL's own `.bento` hairline tinted by `bits.tsx ›
  agentAccent`. **THE OVERLAP IS WHY THE NEUTRAL FACE READ DARKER AT THE JOIN**: `--border-strong`
  is 12% black, so two translucent paints over one 3px band composited. Now the bar-side border is
  DROPPED and the bar IS that edge — no band is painted twice, and the 376c654f "one straight
  line" ruling is the result rather than a second constant. ⚠ **THE PILL DRAWS NOTHING**
  (`attribution-pill.tsx`'s `framed` prop drops `.bento` and `agentAccent` on an accented row), so
  there is ONE stroke; and because a border IS the outer edge, `--shadow-bento` falls from it into
  open air instead of under an opaque ring. 🔒 ⚠ **ITS TOP EDGE IS NOT PULLED UP, AND THAT IS THE COROLLARY OF DROPPING THE RING** — a ring
  wrapped the CORNER (it painted above the bar's top end as well as beside it), a three-sided
  border does not, so the frame's top stroke and the bar's top end must begin at the same y or the
  corner opens a 3px notch with the two marks offset diagonally. The frame is the content column's
  first child and the bar is `self-stretch` over the same box, so leaving the top margin alone is
  what aligns them; a `-mt-[3px]` "to keep the ring's layout" is the bug. The BOTTOM is still
  pulled (`-mb-[3px]`) because nothing has to meet there. The row is 3px taller at the top than it
  was and identical everywhere else. The colour is an inline `style` `borderColor`: a
  palette member chosen by a runtime key cannot be a Tailwind class.
- 🔒 **Its hover is the BLACK BUTTON'S** (Samuel, 2026-09-16: *"when I hover over like one of the
  black buttons, it translates up, and the shadow gets darker/larger. And that's what makes it
  clearly visible. Can we add the same functionality, when it translates up, it like has more
  shadowing?"*) — the existing 2px lift PLUS `--shadow-raised-hover`, which is
  `.auth-btn-3d:hover`'s own ambient drop pair **extracted to a token** (`globals.css`, mirrored in
  `tokens.css`) so that rule NAMES it and the two cannot drift to two hover weights. The button
  keeps its two INSET bevel lines, which mean nothing on a white capsule.
  ⚠ `transition-[transform,box-shadow]`, not `transition-transform`, or the shadow snaps while the
  lift animates; `motion-reduce` turns both off. ⚠ The motion is gated `has-[button:hover]`, so an
  INERT pill (the pop-out, the guest lane) does not animate.
- **The bar** — `w-[3px] self-stretch rounded-b-full`, the SAME colour, on the post's **OUTER**
  edge: right for a right-aligned post, left for a left-aligned one (*"For messages that are
  right aligned, this bar should sit to the right"*). `self-stretch` is the whole of *"travels
  the length"* — the bar is a flex item beside the content column, so the row's own height
  measures it. **The side is one class**, `mine ? "flex-row-reverse" : "flex-row"`, so the bar
  stays the article's FIRST DOM child either way and there is exactly one place to get it wrong.
  ⚠ **`rounded-b-full`, so the TOP end is SQUARE** (Samuel, 2026-09-14: *"where it connects
  with the bar, it should be a straight, not rounded"*) — the top is the end the pill's frame
  joins, and a cap there tapers to a point exactly where one colour must run into the other.
  Only the far end keeps a cap.
- **They JOIN, and that is two numbers that must move together.** The content column is inset from
  the bar by 8px (`pl-2`/`pr-2`) so prose never runs into it; the pill's wrapper takes an equal
  NEGATIVE margin on the same side, so the frame's box ends exactly at the bar's inner edge and its
  top and bottom strokes run out of the bar at the bar's own width. ⚠ **NOTHING IS PAINTED TWICE
  SINCE 2026-09-16** — this bullet described a 2px ring over a 3px bar, then a 3px ring over the
  same 3px bar, and BOTH were overlaps; the frame's bar-side border is dropped instead.
  ⚠ **3px IS ONE NUMBER, NOT TWO** — stroke width and bar width are the two halves of one line of
  colour and any difference reappears as a step; `agent-post-accent-face.test.tsx` pins them as a
  PAIR.
- **One post, one bar.** A run by one agent does NOT merge. A CONTINUATION row drops the pill (and
  the frame with it) exactly as a person's does, and still carries its own bar.
- **Ended → neutral.** `agent-box-rule.ts › AGENT_ACCENT_NEUTRAL` (`var(--border-strong)`), still
  a frame and a bar. The colour returns to the channel's bank when the session ends, but the post
  is still an agent's — and "white, no accent" is a rule about the AUTHOR (a person, or a
  channel-less MCP "Desktop agent"), never about liveness.
- **The pop-out did NOT follow.** `channels/components/agent-stream-sent-box.tsx › AGENT_BAR` is a
  full-width banner on a delivery RECORD with no side, no author and no pill to frame, so the
  framed-pill/side-bar language has nothing to attach to there. It keeps the agent's colour
  (ruling item 5) and its own geometry, which is why that constant now lives in that file rather
  than being imported from the transcript's side.
- **The dot** — `channels/components/agent-color-dot.tsx › AgentColorDot`, `size-2`, `aria-hidden`,
  drawn immediately before an agent's NAME on the Agents-tab cards and the EXPANDED pop-out rail
  rows. It renders NOTHING when there is no colour rather than a grey placeholder;
  the one surface that draws a grey dot is the transcript filter, where the row must
  stay aligned with its siblings.
- 🔒 **The disc** — same file, `› AgentColorInitial`, `size-5`: the COLLAPSED pop-out rail's mark,
  one agent's INITIAL inside a filled circle of that agent's colour (Samuel, 2026-09-15: *"I don't
  like that it just looks like letters on the black background because there's nothing around it.
  … Maybe it should be the color of the agents, so set a thing around it to that color."*). It
  **supersedes the "collapsed draws no dot" half of the 2026-09-13 ruling** without breaking it:
  there is still exactly one mark in the 36px tile, the letter just moved inside it. ⚠ **`size-5`
  is the palette's own circle step** (`agent-color-circles.tsx › CIRCLE`), and the ink is
  `--text-on-cta` — correct for the WHOLE bank by construction, because all sixteen
  `--agent-color-NN` values are `oklch(0.44 …)`, one lightness. ⚠ **`null` keeps the LETTER and
  drops the disc**, which is the opposite of the dot's rule and deliberately so: collapsed, that
  letter is the only thing identifying the row.
- **The filter** — `channels/components/transcript-filter.tsx`, immediately LEFT of the
  info-pane collapse toggle: **All** · **People** · one row per agent that has posted.
  "People" is the literal complement of the accent, so both it and the paint ask ONE
  predicate: `channels/components/agent-box-rule.ts › agentBoxOf`. ⚠ That file's NAME is
  history — the predicate is unchanged and was deliberately not renamed with the face.

## Patterns

- **Page shell**: page renders bare into the app shell (no `AppPanel`) and
  wraps itself in one `.page-float`. See both reference pages.
- **Section box**: 14px-radius `border-border-strong` card; header strip
  `bg-card-surface-subtle px-4 py-1.5` holding a `text-label` uppercase
  title; body `bg-bg-inset` with the concave inset shadow. Implemented as
  `SectionBox` in `src/shared/ui/section-box.tsx`; it also exports
  `SECTION_BOX_INSET` so sibling section patterns (e.g. the chats
  header-card disclosures) reuse the identical concave-body recipe.
  ⚠ **There are TWO section patterns and picking one is a decision.** The
  pressed-in `SectionBox` above is for a section READ AS A CONTAINER on a page
  surface. `SectionPanel` is the FLAT one: heading and content on a single
  ground, no frame and no strip, for a section that IS the surface — every
  panel on /home and the Agents page's scope panels. **A page that has ruled
  "nothing here is pressed in" takes the flat one** (/home and
  `features/agent-templates/**`, pinned by `template-editor.test.tsx › no
  concave surfaces`, whose `HOME_FILES` list only ever grows).
- **Changelog list** (2026-09-09): the day-grouped history list, ONE component for every surface
  that shows one — `src/features/revisions/components/changelog-list.tsx`, mounted by the base
  page's Changelog section, by an entry's own history, and (part 2, the same day) by the ontology
  object panel's **History** section and the /home ontology card's **Changelog** roll-up. **A
  second list would be two places for the day heading, the agent mark and the restore
  confirmation to drift.**
  - **DAY HEADING** — `h4`, `text-label` uppercase `text-text-muted`, one per UTC day key.
    ⚠ **It LABELS the key `revisions/lib/group.ts › groupByDay` produced and never re-derives a
    date from a row's stamp**, or the heading and the rows under it can disagree.
  - **TWO ROW SHAPES, ONE LIST, CHOSEN FROM THE PAYLOAD** (2026-09-09, part 2). A KNOWLEDGE row
    is a document snapshot and reads `who · what · path`; an ONTOLOGY row is ONE FIELD and reads
    **`Field: before → after`** — the label at `text-text-primary`, the old value at
    `text-text-muted line-through`, the new value plain, all inside one `truncate text-caption`
    span. ⚠ **The shape is chosen by `revisions/lib/field-format.ts › fieldLineOf`, i.e. by whether
    the payload HAS a `field` — never by `resourceType`**, because an ontology `create`/`delete`
    row is an `ontology_object` row too and carries a `{fields}` bundle instead; asking the type
    draws a line reading `undefined: — → —`. A bundle renders the op label plus the object's name,
    and expands to a `dt`/`dd` list at `text-caption`.
  - **ROW** — a full-width `button` at `px-1 py-1`, `rounded-md`, `hover:bg-surface-raised-1`,
    reading **`who · what · when`**: a 13px chevron that rotates on open, a 14px actor mark
    (`Bot` at `text-agent-on` for an agent, `User` at `text-text-muted` for a person — each with an
    `aria-label`), the actor name at `text-small text-text-primary`, the op + path at
    `text-caption text-text-secondary`, an agent's session name at `text-caption text-text-muted`,
    and the time pushed right with `ml-auto`.
  - **EXPANDED** — indented `pl-7`, holding the summary (when the row has one) and the word-level
    diff. **The diff's two washes are `bg-success/10` for an addition and `bg-danger/10` +
    `line-through` for a removal, taken BY REFERENCE from
    `skills/components/skill-history-panel.tsx › DiffCell`** so the app has one diff palette. Both
    keep `text-text-primary`: the diff is read as prose, not decoded as colour, and the
    strike-through is the second channel for a reader who cannot separate the two hues. The diff
    body scrolls inside its own `max-h-64 overflow-auto` on `bg-bg-inset` — a markdown body carries
    code blocks and long URLs and the page must never scroll sideways.
  - **RESTORE** — a text control in the expanded row, behind `ConfirmDialog` (see **Popup forms**:
    it collects nothing). ⚠ **The confirmation NAMES THE DATE**, because Restore over a list of
    near-identical rows is the one place a mis-click is invisible until the next read. ⚠ **AND ON
    AN ONTOLOGY ROW IT NAMES THE FIELD AND THE PRIOR VALUE** (2026-09-09, part 2) — title
    `Restore <Field>`, body `sets <Field> back to "<value>" as it stood on <date>. Other fields are
    untouched.` A per-field restore moves one property and leaves the rest alone, which is a
    different act from writing a whole document back, and the dialog is where a reader learns
    which one they are about to do. ⚠ **A revision with nothing to write back renders NO Restore at
    all** rather than a disabled one — a control that can only fail is worse than no control. What
    counts as "nothing" is `revisions/lib/restorable.ts › isRestorable`, THE SAME PREDICATE the
    server refuses on, so the button and the refusal cannot disagree: a knowledge row with no
    body, an ontology association, a create/delete bundle, and every cluster row.
  - **MINIMAL COPY.** Label and control; no explainer paragraph about what a revision is. Empty,
    loading and error states are one `text-caption text-text-muted` line each.
- **Pills/chips**: `rounded-full border border-border-strong` +
  `bg-bg-elevated` (raised, on inset bodies) or `bg-bg-inset` (flat, on
  cards), `text-caption`/`text-small` medium.
- **Row-level edit affordances** (2026-08-25, the Info tab's curated card).
  **No new kit class and no globals/`kit.css` change** — these are compositions
  of what is already here, recorded so the next one is not hand-rolled:
  - **Hover-only remove**: `IconButton` with `bare` (the naked-glyph idiom, no
    button face) inside a wrapper at `opacity-0
    group-hover/<name>:opacity-100 focus-within:opacity-100`. **`opacity`, not
    `hidden`** — the row must not reflow when the cursor arrives — and the
    `focus-within` half is not optional: a control reachable by Tab that stays
    invisible while focused is a trap. Reference: `channels/components/bits.tsx ›
    MetaRow`'s `onRemove`.
  - **Discreet add**: a ghost row at the END of a list, revealed by the
    SECTION's hover, not a button. ⚠ **Two stages, two elements**: presence
    (is the section hovered) is the WRAPPER's opacity; weight (is the cursor on
    me) is the inner control's ink. One node expressing both makes `hover:` and
    `group-hover/…` fight over one property, and which wins is Tailwind's emit
    order rather than a decision. Reference: `channels/components/info-card-rows.tsx ›
    InfoCardAddRow`.
  - **Inline editing is the UNDERLINE and nothing else** —
    `border-0 border-b border-text-primary bg-transparent p-0 outline-none`, at
    the same type as the text it replaces so the row does not change height
    between reading and editing. Enter and blur SAVE, Escape cancels. ⚠ A blur
    between two fields of the SAME row is not a blur: test `relatedTarget`
    against the row, or Tab commits and drops the caret. Reference:
    `channels/components/agent-rename.tsx` (the original) and `› info-card-rows.tsx ›
    InfoCardCustomRow`.
  - ⚠ **NAME THE HOVER GROUP** (`group/meta`, `group/infocard`). Rows inside an
    editable section already own one for their own ×; an anonymous `group`
    makes a row's hover reveal the section's control too.
