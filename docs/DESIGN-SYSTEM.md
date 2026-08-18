# Dopl Design System — the official UI layer

**The rule: no hand-rolled UI values.** Every page uses the tokens and kit
classes below. Never hardcode hex colors, raw px font sizes, or shadow/border
recipes in a component. If a recipe you need is missing, add it HERE (globals
+ this doc), then use it — don't fork it locally.

Source of truth: `src/app/globals.css` (`@theme` block + `:root` palette +
"UI kit" section). Design language: Samuel's study-notes app, verbatim —
neutral grays, hairline borders, floating bento cards, concave (pressed-in)
fields and raised 3D buttons. Currently wired: Knowledge (v2 + the shared
dialogs/doc-pane), Ontology, Members, Chats, Skills, Settings,
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

No sizes between or outside these. `text-sm`/`text-xs`/`text-[13px]` are all
forbidden in app UI (marketing/landing pages excepted).

## Color tokens

Utilities generated from `@theme` (values live in `:root`):

| Utility                                       | Value            | Role                       |
| --------------------------------------------- | ---------------- | -------------------------- |
| `text-text-primary`                           | `#232a31`        | primary ink                |
| `text-text-secondary`                         | `#646d78`        | secondary / muted labels   |
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

## Kit classes (globals.css "UI kit" + auth-3D sections)

