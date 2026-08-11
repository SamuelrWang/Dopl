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
Exempt: marketing pages and auth + onboarding (their own crystal/3D
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
| `.concave-sel`   | Pressed-in selected state (`#e9e9e7`) for tabs/rows. Alias of `.btn-pressed`. |
| `.concave-track` | Recessed switcher track (radius 10, 4px pad) that tab pills sit inside. |
| `.raised-tab`    | White-gradient raised face for the ACTIVE item inside a `.concave-track`. |
| `.btn-light`     | Small raised light button (toolbar / compact chrome).                   |
| `.auth-btn-3d`   | Raised black primary CTA. (`.auth-btn-3d-light` = white variant.)       |
| `.graph-substrate` | Dotted recessed world surface behind a graph view and its skeleton. Its only remaining user is the retired Workflows tree — the Canvas page was deleted 2026-08-11. |
| `.graph-node-lift` | Elevation applied to a graph card WHILE dragging (deeper shadow + grabbing cursor). |
| `.graph-port`    | Raised connector dot on a workflow step card edge; `data-active` = drag source, `data-target` = live drop target, `data-variant="output"` = inked source dot. |
| `.graph-node` / `.graph-node-selected` / `.graph-node-target` | Graph card resting / selected-ring / connect-drop-target surfaces. Written for two callers; only the Workflows cards are left. |

Composition pattern (CSS modules welcome for layout, recipes come from kit):

```tsx
<div className={cn("page-float", styles.shell)}>         // page surface
<div className={cn("concave-field", styles.search)}>     // search well
<div className={cn("concave-track", styles.tabs)}>       // tab track
<span className={cn("raised-tab", styles.tabThumb)}>     // active thumb
<button className={cn(styles.tab, active && "concave-sel")}>
```

Shared React primitives (`src/shared/ui` + `src/shared/hooks`):

| Primitive | Use |
| --------- | --- |
| `Popover` / `MenuItem` (`popover-menu.tsx`) | ALL dropdowns/kebabs/filter/context menus. Trigger-anchored by default; pass `at={{x,y}}` for portal/cursor-positioned menus (viewport-clamped). `MenuItem` takes `icon` + `destructive`. Never hand-roll the backdrop/Escape/clamp pattern. |
| `Avatar` (`avatar.tsx`) | Profile pictures with neutral initials fallback. No gradients — identity color belongs to teams. |
| `AvatarWithPresence` (`avatar-with-presence.tsx`) | `Avatar` wrapped in a presence ring — `ring-success` online / `ring-text-disabled` offline, floated off the avatar by a transparent `p-0.5` gap so it reads on any surface. Prefer over a standalone presence dot wherever an avatar is shown. |
| `SegmentedControl` (`segmented-control.tsx`) | ALL scope/filter tab rows. Concave track + a raised thumb that slides between slots (0.28s ease-out-quint). Never compose `.concave-track`/`.raised-tab` tabs by hand. |
| `SectionBox` (`section-box.tsx`) | Labelled section card (see Patterns below). |
| `UsageMeter` (`usage-meter.tsx`) | THE "used / limit" bar — label row + `.concave-track` well + a bare `h-1.5 rounded-full` fill with an inline width %. The only progress-bar recipe; it was module-private in the billing pane until a second meter (MCP credits) needed it, and the billing page's Usage tab is the third caller. **`over` is a verdict the CALLER passes**, not `used >= limit` arithmetic — an entitlement gate decides it. Never hand-roll `.concave-track` + a fill. |
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
