# Tokenize Spec — light-mode lossless sweep (Phase A)

Replace hardcoded `white`/`black`-alpha + stray-hex color utilities in LIVE components
with semantic token utilities. **Dark mode must stay visually identical.** Only colors
change — never layout, spacing, sizing, radius, or logic. Do NOT touch `cursor`, sizing,
or non-color classes.

The token utilities below already exist (defined in `src/app/globals.css` `@theme inline`).
Use ONLY these utility names. A typo'd utility silently no-ops, so copy them exactly.

## Reference exemplar (already done — match this style)
`src/features/canvas/canvas-panel.tsx` — read it to see the target output.

## Mapping rules

### Text color  (`text-*`)
| Literal | → utility |
|---|---|
| `text-white`, `text-white/90`, `/95`, `/100`, `text-white/[0.88]` | `text-text-primary` |
| `text-white/70`, `/75`, `/80`, `/85` | `text-text-secondary` |
| `text-white/50`, `/55`, `/60`, `/65` | `text-text-tertiary` |
| `text-white/30`, `/35`, `/40`, `/45` | `text-text-muted` |
| `text-white/20`, `/25` | `text-text-disabled` |
| `text-black`, `text-black/*` | `text-[#302C2D]`?? → NO. Use `text-text-primary` ONLY if it's foreground text on a light/colored chip; otherwise FLAG it (black text is rare and context-specific). |
| `text-[#4a9eff]` (and other blue link hexes) | `text-link` |

### Border color  (`border-*`, `border-x/y/t/b/l/r-*`, `divide-*`)
Keep the side/width part; swap only the color:
| Literal alpha | → utility |
|---|---|
| `border-white/[0.04]`, `/[0.06]` | `border-border-subtle` |
| `border-white/[0.08]`, `/[0.1]`, `/[0.10]` | `border-border-default` |
| `border-white/[0.12]`, `/[0.15]`, `/[0.16]`, `/[0.18]` | `border-border-strong` |
| `border-white/[0.2]`, `/[0.22]`, `/[0.25]`, `/[0.28]`, `/[0.3]` | `border-border-highlight` |
(For `border-b-white/[0.06]` → `border-b-border-subtle`, etc.)

### Surface / background fills  (`bg-*`)
| Literal | → utility |
|---|---|
| `bg-white/[0.01..0.03]`, `bg-white/[0.02]`, `/[0.03]` | `bg-surface-raised-1` |
| `bg-white/[0.04]`, `/[0.05]` | `bg-surface-raised-2` |
| `bg-white/[0.06]`, `/[0.07]` | `bg-surface-raised-3` |
| `bg-white/[0.08]`, `/[0.09]`, `/[0.1]`, `/[0.12]`, `/[0.14]` | `bg-surface-raised-4` **UNLESS** it's the fill of a SELECTED/ACTIVE item (selected row, active tab, current cluster) → then `bg-surface-selected` |
| `bg-white/30`, `bg-white/40`, `bg-white/90` and other high-alpha decorative FILL marks (dots, indicators) | `bg-text-muted` (treat as a muted foreground mark) — FLAG if it's actually a solid surface |
| `bg-[#0a0a0a]` | `bg-modal-surface` |
| `bg-[#1a1a1a]`, `bg-[#1c1c1e]`, `bg-[#1c1c1f]`, `bg-[#252528]`, `bg-[#141414]`, `bg-[#181818]` | nearest existing surface: use `bg-bg-inset` for the darkest menu/popover surfaces, `bg-bg-elevated` for panel-like. FLAG if unsure. |
| `bg-black/40`, `/50`, `/60`, `/70` (dialog/overlay SCRIM behind a modal) | `bg-scrim` |
| `bg-black` solid | FLAG (rare; context-specific) |
| `bg-[var(--panel-surface)]`, `bg-[oklch(...)]` already pointing at a CSS var/token | leave as-is (already themeable) |