| Class            | What it is                                                             |
| ---------------- | ---------------------------------------------------------------------- |
| `.page-float`    | THE full-page surface: raised 14px-radius card floating on the shell's sidebar panel (margins `7px 8px 9px 8px`). One per page. Compose flex direction yourself. |
| `.bento`         | Soft floating inner card (border-default, soft double shadow).          |
| `.concave-field` | Pressed-in input well (`#e9eaec`, inset shadows, focus ring). Alias of `.auth-field-3d`. |
| `.concave-track` | Recessed switcher track (radius 10, 4px pad) that tab pills sit inside. |
| `.seg-pill`      | Resting face of one stadium pill in a TRACKLESS segmented row — flat `#e9eaec` fill, fully rounded ends, ring hairline. `SegmentedControl` renders one per option; active swaps to `.raised-tab` (2026-08-12). |
| `.raised-tab`    | White-gradient raised face for the ACTIVE item inside a `.concave-track` — also composed onto the active `.nav-chip`, the active `.seg-pill` option and the `Switch` thumb. ONE elevation with `.auth-btn-3d-light` (2026-08-15): identical gradient (`#fff → #f2f2f2`), hairline (`#d4d4d4`), bevel and drops. Its hairline is an `inset 0 0 0 1px` RING, not a `border`, because the class is toggled onto content-sized elements whose resting face has none — a real border would make every active chip 2px wider than its siblings. THE selected state app-wide (2026-08-17) — toggled chrome (History/Rooms toggles, doc-toolbar marks) and open-menu triggers (session pills, composer intent pill) wear it too; there is no pressed-in selected face. ⚠ It supplies the FILL, so a consumer's resting `bg-*`/`hover:bg-*` utilities must be conditional on NOT-active: Tailwind's utility layer outranks the kit layer and a stray `bg-bg-elevated` flattens the gradient to nothing. Resting face only; behavioural states belong to the consumer. |
| `.nav-chip`      | Hug-width sidebar/nav chip (`--shell-chip` fill on `--shell-surface`, radius 10, h36) for `<a>` and `<button>`. Active = `.nav-chip-active` + `.raised-tab`. THE nav recipe — app sidebar + settings modal both compose it; never fork it locally. |
| `.btn-light`     | Small raised light button (toolbar / compact chrome).                   |
| `.auth-btn-3d`   | Raised black primary CTA. (`.auth-btn-3d-light` = white variant.) `.auth-btn-3d-light` is THE white-raised elevation reference: `.raised-tab` and the app-shell's `.brandPill` are the same face at other scales. |
| `.menu-card` / `.menu-row` / `.menu-divider` | THE dropdown surface, its row face and its section rule (2026-08-15). Ported from the landing Menu dropdown — `src/features/marketing/marketing.css › .lp-nav-menu-card` / `.lp-nav-menu-item` / `.lp-nav-menu-divider` plus the `lpMenuIn`/`lpMenuOut` keyframes, replicated in the global layer as `menuCardIn`/`menuCardOut` (marketing.css is page-scoped and the app never loads it — edit both together). Card: 16px radius, 7px padding, white→`#f6f6f6` gradient, `#dcdcdc` hairline, top inset bevel + three drops, unfolding on a 7° `rotateX`. Row: 10px radius with a 1px hover lift and a pressed-in `:active`. **Only `Popover` composes these** — never hand-roll a menu surface. |
| `.graph-substrate` | Dotted world surface (24px pitch) behind a board or graph view and its skeleton. THE dot recipe — the ontology kanban board and its skeleton compose it (with `.kanban-substrate`); the retired Workflows tree is the other user (the Canvas page was deleted 2026-08-11). |
| `.kanban-substrate` | Modifier on `.graph-substrate` for the ontology board: halves the pitch to 12px so the board's geometry lands on the grid (288px lanes = 24 tiles, 12px gutter = 1, 24px board padding = 2), and `background-attachment: local` so the dots cover the whole scrollable area and travel with the lanes instead of staying pinned to the pane. Tiles originate at the scroller's padding edge — keep every board dimension a multiple of 12px and each lane edge stays on a grid line. |
| `.graph-node-lift` | Elevation applied to a graph card WHILE dragging (deeper shadow + grabbing cursor). |
| `.graph-port`    | Raised connector dot on a workflow step card edge; `data-active` = drag source, `data-target` = live drop target, `data-variant="output"` = inked source dot. |
| `.graph-node` / `.graph-node-selected` / `.graph-node-target` | Graph card resting / selected-ring / connect-drop-target surfaces. Written for two callers; only the Workflows cards are left. |
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
| `SegmentedControl` (`segmented-control.tsx`) | ALL scope/filter tab rows. Concave track + a raised thumb that slides between slots (0.28s ease-out-quint). Never compose `.concave-track`/`.raised-tab` tabs by hand. |
| `SectionBox` (`section-box.tsx`) | Labelled section card (see Patterns below). |
| `UsageMeter` (`usage-meter.tsx`) | THE "used / limit" bar — label row + `.concave-track` well + a bare `h-1.5 rounded-full` fill with an inline width %. The only progress-bar recipe; it was module-private in the billing pane until a second meter (MCP credits) needed it, and the billing page's Usage tab is the third caller. **`over` is a verdict the CALLER passes**, not `used >= limit` arithmetic — an entitlement gate decides it. `tone` picks the fill: `"cta"` (default) is the flat CTA ink; `"ramp"` colours it by how full (<50 success / <75 caution / <90 warning / else danger, bands module-private) — for meters that get GLANCED at rather than read (`knowledge-v2/storage-meter.tsx` is the only one). Never hand-roll `.concave-track` + a fill. |
| `EmptyState` (`empty-state.tsx`) | Centered icon + title + description placeholder for empty panes. |
| `SearchField` (`search-field.tsx`) | Search-icon + concave-field input well (`sm`/`md`). Never inline the recipe. |
| `Switch` (`switch.tsx`) | Boolean toggles (concave track, raised thumb). |
| `Skeleton` / `SkeletonBar` (`skeleton.tsx`) | Loading placeholders — `animate-pulse` on `surface-raised-2`. No local `Bar` clones. Composed shapes live in the same file and every loading surface uses one: `SkeletonLine`/`SkeletonText`/`SkeletonRow` (atoms), `TwoPaneListSkeleton` (list+detail pages — knowledge/chats/skills/members/channels; takes `detail` to swap the right pane), `DetailPaneSkeleton`/`DetailDocSkeleton` (right pane), `TranscriptSkeleton` (message columns), `PageShellSkeleton` (single-surface pages; what the desktop `PageLoading` renders). Every one carries `role="status"` + `aria-busy` + an `sr-only` label — the shimmer is `aria-hidden`, so without it a screen reader gets silence. **No text loaders**: "Loading…" as visible copy is not a loading state. |
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
