# Dopl Design System — the official UI layer

**The rule: no hand-rolled UI values.** Every page uses the tokens and kit
classes below. Never hardcode hex colors, raw px font sizes, or shadow/border
recipes in a component. If a recipe you need is missing, add it HERE (globals
+ this doc), then use it — don't fork it locally.

Source of truth: `src/app/globals.css` (`@theme` block + `:root` palette +
"UI kit" section). Design language: Samuel's study-notes app, verbatim —
neutral grays, hairline borders, floating bento cards, concave (pressed-in)
fields and raised 3D buttons. Currently wired: Knowledge (v2 + the shared
dialogs/doc-pane), Ontology, Members, Chats, Skills, Settings, Overview,
Workspaces (invite/join/create cards), Billing, MCP-connect.
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
| `bg-bg-inset`                                 | `#eef1f5`        | concave body fill, wells   |
| `bg-surface-raised-1/2/3/4`                   | 2–7% black       | hover / active row tints   |
| `border-border-subtle/default/strong/highlight` | 6/8/12/16% black | hairlines, by emphasis   |
| `divide-border-subtle`                        | 6% black         | list dividers              |
| `bg-home-frame`                               | `#2f3542`        | /home ONLY — the dark slab behind shell root + surface + account rail (darkened a notch 2026-08-25) |
| `bg-home-panel`                               | `#f1f3f5`        | /home ONLY — the base panel (`.page-float` fill) |
| `border-home-panel-line`                      | `#e2ecf0`        | /home ONLY — the record-pane hairline. ⚠ The header selector's track is `--seg-fill` now, so the token's `bg-` variant has NO consumer (`grep -rn 'bg-home-panel-line' src apps` is empty); only the `border-` utility is live. |
| `bg-home-card`                                | `#fbfcfc`        | /home ONLY — the record pane's fill |

The four `home-*` values are a PAGE palette, not a second ramp: /home is the
account surface and reads cooler (frame) and warmer (card) than the workspace
chrome. Never reach for them off that page, and never fold them into `--bg-*` —
that repaints every workspace page.

## Kit classes (globals.css "UI kit" + auth-3D sections)