### Inline-style shadows / gradients (in `style={{...}}` or `shadow-[...]`)
| Literal | → |
|---|---|
| panel drop shadow `0_4px_16px_rgba(0,0,0,0.3)` (± inset `rgba(255,255,255,0.08)`) | `shadow-[var(--shadow-panel)]` |
| selected ring `0_0_0_2px_rgba(255,255,255,0.5)` (composited with the panel shadow) | `shadow-[var(--ring-selected),var(--shadow-panel)]` |
| top-edge specular gradient `linear-gradient(90deg, ...rgba(255,255,255,0.3)...0.4...)` | `var(--shine-top-gradient)` |
| `shadow-black/60`, `shadow-2xl shadow-black/*` | `shadow-[var(--shadow-elevated)]` |
| bespoke pure-black drop shadows `0_Npx_Mpx_rgba(0,0,0,x)` (dropdown/menu glows) | **LEAVE AS LITERAL** — a drop shadow is dark in both themes, so it's already correct. Do not flag. |
| inset white-alpha hairline divider `inset 0 ±1px 0 rgba(255,255,255,0.0x)` (used as a 1px edge line, any direction) | swap ONLY the color → `...rgba` becomes `var(--hairline-shine)`, keeping the geometry. e.g. `shadow-[inset_0_-1px_0_var(--hairline-shine)]` or in inline style `"inset 0 -1px 0 var(--hairline-shine)"`. The 0.04/0.08 variants snap to this one token. |

### Inverted-hover affordance (menu rows that flip to solid on hover/active)
A row styled `bg-white text-black` (often with `hover:bg-white hover:text-black`, `text-black/45` for secondary text). This is a deliberate "selected = inverted" affordance. Map:
| Literal | → utility |
|---|---|
| `bg-white` / `hover:bg-white` / `active`-state `bg-white` (the inverted row fill) | `bg-surface-invert` (same prefix: `hover:bg-surface-invert`) |
| `text-black` (on the inverted row) | `text-text-on-invert` |
| `text-black/45` (secondary on inverted row) | `text-text-on-invert/45` |
(Light theme: this becomes the `#7C7372` chip with light text — your reference's selected item.)

### Primary solid CTA buttons (distinct from menu-row invert)
A SOLID primary action BUTTON styled `bg-white text-black` (e.g. "Save changes", "Accept invite", "Create"), often `hover:bg-white/90`. This is a CTA, not a menu row. Map:
| Literal | → utility |
|---|---|
| `bg-white` (solid CTA button fill) | `bg-surface-cta` |
| `hover:bg-white/90`, `hover:bg-white/80` (CTA hover dim) | `hover:bg-surface-cta/90` |
| `text-black` (on the CTA) | `text-text-on-cta` |
Rule of thumb: if it's a `<button>`/clickable that is the page's primary action → `surface-cta`. If it's a row/item in a menu/list that flips on hover/active → `surface-invert`. When genuinely unsure, FLAG.

### Ring / focus-ring colors
| Literal | → utility |
|---|---|
| `ring-white/[0.06]`, `/[0.08]`, `ring-white/10` | `ring-border-default` |
| `ring-white/12..18` | `ring-border-strong` |
| `ring-white/20`, `/25`, `/30` | `ring-border-highlight` |
| `focus:ring-white/N` etc. | same, keep the `focus:` prefix |
| `ring-[var(--something,#hex)]` (var with hex fallback) | leave as-is (already token-backed) |

### Active-state indicator border
| Literal | → utility |
|---|---|
| `border-white/60` (and other high-alpha active-tab underlines), keep side/width prefix | `border-border-active` (e.g. `border-b-2 border-border-active`) |

### Canvas-native SVG / inline-`style` raw `rgba()` — OUT OF SCOPE this pass
Raw `rgba(...)` inside SVG attributes (`stroke`, `fill`) or computed inline `style` that is NOT one of the mapped shadow/gradient/hairline cases (e.g. minimap, marquee, grid lines, cluster outline). LEAVE these and FLAG — they're handled in a separate canvas-chrome pass.

## Hard rules
1. **Never invent a utility.** Only the names above. If nothing fits, LEAVE the literal and add it to your FLAG list.
2. **Only color changes.** Do not alter spacing, sizing, radius, opacity-of-non-color, cursor, or logic.
3. **Out of scope — DO NOT TOUCH:** anything in `src/app/design/`, the orphaned `src/shared/design/{glass-card,glass-navbar,glow-text,pill,pill-bar,surface,status-dot,platform-icon,background-grid,orb}.tsx`, `features/marketing/*` brand/traffic-light hex, `--glow-accent*`, login orbs.
4. **`dark:` variants:** if a class has a `dark:` variant pair (e.g. shadcn `dark:bg-input/30`), leave it alone — it's already theme-aware. FLAG only if it blocks a clean swap.
5. After editing a file, it should have ZERO `white/`, `black/`, `rgba(255`, or in-scope hex left (except FLAGGED ones).

## Output
Return: (a) files edited, (b) a FLAG list of every ambiguous case you left or were unsure about, with file:line and the literal, so a human can resolve link-vs-action / selected-vs-raised / bespoke-shadow calls.
