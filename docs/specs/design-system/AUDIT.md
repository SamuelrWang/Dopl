# Design system audit — global values and duplicates (2026-10-26, branch `ui/design-system`)

Scope: `src/` + `apps/desktop-ui/src/`, `.ts`/`.tsx` without tests, plus every `.css`. Exempt
kits are counted out: `features/marketing`, `features/auth`, `features/onboarding`,
`app/oauth`, `shared/layout/auth-split`, `app/(auth)` (DESIGN-SYSTEM.md: their own glass/3D kit).
Measured with a regex sweep at the branch base (`2ed4299ba`) and at the branch tip, same day.
Re-measure, never quote: the patterns are in the table.

## 1. Literal counts, before → after

| Category | Pattern | Before | After |
| --- | --- | ---: | ---: |
| Arbitrary px on the spacing grid (`h-[26px]`, `gap-[3px]`, `max-w-[460px]` …) | `(h\|w\|gap\|p*\|m*\|inset\|top\|…)-\[\d+px\]` | 245 | 18 |
| Arbitrary radius | `rounded(-x)?-\[…\]` | 197 | 26 |
| Raw px font size | `text-\[\d+px\]` | 18 | 4 |
| z-index literal | `z-\[\d+\]`, `zIndex: N` | 12 | 2 |
| Arbitrary shadow | `shadow-\[…\]` | 11 | 8 |
| Colour literal in a class or style string | `[#hex]`, `"#hex"` | 35 | 33 |
| `rgb()` / `oklch()` in TS | | 42 | 39 |
| Arbitrary border | `border(-x)?-\[…\]` | 4 | 4 |
| CSS hex colour | `#hex` in `.css` | 201 | 197 |
| CSS px `font-size` | | 16 | 16 |
| CSS `z-index` literal | | 8 | 8 |

How the drops happened:
- **Spacing**: every on-grid `*-[Npx]` became its spacing step (`N/4`: `h-[26px]` → `h-6.5`,
  `w-[260px]` → `w-65`). Same pixels; the test files that pin a class spelling were rewritten by
  the same rule in the same commit.
- **Radius**: a `rounded-[Npx]` equal to a radius token became it (6 `sm`, 8 `md`, 10 `lg`,
  14 `xl`, 18 `2xl`, 2 `xs`), and four repeated off-ramp radii got tokens (below).
- **Type**: the doc editor's and the playground skill body's reading sizes are the new `--doc-*`
  scale.
- **Layers**: every product z-index is a `--layer-*` token.

## 2. Tokens added (both `src/app/globals.css` and `apps/desktop-ui/src/styles/tokens.css`)

| Token | Value | Repeats it replaced |
| --- | --- | --- |
| `--radius-mark` → `rounded-mark` | 4px | inline code, mention chips, ticks (6) |
| `--radius-tile` → `rounded-tile` | 7px | 28px icon tiles and buttons (29) |
| `--radius-field` → `rounded-field` | 9px | concave fields, 40px dialog buttons (19) |
| `--radius-card` → `rounded-card` | 12px | the identity look's 12px cards (8) |
| `--doc-text` / `--doc-h1` / `--doc-h2` / `--doc-h4` / `--doc-table` / `--doc-code` | 16 / 24 / 19 / 15 / 13 / 12.5px | doc editor prose + playground skill body (14) |
| `--layer-raised` / `--layer-float` / `--layer-menu-scrim` / `--layer-menu` / `--layer-top` | 2 / 5 / 999 / 1000 / 9999 | split handle, layout content, doc toolbar, popover backdrop + card, toasts and the hover card (10) |
| `--shadow-hairline` | `0 1px 2px rgba(0,0,0,.04)` | `RAISED_WELL`, `CHIP` |

The four radius names are taught to `src/shared/lib/utils.ts › cn` (tailwind-merge): without it
`cn("rounded-tile", "rounded-full")` keeps both.

## 3. Literals that remain, with the reason

- **Spacing (18)**: the agent window's geometry (`channels/components/agent-window-frame.ts`,
  `agent-window-chrome.tsx`), whose tests compute and pin px spellings
  (`agent-window-frame.test.ts`); `shared/ui/tab-underline.tsx`'s `h-[2px]`, pinned against the
  popup field line; `features/agent-identities` (left for the concurrent Identities branch);
  two comments in `agent-color-dot.tsx` that name the literal they forbid.
- **Radius (26)**: values with no token and one or two users — 3px (bar ends, `rounded-r-[3px]`
  on the playground's selected-row bar), 5px (keycaps, subtask check, shell ghosts), 11px and
  20px (the composer card and its skeleton), plus the agent window and agent-identities files.
- **Type (4)**: `composer-input.tsx`'s `pointer-coarse:text-[16px]` (iOS's no-zoom threshold, a
  platform constant, not a type choice) ×3; `app/admin/health/page.tsx`'s 10px severity badge
  (internal admin page, under the ramp's smallest step).
- **z-index (2)**: the staging-only "States" switch (`ui-staging/staging-scenario-switch.tsx`,
  `ontology-staging/staging-scenario-panel.tsx`), never shipped.
- **Shadow (8)**: six are `shadow-[var(--token)]`, token references pinned by tests; the
  `SectionBox` concave inset (one web-only surface); the doc editor's floating toolbar drop.
- **Colour in TS (33 + 39)**: `billing/components/checkout-appearance.ts` (Stripe's appearance API
  takes literal colours, it cannot read CSS variables); `members/constants.ts › TEAM_COLORS`
  (user-chosen team colours, persisted); the liquid-glass SVG filter maps
  (`shared/design/liquid-glass/`); the agent colour bank's JS mirror (`agent-colors.ts`,
  `agent-color-values.ts`); `layout-shell.tsx`'s body background reset; the install animation's
  SVG stroke; `knowledge-staging/data.ts` fixtures.