| Class            | What it is                                                             |
| ---------------- | ---------------------------------------------------------------------- |
| `.page-float`    | THE full-page surface: raised 14px-radius card floating on the shell's sidebar panel (margins `7px 8px 9px 8px`). One per page. Compose flex direction yourself. |
| `.bento`         | Soft floating inner card (border-default, soft double shadow).          |
| `.concave-field` | Pressed-in input well (`#e9eaec`, inset shadows, focus ring). Alias of `.auth-field-3d`. Its focus signal is `--focus-line` + `--focus-halo` — THE app-wide "this one is live" pair (2026-08-24), shared verbatim with the open search pill and `.selected-ring`. State it once; never re-type those rgba values. |
| `.concave-track` | Recessed switcher track (radius 10, 4px pad) that tab pills sit inside. |
| `.seg-pill`      | Resting face of one stadium pill in a TRACKLESS segmented row — flat `--seg-fill` fill, fully rounded ends, **INSET** ring hairline (inset since 2026-08-25: an outset ring painted a pixel beyond the box on every side, so unselected pills measured 2px larger than the selected `.raised-tab` beside them and the selection looked shrunken). `SegmentedControl` renders one per option; active swaps to `.raised-tab` (2026-08-12). |
| `.raised-tab`    | White-gradient raised face for the ACTIVE item inside a `.concave-track` — also composed onto the active `.nav-chip`, the active `.seg-pill` option and the `Switch` thumb. ONE elevation with `.auth-btn-3d-light` (2026-08-15): identical gradient (`#fff → #f2f2f2`), hairline (`#d4d4d4`), bevel and drops. Its hairline is an `inset 0 0 0 1px` RING, not a `border`, because the class is toggled onto content-sized elements whose resting face has none — a real border would make every active chip 2px wider than its siblings. THE selected state app-wide (2026-08-17) — toggled chrome (History/Rooms toggles, doc-toolbar marks) and open-menu triggers (session pills, composer intent pill) wear it too; there is no pressed-in selected face. ⚠ It supplies the FILL, so a consumer's resting `bg-*`/`hover:bg-*` utilities must be conditional on NOT-active: Tailwind's utility layer outranks the kit layer and a stray `bg-bg-elevated` flattens the gradient to nothing. Resting face only; behavioural states belong to the consumer. |
| `.nav-chip`      | Hug-width sidebar/nav chip (`--shell-chip` fill on `--shell-surface`, radius 10, h36) for `<a>` and `<button>`. Active = `.nav-chip-active` + `.raised-tab`. THE nav recipe — app sidebar + settings modal both compose it; never fork it locally. |
| `.btn-light`     | Small raised light button (toolbar / compact chrome).                   |
| `.auth-btn-3d`   | Raised black primary CTA. (`.auth-btn-3d-light` = white variant.) `.auth-btn-3d-light` is THE white-raised elevation reference: `.raised-tab` and the app-shell's `.brandPill` are the same face at other scales. **Since 2026-08-24 both are BUILT FROM `--raised-light-face` / `--raised-light-line` / `--raised-light-bevel` / `--raised-light-shadow`** (`:root`, tokens.css + globals.css), so the "one elevation" rule is enforced by construction rather than by matching two hex lists — and a scoped override can wear the face without forking the recipe (/home's sender pills do exactly that). Change the face in ONE place: the vars. |
| `.selected-ring` | THE selected face for a raised-light control (2026-08-24) — `--focus-line` hairline + `--focus-halo`, i.e. the signal the search pill wears while OPEN, held permanently instead of only while focused. Compose onto `.auth-btn-3d-light` (/home's conversation rows); it re-states itself on `:hover` so a pointer cannot wash the selection out. ⚠ Not a border of its own and not a fill swap — a selected row must stay the same KIND of thing as its neighbours. |
| `.menu-card` / `.menu-row` / `.menu-divider` | THE dropdown surface, its row face and its section rule (2026-08-15). Ported from the landing Menu dropdown — `src/features/marketing/marketing.css › .lp-nav-menu-card` / `.lp-nav-menu-item` / `.lp-nav-menu-divider` plus the `lpMenuIn`/`lpMenuOut` keyframes, replicated in the global layer as `menuCardIn`/`menuCardOut` (marketing.css is page-scoped and the app never loads it — edit both together). Card: 16px radius, 7px padding, white→`#f6f6f6` gradient, `#dcdcdc` hairline, top inset bevel + three drops, unfolding on a 7° `rotateX`. Row: 10px radius with a 1px hover lift and a pressed-in `:active`. **Only `Popover` composes these** — never hand-roll a menu surface. |
| `.graph-substrate` | Dotted world surface (24px pitch) behind a board or graph view and its skeleton. THE dot recipe — the ontology kanban board and its skeleton compose it (with `.kanban-substrate`); the retired Workflows tree is the other user (the Canvas page was deleted 2026-08-11). |
| `.kanban-substrate` | Modifier on `.graph-substrate` for the ontology board: halves the pitch to 12px so the board's geometry lands on the grid (288px lanes = 24 tiles, 12px gutter = 1, 24px board padding = 2), and `background-attachment: local` so the dots cover the whole scrollable area and travel with the lanes instead of staying pinned to the pane. Tiles originate at the scroller's padding edge — keep every board dimension a multiple of 12px and each lane edge stays on a grid line. |
| `.graph-node-lift` | Elevation applied to a graph card WHILE dragging (deeper shadow + grabbing cursor). |
| `.graph-port`    | Raised connector dot on a workflow step card edge; `data-active` = drag source, `data-target` = live drop target, `data-variant="output"` = inked source dot. |
| `.graph-node` / `.graph-node-selected` / `.graph-node-target` | Graph card resting / selected-ring / connect-drop-target surfaces. Written for two callers; only the Workflows cards are left. |
| `.search-expand` / `-shell` / `-toggle` / `-input` | THE collapsing search: a 36px round button that GROWS to a 260px pill (2026-08-24, /home's header). Port of `src/features/marketing/marketing.css › .lp-nav-search*` scaled to 6/7 of the landing's own measurements (landing 42/300/42/42+16px pad/14px text → 36/260/36/36+14px pad/`text-small`). The RATIO is what is held: 42÷14 and 36÷12 are both 3.0, so it reads as the same control a notch down. Only colour comes from tokens. Same overlay trick (the slot stays one button wide, the shell is pinned `right: 0` and grows leftward, so no sibling moves) and the same delayed-in/instant-out input reveal. The shell composes `.auth-btn-3d-light` in the TSX and is never swapped for a field; while `[data-open]` its hover/press face is suppressed and only `.concave-field`'s FOCUS signal is borrowed. Marketing.css is page-scoped and the app never loads it — edit both together. |
| `.channel-info-slide` | The channels-v2 info column's slide shell (2026-08-24) — 0 ↔ **380px** on a 200ms width transition, `overflow: hidden`. WIDTH, not transform: the column is a flex sibling of the message pane, and a transform would slide it over the transcript instead of handing the space back. The panel inside keeps its own `w-[380px] shrink-0` so it never squashes mid-slide. ⚠ **380 IS A MATCH, NOT A TASTE (2026-08-25, Samuel): it is `channels-v2/agent-panel.tsx`'s `w-[380px]`**, and that panel is absolutely positioned against the SAME right edge — at 340 the divider jumped 40px sideways the moment an agent view opened. Change one and change the other. ⚠ Coupled to `channel-surface.tsx › INFO_SLIDE_MS`, which keeps the panel mounted one transition past close, and to the `prefers-reduced-motion` block that turns the transition off. |
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
| `Avatar` (`avatar.tsx`) | Profile pictures with neutral initials fallback. No gradients — identity color belongs to teams. |
| `AvatarWithPresence` (`avatar-with-presence.tsx`) | `Avatar` wrapped in a presence ring — `ring-success` online / `ring-text-disabled` offline, floated off the avatar by a transparent `p-0.5` gap so it reads on any surface. Prefer over a standalone presence dot wherever an avatar is shown. |
| `SegmentedControl` (`segmented-control.tsx`) | ALL scope/filter tab rows AND page-header selectors. Never compose `.seg-pill`/`.seg-track`/`.raised-tab` tabs by hand. Two forms: `variant="pills"` (default) is the TRACKLESS filter row — hug-width `.seg-pill` per option; `variant="track"` (2026-08-24, /home's Chat/Knowledge/Agents) puts them in one flat `.seg-track`, inactive options bare so only the selected face is raised, and takes the track's fill from the caller's `bg-*` utility. Active is `.raised-tab` in both. `size` is `"sm"` (the app-wide filter-row scale) or `"lg"` = **the app's 36px control height, `text-small`** — the landing nav's `.lp-menu-btn` at 6/7. Side pad differs by form and it is a WIDTH BUDGET, not taste: tracked takes 15px, trackless 12px, because the trackless `lg` row is the channel info column's four options with two count badges and 15px a side overflowed it at the 340px that column was when this was measured (it is 380px since 2026-08-25, so the budget now has headroom the value does not spend — 12px is also the ramp's own "compact buttons" step, which is why it stays) (landing measures 42/18/14px; same 3.0 height-to-text ratio, and 12px is the ramp's "compact buttons" step) — THE header control height, shared with the black `auth-btn-3d` CTA beside it. The two forms take different option heights to reach it (trackless the pill is the control at 36px; tracked it is 30px inside the 3px pad). |
| `SectionBox` (`section-box.tsx`) | Labelled section card (see Patterns below). |
| `UsageMeter` (`usage-meter.tsx`) | THE "used / limit" bar — label row + `.concave-track` well + a bare `h-1.5 rounded-full` fill with an inline width %. The only progress-bar recipe; it was module-private in the billing pane until a second meter (MCP credits) needed it, and the billing page's Usage tab is the third caller. **`over` is a verdict the CALLER passes**, not `used >= limit` arithmetic — an entitlement gate decides it. `tone` picks the fill: `"cta"` (default) is the flat CTA ink; `"ramp"` colours it by how full (<50 success / <75 caution / <90 warning / else danger, bands module-private) — for meters that get GLANCED at rather than read (`knowledge-v2/storage-meter.tsx` is the only one). Never hand-roll `.concave-track` + a fill. |
| `Crossfade` (`crossfade.tsx`) | ONE surface whose CONTENTS change: fade out, replace, fade in, with the frame and the driving control staying put (/home's record pane switching conversations; the channel info column switching tabs). ⚠ Takes a RENDER FUNCTION and hands back the token still ON SCREEN — React swaps `children` instantly, so fading live children fades out the thing you just picked. Props for the token already shown pass through unfaded: only a token CHANGE is a swap. ⚠ The outgoing subtree stays mounted for the fade — not for teardowns that must be immediate. Tests that click and assert must `findBy`, not `getBy`. |
| `EmptyState` (`empty-state.tsx`) | Centered icon + title + description placeholder for empty panes. |
| `SearchField` (`search-field.tsx`) | Search-icon + concave-field input well (`sm`/`md`). Never inline the recipe. |
| `Switch` (`switch.tsx`) | Boolean toggles (concave track, raised thumb). |
| `Skeleton` / `SkeletonBar` (`skeleton.tsx`) | Loading placeholders — `animate-pulse` on `surface-raised-2`. No local `Bar` clones. Composed shapes live in the same file and every loading surface uses one: `SkeletonLine`/`SkeletonText`/`SkeletonRow` (atoms), `TwoPaneListSkeleton` (list+detail pages — knowledge/chats/skills/members/channels; takes `detail` to swap the right pane), `DetailPaneSkeleton`/`DetailDocSkeleton` (right pane), `TranscriptSkeleton` (message columns), `PageShellSkeleton` (single-surface pages; what the desktop `PageLoading` renders). ⚠ **ONLY THE TWO PAGE-LEVEL COMPOSITES CARRY `role="status"` + `aria-busy` + an `sr-only` label — `TwoPaneListSkeleton` and `PageShellSkeleton`** (measured 2026-08-25: `grep -n 'role="status"' src/shared/ui/skeleton.tsx`). The shimmer is `aria-hidden`, so a composite without them announces NOTHING, and the three that lack them are a live gap, not a licence — REFACTOR-FINDINGS **F-318**. New page-level loading states take the trio; do not hand-roll a wrapper at the call site. **No text loaders**: "Loading…" as visible copy is not a loading state. |
| `PENDING_ROW` / `pendingRow()` / `PendingRow` (`pending.ts`) | An OPTIMISTIC row awaiting the server: the real content, dimmed (`opacity-60`) and inert (`pointer-events-none`), carrying `data-pending`. **Not a skeleton** — a skeleton says "no content yet", and a pending row has the content; what it lacks is a commit. Compose it over the row's own classes (`{...pendingRow(isPending, "rounded-[10px] border …")}`), never restyle the surface. |
| `CopyButton` (`copy-button.tsx`) + `useCopyToClipboard` (hook) | Copy-to-clipboard. Icon-button case = `CopyButton`; custom chrome keeps its JSX and uses the hook. |
| `ScopeSharePopover` / `ScopeShareMenu` (`scope-share-popover.tsx`) | The private/team/workspace sharing control (chats + skills wrap it). |
| `ConfirmDialog` (`confirm-dialog.tsx`) | In-app confirmations. |
| `FIELD_WELL` / `CHIP` / `RAISED_WELL` (`wells.ts`) | Class recipes for fields on section bodies: concave add-row well, raised pill chip, raised block field (inputs/code wells on inset). Promoted from ontology-bits (which now re-exports them). |
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
