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
| `border-border-subtle/default/strong/highlight` | 6/8/12/16% black | hairlines, by emphasis   |
| `divide-border-subtle`                        | 6% black         | list dividers              |
| `bg-home-frame`                               | `#2f3542`        | THE APP FRAME — the dark slab behind shell root + surface + sidebar + account rail (darkened a notch 2026-08-25; scope widened to the workspace shell 2026-08-30) |
| `bg-home-panel`                               | `#f1f3f5`        | THE PANEL — `.page-float`'s fill, i.e. every full-page card in the app |
| `border-home-panel-line`                      | `#e2ecf0`        | THE PANEL LINE — `.page-float`'s 2px edge and the /home record pane's. ⚠ The header selector's track is `--seg-fill` now, so the token's `bg-` variant has NO consumer (`grep -rn 'bg-home-panel-line' src apps` is empty); only the `border-` utility is live. |
| `bg-home-card`                                | `#fbfcfc`        | THE CARD — the /home record pane's fill, one step warmer than the panel |

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
| `.auth-btn-3d`   | Raised black primary CTA. (`.auth-btn-3d-light` = white variant.) `.auth-btn-3d-light` is THE white-raised elevation reference: `.raised-tab` and the app-shell's `.brandPill` are the same face at other scales. **Since 2026-08-24 both are BUILT FROM `--raised-light-face` / `--raised-light-line` / `--raised-light-bevel` / `--raised-light-shadow`** (`:root`, tokens.css + globals.css), so the "one elevation" rule is enforced by construction rather than by matching two hex lists — and a scoped override can wear the face without forking the recipe (/home's sender pills do exactly that). Change the face in ONE place: the vars. |
| `.selected-ring` | THE selected face for a raised-light control (2026-08-24) — `--focus-line` hairline + `--focus-halo`, i.e. the signal the search pill wears while OPEN, held permanently instead of only while focused. Compose onto `.auth-btn-3d-light` (/home's conversation rows); it re-states itself on `:hover` so a pointer cannot wash the selection out. ⚠ Not a border of its own and not a fill swap — a selected row must stay the same KIND of thing as its neighbours. |
| `.menu-card` / `.menu-row` / `.menu-divider` | THE dropdown surface, its row face and its section rule (2026-08-15). Ported from the landing Menu dropdown — `src/features/marketing/marketing.css › .lp-nav-menu-card` / `.lp-nav-menu-item` / `.lp-nav-menu-divider` plus the `lpMenuIn`/`lpMenuOut` keyframes, replicated in the global layer as `menuCardIn`/`menuCardOut` (marketing.css is page-scoped and the app never loads it — edit both together). Card: 16px radius, 7px padding, white→`#f6f6f6` gradient, `#dcdcdc` hairline, top inset bevel + three drops, unfolding on a 7° `rotateX`. Row: 10px radius with a 1px hover lift and a pressed-in `:active`. **Only `Popover` composes these** — never hand-roll a menu surface. |
| `.graph-substrate` | Dotted world surface (24px pitch) behind a board or graph view and its skeleton. THE dot recipe — the ontology kanban board and its skeleton compose it (with `.kanban-substrate`); the retired Workflows tree is the other user (the Canvas page was deleted 2026-08-11). |
| `.kanban-substrate` | Modifier on `.graph-substrate` for the ontology board: halves the pitch to 12px so the board's geometry lands on the grid (288px lanes = 24 tiles, 12px gutter = 1, 24px board padding = 2), and `background-attachment: local` so the dots cover the whole scrollable area and travel with the lanes instead of staying pinned to the pane. Tiles originate at the scroller's padding edge — keep every board dimension a multiple of 12px and each lane edge stays on a grid line. |
| `.graph-node-lift` | Elevation applied to a graph card WHILE dragging (deeper shadow + grabbing cursor). |
| `.graph-port`    | Raised connector dot on a workflow step card edge; `data-active` = drag source, `data-target` = live drop target, `data-variant="output"` = inked source dot. |
| `.graph-node` / `.graph-node-selected` / `.graph-node-target` | Graph card resting / selected-ring / connect-drop-target surfaces. ⚠ **DEAD — ZERO consumers, measured 2026-08-30** (`grep -rn 'graph-node' src apps packages \| grep -v '\.css:'` → no hits). This row said *"only the Workflows cards are left"*; the Workflows page was **deleted 2026-08-11**, and the last caller went with it. Kept until a deliberate deletion pass, and named here so the next reader does not compose a group that paints nothing. ⚠ Do NOT take the substrates down with them: `.graph-substrate` / `.kanban-substrate` are live (the ontology board and its skeleton). |
| `.search-expand` / `-shell` / `-toggle` / `-input` | THE collapsing search: a 36px round button that GROWS to a 260px pill (2026-08-24, /home's header). Port of `src/features/marketing/marketing.css › .lp-nav-search*` scaled to 6/7 of the landing's own measurements (landing 42/300/42/42+16px pad/14px text → 36/260/36/36+14px pad/`text-small`). The RATIO is what is held: 42÷14 and 36÷12 are both 3.0, so it reads as the same control a notch down. Only colour comes from tokens. Same overlay trick (the slot stays one button wide, the shell is pinned `right: 0` and grows leftward, so no sibling moves) and the same delayed-in/instant-out input reveal. The shell composes `.auth-btn-3d-light` in the TSX and is never swapped for a field; while `[data-open]` its hover/press face is suppressed and only `.concave-field`'s FOCUS signal is borrowed. Marketing.css is page-scoped and the app never loads it — edit both together. |
| `.channel-info-slide` | The channels-v2 info column's slide shell (2026-08-24) — 0 ↔ **380px** on a 200ms width transition, `overflow: hidden`. WIDTH, not transform: the column is a flex sibling of the message pane, and a transform would slide it over the transcript instead of handing the space back. The panel inside keeps its own `w-[380px] shrink-0` so it never squashes mid-slide. ⚠ **380 IS A MATCH, NOT A TASTE (2026-08-25, Samuel): it is `channels-v2/agent-panel.tsx`'s `w-[380px]`**, and that panel is absolutely positioned against the SAME right edge — at 340 the divider jumped 40px sideways the moment an agent view opened. Change one and change the other. ⚠ Coupled to `channels-v2/use-info-slide.ts › useInfoSlide` (which holds `INFO_SLIDE_MS`; it stood in `channel-surface.tsx` until 2026-09-04, when the web's one-column layout took that file to the cap), which keeps the panel mounted one transition past close, and to the `prefers-reduced-motion` block that turns the transition off. |
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
| `SelectMenu` (`select-menu.tsx`) | Pick ONE value from a small fixed set where each option needs a plain-words second line — anywhere a native `<select>` would go. Composes `Popover` in COORDINATE mode (these sit in scrolling, overflow-clipping panes where an anchored panel is a clipped sliver). **THREE trigger faces, and each owns its WHOLE face** (`select-menu.tsx › TRIGGER_FACE`): `variant="flat"` (default) is the inset pill for settings rows; `variant="raised"` (2026-08-27) is `.auth-btn-3d-light` at the 36px control height — THE dropdown inside a `StandardDialog`; `variant="raisedField"` (the 1.22.0 wave) is **a SIZE of `raised`, not a fork** — the same `.auth-btn-3d-light`, boxed to `h-6`/`text-small` for the composer panels' Template and Model rows, because a `h-9` trigger inside a `py-2.5` field card makes that one row ~56px against ~40px neighbours and a form whose rows are two heights reads as broken alignment rather than as two kinds of control. ⚠ They do not compose: `flat`'s `hover:bg-surface-raised-2` would flatten the raised gradient, and font size/padding live in the variant so a caller's `className` never fights them in Tailwind's emit order. ⚠ This row said **"Two trigger faces"** until 2026-08-30 — **a doc defect the wave that minted the third introduced**, whose rationale was written into the code and never reached here. |
| `OpenScaleButton` / `OPEN_SCALE_ICON` (`open-scale-button.tsx`) | **THE SMALL PILL BUTTON (2026-08-28, Samuel)** — 26px, `.btn-light` face, stadium ends, `text-small` 500, 12px side pad, 5px gap. It was the knowledge card's Open button and nothing else (`knowledge-v2.module.css › .cardOpen`, now DELETED) until Samuel ruled that every /home button wearing the old hand-written `h-6 … px-2.5 text-caption` recipe adopts that face. Callers: `knowledge-v2/home/base-card.tsx` (the card's own Open — it renders this, it does not restate it), and /home's four small buttons — `pages/home/panel-buttons.tsx › CreateButton` (both tabs' section headers, one component since the two panels each declared a byte-identical copy), `pages/home/agent-share.tsx › ShareIntoChannelButton` (it was the deleted copy dialog's `UseInThisChannelButton` until B15 replaced the copy with a grant), and the Agents section's retry. ⚠ **It is the FACE and the SCALE, nothing else** — behavioural states stay with the caller through `className` (each converted button kept its own `disabled:opacity-60`), and the glyph is the caller's, sized with `OPEN_SCALE_ICON` rather than a re-typed 12. ⚠ Its colour reads `var(--kv-text, var(--text-primary))`: inside a knowledge surface the alias is bound, on a /home section header there is no `--kv-*` scope and an unbound `var()` would silently inherit the row's ink. Pinned by `pages/home/panel-buttons.test.tsx`, which compares the RENDERED classes of the card's Open and /home's buttons and scans `pages/home` for a returning `h-6`. **Two more callers since 2026-08-28**, both in the opened knowledge base: the folder tree's New file / New folder (`knowledge-v2/list/tree-rows.tsx › AddRow`, replacing a module-private `.addBtn` hover tint). ⚠ **AND THOSE TWO BOUGHT THE FACE ITS `white-space: nowrap` + `flex-shrink: 0`** (Samuel's live review the same day: "New file" rendered as "New / file"). The pill is a FIXED 26px, so a wrapped label is a second line drawn OUTSIDE the button's own face; nowrap without `flex-shrink: 0` only converts the wrap into a clip. It survived four callers because every label was ONE WORD — the first multi-word one in a narrow column exposed it. A parent that cannot fit two pills wraps the ROW (`knowledge-v2.module.css › .addRow`), never the pill. Pinned in `src/shared/ui/open-scale-button.test.tsx`. |
| `OpenScaleIconButton` / `OPEN_SCALE_ICON_ONLY` (same file) | **THE SAME PILL, GLYPH ONLY (2026-08-28)** — `.openScale` plus `.openScaleIcon`, a 26px square with the pad and the gap dropped. NOT a second face: it composes the identical rule, so an edit to the pill's height, radius, elevation or ink reaches both shapes. `aria-label` is REQUIRED by the type — a control with no text has no other name. Its glyph is 14, not `OPEN_SCALE_ICON`'s 12, because it is alone in the pill rather than sized against a label. Callers: the knowledge base header's download / settings / delete and the folder rail's collapse toggle. ⚠ **It exists because a file-private `ICON_BTN` string did** — a bare 28px hover tint, one of SIX such declarations in `src/` (re-measure: `grep -rn "ICON_BTN" src apps`). The other five are untouched debt, **F-345**; do not add a seventh. |
| `Avatar` (`avatar.tsx`) | Profile pictures with neutral initials fallback. No gradients — identity color belongs to teams. |
| `AvatarWithPresence` (`avatar-with-presence.tsx`) | `Avatar` wrapped in a presence ring — `ring-success` online / `ring-text-disabled` offline, floated off the avatar by a transparent `p-0.5` gap so it reads on any surface. Prefer over a standalone presence dot wherever an avatar is shown. |
| `SegmentedControl` (`segmented-control.tsx`) | ALL scope/filter tab rows AND page-header selectors. Never compose `.seg-pill`/`.seg-track`/`.raised-tab` tabs by hand. Two forms: `variant="pills"` (default) is the TRACKLESS filter row — hug-width `.seg-pill` per option; `variant="track"` (2026-08-24, /home's Chat/Knowledge/Agents) puts them in one flat `.seg-track`, inactive options bare so only the selected face is raised, and takes the track's fill from the caller's `bg-*` utility. Active is `.raised-tab` in both. `size` is `"sm"` (the app-wide filter-row scale) or `"lg"` = **the app's 36px control height, `text-small`** — the landing nav's `.lp-menu-btn` at 6/7. Side pad differs by form and it is a WIDTH BUDGET, not taste: tracked takes 15px, trackless 12px, because the trackless `lg` row is the channel info column's four options with two count badges and 15px a side overflowed it at the 340px that column was when this was measured (it is 380px since 2026-08-25, so the budget now has headroom the value does not spend — 12px is also the ramp's own "compact buttons" step, which is why it stays) (landing measures 42/18/14px; same 3.0 height-to-text ratio, and 12px is the ramp's "compact buttons" step) — THE header control height, shared with the black `auth-btn-3d` CTA beside it. The two forms take different option heights to reach it (trackless the pill is the control at 36px; tracked it is 30px inside the 3px pad). |
| `SectionBox` (`section-box.tsx`) | Labelled section card, PRESSED IN (see Patterns below). |
| `SectionPanel` (`section-panel.tsx`) | THE FLAT labelled section — `SectionBox`'s opposite number, and the two are a real choice. No frame, **no header strip, no inset body, no resize grip**: a heading row (+ optional `action`), an optional one-line `caption`, then the content, all on ONE ground. ⚠ **It paints NOTHING** — fill/border come from the caller's `className`, which is the whole scoping story: a page states the ground it stands on without this module ever naming one, and a `tone="home"` prop here would turn a per-mount decision into an enum one autocomplete away from every page. (This read "`bg-home-panel` et al are /home-ONLY" until 2026-08-30; that scope is superseded — see the frame-palette note above — while the rule is not.) ⚠ It renders **`data-section-panel`** as a page-scoping hook (the `[data-composer-panel]` idiom): `/home`'s record pane repaints every panel inside it in ONE rule — `pages/home/home.module.css › .frame :global([data-section-panel])` — so the Knowledge and Agents tabs cannot diverge. ⚠ **`SECTION_PANEL_GROUND` (same file, 2026-08-28) is the DEFAULT ground for a WORKSPACE page** — `border border-border-subtle bg-home-panel`, the gray WELL, frame-model level 3: a workspace page renders inside `.pageCard`, the white card floating in the one gray panel, so a section panel drawn on it is exactly where /home's record-pane wells are and takes the same token. ⚠ It was `bg-card-surface-subtle` (#f4f6f9) until 2026-08-30 — the same colour said a second way, and 3/255 from `--home-panel`. The hairline stays here and /home's `.frame` rule clears it: that page's record pane is already a bounded card, a workspace page's is not. It is a default, not the component's face: `SectionPanel` still paints nothing, /home passes no ground at all, and a page palette selects itself by passing something else. It exists because that pair of utilities was typed inline in two features. Callers: `agent-templates/components/template-section.tsx › TemplatePanel` (the workspace Agents page), `pages/home/knowledge-panels.tsx` (2026-08-27, replacing `SectionBox`), and **the opened knowledge base's info face** — `knowledge-v2/detail/meta-card.tsx` (Details) and `knowledge-v2/detail/overview-contents.tsx` (Contents), 2026-08-28, which is where INVARIANTS §5A's recorded `SectionBox` divergence was resolved. |
| **The /home credit bar** (`apps/desktop-ui/src/pages/home/overview-sections.tsx › CreditCapacityBar`) | **NOT A NEW RECIPE — it is `UsageMeter`, cloned from the billing surface (Samuel, 2026-09-01, as a CORRECTION).** The reference is `src/features/billing/components/billing-usage-pane.tsx › BillingUsagePane`'s "Usage this period" card: a `UsageMeter` labelled **MCP credits** over `used`/`limit`, with a `Resets {formatDate(periodEnd)}` line under it. The pressed-in look is `.concave-track`, which is the whole point — ⚠ **an earlier pass APPROXIMATED it** with a hand-rolled track and an `.auth-btn-3d` fill, on the reasoning that /home forbids concave surfaces, and Samuel rejected that: **a design reference IS the spec, clone it exactly.** The no-concave sweep (`agent-templates/components/template-editor.test.tsx › no concave surfaces`) now bans `UsageMeter` by name across /home and records this ONE file as the sanctioned exception, so the rule still binds every other surface there. |
| `UsageMeter` (`usage-meter.tsx`) | THE "used / limit" bar — label row + `.concave-track` well + a bare `h-1.5 rounded-full` fill with an inline width %. The only progress-bar recipe; it was module-private in the billing pane until a second meter (MCP credits) needed it, and the billing page's Usage tab is the third caller. **`over` is a verdict the CALLER passes**, not `used >= limit` arithmetic — an entitlement gate decides it. `tone` picks the fill: `"cta"` (default) is the flat CTA ink; `"ramp"` colours it by how full (<50 success / <75 caution / <90 warning / else danger, bands module-private) — for meters that get GLANCED at rather than read (`knowledge-v2/storage-meter.tsx` is the only one). Never hand-roll `.concave-track` + a fill. |
| `BarSeries` / `PLOT_HEIGHT_CLASS` (`apps/desktop-ui/src/components/charts/bar-series.tsx`) | **THE bar histogram (2026-09-01)** — labelled Y axis, gridlines on round numbers, one bar per bin, every Nth bin captioned, the newest bar inked `bg-surface-cta`. ⚠ **BARS CARRY A CONSTANT `rounded-[3px]` ON ALL FOUR CORNERS since 2026-09-01 (Samuel: rounded corners, always).** It was `rounded-t-full`, whose radius is a function of the bar's WIDTH — a pill cap on a tall bar collapsed into a dome and then a dot as the value approached zero, so the shortest bars stopped reading as bars. Both callers change together. ⚠ **EXTRACTED FROM `pages/overview/activity-chart.tsx`, NOT WRITTEN BESIDE IT**, when /home's Overview face needed the same picture over a different series: a second `niceCeiling` is a second axis ladder one retune away from disagreeing with the first. What stayed in `ActivityChart` is the CARD — heading, period total, metric switcher — because those are that page's copy; `BarSeries` renders a plot and owns no words. ⚠ **PLAIN DIVS, NO CHART LIBRARY, AND THAT IS A STANDING DECISION**: ~31 bars on a fixed axis is layout, and a dependency here would arrive with its own colours and type scale to fight the tokens. Callers: `pages/overview/activity-chart.tsx`, `pages/home/overview-sections.tsx › UsageChart`. ⚠ `PLOT_HEIGHT_CLASS` is EXPORTED so `overview-skeleton.tsx` imports the height instead of re-typing it (DRIFT-LEDGER P9's example of a claim-by-reference nothing enforced); pinned in `components/skeletons/page-skeletons.test.tsx`. |
| `Crossfade` (`crossfade.tsx`) | ONE surface whose CONTENTS change: fade out, replace, fade in, with the frame and the driving control staying put (/home's record pane switching conversations; the channel info column switching tabs). ⚠ Takes a RENDER FUNCTION and hands back the token still ON SCREEN — React swaps `children` instantly, so fading live children fades out the thing you just picked. Props for the token already shown pass through unfaded: only a token CHANGE is a swap. ⚠ The outgoing subtree stays mounted for the fade — not for teardowns that must be immediate. Tests that click and assert must `findBy`, not `getBy`. **Third caller since 2026-08-28: the opened knowledge base's detail column** (`knowledge-v2/detail/detail-panel.tsx`), swapping the base's INFO face for an open file. ⚠ **That one shows what "the outgoing view is a pure function of the token" costs a caller**: the entry BODY belongs to the current selection and is already `null` by the time the old face fades, so the pane latches the last fully-loaded entry and consults it only when the shown token names it. A caller whose face needs data the parent has already moved on from must hold that data itself. |
| `EmptyState` (`empty-state.tsx`) | Centered icon + title + description placeholder for empty panes. |
| `SearchField` (`search-field.tsx`) | Search-icon + concave-field input well (`sm`/`md`). Never inline the recipe. |
| `Switch` (`switch.tsx`) | Boolean toggles (concave track, raised thumb). |
| `Skeleton` / `SkeletonBar` (`skeleton.tsx`) | Loading placeholders — `animate-pulse` on `surface-raised-2`. No local `Bar` clones. Composed shapes live in the same file and every loading surface uses one: `SkeletonLine`/`SkeletonText`/`SkeletonRow` (atoms), `TwoPaneListSkeleton` (list+detail pages — knowledge/chats/skills/members/channels; takes `detail` to swap the right pane), `DetailPaneSkeleton`/`DetailDocSkeleton` (right pane), `TranscriptSkeleton` (message columns), `PageShellSkeleton` (single-surface pages; what the desktop `PageLoading` renders). ⚠ **ONLY THE TWO PAGE-LEVEL COMPOSITES CARRY `role="status"` + `aria-busy` + an `sr-only` label — `TwoPaneListSkeleton` and `PageShellSkeleton`** (measured 2026-08-25: `grep -n 'role="status"' src/shared/ui/skeleton.tsx`). The shimmer is `aria-hidden`, so a composite without them announces NOTHING, and the three that lack them are a live gap, not a licence — REFACTOR-FINDINGS **F-318**. New page-level loading states take the trio; do not hand-roll a wrapper at the call site. **No text loaders**: "Loading…" as visible copy is not a loading state. |
| `PENDING_ROW` / `pendingRow()` / `PendingRow` (`pending.ts`) | An OPTIMISTIC row awaiting the server: the real content, dimmed (`opacity-60`) and inert (`pointer-events-none`), carrying `data-pending`. **Not a skeleton** — a skeleton says "no content yet", and a pending row has the content; what it lacks is a commit. Compose it over the row's own classes (`{...pendingRow(isPending, "rounded-[10px] border …")}`), never restyle the surface. |
| `CopyButton` (`copy-button.tsx`) + `useCopyToClipboard` (hook) | Copy-to-clipboard. Icon-button case = `CopyButton`; custom chrome keeps its JSX and uses the hook. |
| `ScopeSharePopover` / `ScopeShareMenu` (`scope-share-popover.tsx`) | The private/team/workspace sharing control (chats + skills wrap it). |
| `ConfirmDialog` (`confirm-dialog.tsx`) | In-app confirmations. |
| `StandardDialog` / `DialogField` / `DialogActions` + `DIALOG_TITLE` / `DIALOG_BTN_PRIMARY` / `DIALOG_BTN_SECONDARY` (`standard-dialog.tsx`) | **THE create/edit dialog (2026-08-27, Samuel).** ONE width (`ModalShell size="narrow"`, `min(92vw, 640px)` — **not a prop**), ONE heading (`text-title` **centered + uppercase**, uppercased in CSS so `title` stays the `aria-label` every `getByRole("dialog", { name })` matches), ONE footer row (`leading` = the destructive slot, then a spacer, then the pair — **both fully rounded**). Body is `flex flex-col gap-4 p-6` and owns the scroll. `DialogField` is the uppercase `text-label` header + optional `normal-case` hint. The agent-template editor was the REFERENCE; New knowledge base, Add person (a Popover until then) and **/home's** New channel (`apps/desktop-ui/src/pages/home/new-channel-dialog.tsx`) were standardised onto it. ⚠ **THERE ARE TWO "NEW CHANNEL" DIALOGS ON TWO RECIPES, and this row claimed one** (corrected 2026-08-30). The one the WORKSPACE channels page mounts — `src/features/channels/components/create-channel-dialog.tsx` — is a hand-rolled `ModalShell size="narrow"` and composes none of these primitives. Re-derive rather than trusting the sentence: `grep -rln StandardDialog src apps`. ⚠ Text controls inside it wear `RAISED_INPUT`, and dropdowns wear `SelectMenu variant="raised"` — never the flat inset pill. |
| `FIELD_WELL` / `CHIP` / `RAISED_WELL` / `RAISED_INPUT` (`wells.ts`) | Class recipes for fields on section bodies: concave add-row well, raised pill chip, raised block field (inputs/code wells on inset), and the "pillow" text-control FACE (`RAISED_WELL` + type + placeholder ink + focus hairline) every standard-dialog input wears. Promoted from ontology-bits and (for `RAISED_INPUT`, 2026-08-27) from `agent-templates/components/template-editor-rows.tsx` — both re-export them. ⚠ `RAISED_INPUT` is the FACE; height/padding (`h-9 px-3`, `px-3 py-2`) belong to the caller. |
| `useApiQuery` (`use-api-query.ts`) | Every client GET hook (TanStack Query over `apiRequest`). `useApiGet` is gone (members pass migrated the last consumers). |
| `formatRelativeTime` / `formatDate` / `formatLastActive` (`shared/lib/format-time.ts`) | All timestamp display. No per-feature date formatters. |

Reference implementations: `src/features/knowledge/components/knowledge-v2/`
(CSS-module layout + kit recipes + `--kv-*` aliases onto global tokens) and
`src/features/ontology/components/` (utility-class styling on the same
tokens).

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
    invisible while focused is a trap. Reference: `channels-v2/bits.tsx ›
    MetaRow`'s `onRemove`.
  - **Discreet add**: a ghost row at the END of a list, revealed by the
    SECTION's hover, not a button. ⚠ **Two stages, two elements**: presence
    (is the section hovered) is the WRAPPER's opacity; weight (is the cursor on
    me) is the inner control's ink. One node expressing both makes `hover:` and
    `group-hover/…` fight over one property, and which wins is Tailwind's emit
    order rather than a decision. Reference: `channels-v2/info-card-rows.tsx ›
    InfoCardAddRow`.
  - **Inline editing is the UNDERLINE and nothing else** —
    `border-0 border-b border-text-primary bg-transparent p-0 outline-none`, at
    the same type as the text it replaces so the row does not change height
    between reading and editing. Enter and blur SAVE, Escape cancels. ⚠ A blur
    between two fields of the SAME row is not a blur: test `relatedTarget`
    against the row, or Tab commits and drops the caret. Reference:
    `channels-v2/agent-rename.tsx` (the original) and `› info-card-rows.tsx ›
    InfoCardCustomRow`.
  - ⚠ **NAME THE HOVER GROUP** (`group/meta`, `group/infocard`). Rows inside an
    editable section already own one for their own ×; an anonymous `group`
    makes a row's hover reveal the section's control too.