- **Border (4)**: `border-[3px]` / `border-[length:…]` agent-post ring and task ticks, pinned by
  `agent-post-accent-face.test.tsx`.
- **CSS hex (197)**: 129 are the token definitions themselves (`globals.css`, `tokens.css`,
  `kit.css`); `app-shell.module.css` (38, the account rail's new dark face, landed on master the
  same day by another branch); the get-started animation (21); `staging.css` (7).
- **Not touched by design**: an ALWAYS-underlined inline prose link (`underline underline-offset-2`
  at rest: `billing-invoices.tsx`, `billing-payment-method.tsx`, `chats/detail-pane.tsx`,
  `desktop-handoff-panel.tsx`, `embedded-checkout.tsx`, `claim-card.tsx`) is a fourth kind, not the
  Text link (Open question 4). The doc editor's link mark (`text-violet-300 hover:underline`,
  `shared/editor/doc-editor.tsx`) is off-palette (Open question 5).

## 4. Duplicates merged

| What | Copies before | Now |
| --- | --- | --- |
| The pill button family: `PILL_BUTTON`, `SMALL_PILL_BUTTON`, `QUIET_PILL`, `INK_PILL`, `CARD_PILL`, `WHITE_PILL`, `PAGE_ACTION_BTN`, `PAGE_ACTION_BTN_LIGHT`, `SMALL_PRIMARY_PILL`, `INK_PILL_FACE`, `SMALL_PILL_ICON`, `PAGE_ACTION_ICON` over two files | 12 constants, 2 modules (`page-action-button.tsx` deleted) | `pill-button.tsx › pillButton` + `PILL_ICON` + `CreateButton` |
| The Profile pill (`home-settings-control.tsx`, desktop and its staging copy) | 2 inline copies of `WHITE_PILL` | `pillButton("white", "lg")` |
| The white 36px pill: `PAGE_ACTION_BTN_LIGHT` (`.auth-btn-3d-light`) vs `WHITE_PILL` (`.white-card` + `.raise-pill`) | 2 faces that disagreed | `white` (the /home header's face); the threads tab's face toggle moves onto it (Open question 2) |
| The tab underline rule: `SegmentedControl`'s `after:` rule (rounded), `agent-window-frame.ts › TAB_UNDERLINE` (square), `members-v2/member-header.tsx`'s span (rounded top) | 3 | `tab-underline.tsx › TabUnderline` (square: the agent window's was Samuel's ruled face) |
| The text link | `TEXT_LINK_BUTTON` + an inline `hover:underline` (`ontology/attribute-value-editor.tsx`) | `text-link.ts › TEXT_LINK_BUTTON` |
| The 28px chrome icon button | `IconButton` + 5 `ICON_BTN` consts + 2 inline copies | `chrome-icon-button.ts › CHROME_ICON_BUTTON` (F-345, partly resolved) |
| The small-caps label (`text-label font-semibold uppercase tracking-wide text-text-secondary` / `-muted`) | 20 inline copies over 19 files | `section-heading.ts › LABEL_TEXT` / `LABEL_TEXT_MUTED` |
| The menu row highlight: hover `--menu-item-hover-bg` vs selected `bg-surface-selected` | 2 colours | one (`.menu-row-selected`) |
| `SelectMenu`'s `pill` trigger face | 1 user, replaced by `link` | deleted |

## 5. Duplicates that remain, and why

- **The playground panes** (`features/playground/components/panes/*`) restate the chats, skills,
  members and channels panes' layout strings (list column `w-93 border-r`, list header, the
  selected-row bar, empty hints; 6–8 copies each). They are the public static mirror of the app
  and render fixtures; merging means the product panes accepting fixture data first. Next step.
- **Staging copies** (`settings-staging/`, `popups-staging/`) are porting copies by design (each
  has a `PORTING.md`); they took the mechanical renames only.
- **The three picker dialogs** (`channels/components/create-channel-dialog.tsx`,
  `direct-message-dialog.tsx`, `invite-dialog.tsx`) share their list row, empty line, footer row
  and 40px `.auth-btn-3d-light` `rounded-field` buttons. A shared picker-list body is the next
  merge; it touches three flows' behaviour, so it is its own change.
- **A fourth black button**: `bg-surface-cta … h-9 rounded-md` in the three workspace join cards
  (`workspaces/components/accept-invite-card.tsx`, `desktop-handoff-panel.tsx`,
  `join-link-card.tsx`). A rounded rectangle, not a pill: Open question 3.
- **`members-v2/bits.tsx › IconButton`** (with `onInvert`) beside `channels/…/icon-button.tsx`.
- **`.menu-card` / `.menu-row`** hand-copied in `marketing.css` (landing nav, exempt kit).
- **The search pill** (`shared/ui/search-pill.tsx › SEARCH_PILL_FACE`) is the white pill's face
  as a FIELD shell (cursor-text, muted ink, no `font-medium`), so it stays its own recipe.
- **`features/agent-identities`** and **`identities-staging`** were left to the concurrent
  Identities branch apart from the pill rename.
