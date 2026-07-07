# Dopl Design System — the official UI layer

**The rule: no hand-rolled UI values.** Every page uses the tokens and kit
classes below. Never hardcode hex colors, raw px font sizes, or shadow/border
recipes in a component. If a recipe you need is missing, add it HERE (globals
+ this doc), then use it — don't fork it locally.

Source of truth: `src/app/globals.css` (`@theme` block + `:root` palette +
"UI kit" section). Design language: Samuel's study-notes app, verbatim —
neutral grays, hairline borders, floating bento cards, concave (pressed-in)
fields and raised 3D buttons. Currently wired: Knowledge (v2) + Ontology.
Every new page starts on this system.

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
| `Popover` / `MenuItem` (`popover-menu.tsx`) | ALL dropdowns/kebabs/filter menus. Never hand-roll the fixed-backdrop pattern. |
| `Avatar` (`avatar.tsx`) | Profile pictures with neutral initials fallback. No gradients — identity color belongs to teams. |
| `useApiGet` (`use-api-get.ts`) | Every client GET-with-refresh hook. Wrap it per endpoint; never copy the fetch/tick pattern. |

Reference implementations: `src/features/knowledge/components/knowledge-v2/`
(CSS-module layout + kit recipes + `--kv-*` aliases onto global tokens) and
`src/features/ontology/components/` (utility-class styling on the same
tokens; shared atoms in `ontology-bits.tsx` — `SectionBox`, `FIELD_WELL`,
`CHIP`).

## Patterns

- **Page shell**: page renders bare into the app shell (no `AppPanel`) and
  wraps itself in one `.page-float`. See both reference pages.
- **Section box**: 14px-radius `border-border-strong` card; header strip
  `bg-card-surface-subtle px-4 py-1.5` holding a `text-label` uppercase
  title; body `bg-bg-inset` with the concave inset shadow. Implemented as
  `SectionBox` in ontology-bits — promote to `src/shared/ui` when a second
  feature needs it.
- **Pills/chips**: `rounded-full border border-border-strong` +
  `bg-bg-elevated` (raised, on inset bodies) or `bg-bg-inset` (flat, on
  cards), `text-caption`/`text-small` medium.
