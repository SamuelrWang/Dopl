# Workspace parity — 03. Pages and the UI system

**Area:** page-level composition and the UI/visual system.
**Question:** what does a WORKSPACE have to gain to reach the desktop HOME space, page by page and
recipe by recipe — and what is the *smallest* amount of code that gets it there.
**Method:** read-only. Every claim below carries a `path:line` measured against the worktree
`/Users/samuelwang/Downloads/sie-parity` at `03506fcd` (branch `docs/workspace-parity`), read
2026-09-17. Line numbers in this document are a snapshot, not an anchor — re-derive with the greps
given rather than trusting a number (`CLAUDE.md` › *Standing rules for writing docs* rule 2; the
numbers are here because this is a one-shot comparison table, not a standing rule).

Prior reads that govern this area: `docs/INVARIANTS.md` §1 (layout, the 500-line cap, and the
2026-09-17 declare-in-`src/` rule), §1A (per-page skeletons), §4A (home channels and workspace
KINDS), §5 / §5A (channels, agent templates); `docs/DESIGN-SYSTEM.md` (the frame model, the kit,
the popup kit, Patterns); `docs/ENGINEERING.md` §2384 (the 2026-08-30 frame reversal).

---

## 0. The finding that reframes the brief: there is no web workspace app

The brief asks for three columns — home, workspace-on-desktop, workspace-on-web. **The third column
is empty, and that is a measurement, not an omission.**

`find src/app -name 'page.tsx' -o -name 'layout.tsx' -o -name 'loading.tsx'` returns 23 files. Not
one of them is under a `[workspaceSlug]` (or any workspace) segment. The complete web route set is:

| Route | File | Kind |
| --- | --- | --- |
| `/` | `src/app/page.tsx:8` | marketing |
| `/pricing` | `src/app/pricing/page.tsx:8` | marketing |
| `/privacy`, `/terms` | `src/app/privacy/page.tsx:7`, `src/app/terms/page.tsx:7` | legal |
| `/authenticate`, `/login`, `/signup` | `src/app/(auth)/authenticate/page.tsx:19`, `› login/page.tsx:16`, `› signup/page.tsx:16` | auth |
| `/get-started` | `src/app/(auth)/get-started/page.tsx:56` | download hand-off |
| `/auth/{callback,desktop-handoff,desktop-start,reset-password}` | `src/app/auth/**` | auth plumbing |
| `/invite/{token}`, `/join/{token}`, `/link/{token}` | `src/app/invite/[token]/page.tsx:18`, `› join/[token]/page.tsx:18`, `› link/[token]/page.tsx:31` | claim landings |
| `/billing`, `/billing/{segment}` | `src/app/billing/page.tsx:61`, `› [segment]/page.tsx:47` | billing |
| `/admin/{analytics,health}` | `src/app/admin/**` | internal |
| `/oauth/authorize` | `src/app/oauth/authorize/page.tsx:24` | OAuth consent |
| `/playground` | `src/app/playground/page.tsx:17` | demo |
| **`/c/{containerUuid}`** | **`src/app/c/[workspaceId]/page.tsx:48`** | **the guest channel lane — the ONLY product surface left on the web** |

`src/features/workspaces/url.ts:16-18` states the rule in the code: the web tree can no longer
render a workspace, so `workspaceDeepLink` hands off to `dopl://open/{segment}` instead. There are
**zero** `loading.tsx` / `error.tsx` / `not-found.tsx` / `template.tsx` files in `src/app`, and
exactly two `layout.tsx` (`src/app/layout.tsx:122`, `src/app/(auth)/layout.tsx:20`).

`src/shared/layout/app-shell/` contains **no `app-shell.tsx`** — only the CSS module
(`app-shell.module.css`, 419) plus two Next-free cores (`app-sidebar-core.tsx` 177,
`workspace-switcher-core.tsx` 227) and a type (`workspace-types.ts` 16). The component that
assembles them lives in the SPA: `apps/desktop-ui/src/components/app-shell/app-shell.tsx:52` (327).
`src/shared/layout/app-shell/app-panel.tsx:20 › AppPanel` has **zero call sites** — dead export.

**So the parity question is a two-host question, and the third host is the LANDING PAGE.** The
three real hosts of product UI today are:

1. `/home` — the SPA's account surface (`apps/desktop-ui/src/pages/home/**`, **8 241 non-test
   lines**).
2. the workspace shell + its eight routed pages — the SPA
   (`apps/desktop-ui/src/components/app-shell/app-shell.tsx`, `› pages/{overview,channels,agents,
   knowledge,skills,ontology,chats,members,settings}`), each of which is a *thin wrapper over a
   shared `src/features` core*.
3. `/c/{uuid}` — the guest lane (`src/app/c/[workspaceId]/guest-channel.tsx:140`), and the
   marketing hero demo (`src/features/marketing/components/banner-demo/`), both of which prove that
   what lives in `src/` is reusable and what lives in `apps/` is not.

Everything below is written against that.

### The structural asymmetry, in one paragraph

**A workspace page is a 65–290-line SPA wrapper over a core in `src/features`. /home is 8 241 lines
of composition with no core at all.** Measured:

| Page | SPA lines (non-test) | Shared core it mounts | Core lines |
| --- | --- | --- | --- |
| ontology | 65 (`pages/ontology/index.tsx:44`) | `src/features/ontology/components/ontology-view.tsx` | 496 |
| skills | 77 (`pages/skills/index.tsx:53`) | `src/features/skills/components/skills-browser-core.tsx` | 418 |
| settings | 86 (`pages/settings/index.tsx:51`) | — (inline; mounts `mcp-connect` + `workspaces` cores) | — |
| chats | 98 (`pages/chats/index.tsx:84`) | `src/features/chats/components/chats-view.tsx` | 289 |
| agents | 133 (`pages/agents/index.tsx:40`) | `src/features/agent-templates/components/agent-templates-core.tsx` | 231 |
| channels | 232 (`pages/channels/index.tsx:82`) | `src/features/channels/components/channels-core.tsx` | 270 |
| members | 265 (`pages/members/index.tsx:31`) | `src/features/members/components/members-v2/members-v2-view.tsx` | 296 |
| knowledge | 387 (`pages/knowledge/index.tsx:223`) | `src/features/knowledge/components/knowledge-v2/knowledge-v2.tsx` | 261 |
| **overview** | **868** (`pages/overview/index.tsx:123`) | **NONE — the body is 8 SPA-only modules** | — |
| **/home** | **8 241** | **NONE — `src/features/home/` is types + `tabs.ts` only (757 lines, 0 components)** | — |

`src/features/home/` holds `types.ts` (274), `overview-types.ts` (309), `schema.ts` (117),
`tabs.ts` (57) and a `server/` tree. **No `components/` directory.** That single fact is the whole
of section D.

---

## A. Page map

**Legend for Classification**
- `shared-already` — one implementation, both hosts mount it.
- `shared-but-gated-off` — one implementation; the workspace host passes a capability/prop that
  turns the /home behaviour off (or never passes the one that turns it on).
- `duplicated-should-collapse` — two implementations of one thing.
- `host-specific-in-kind` — genuinely different because the hosts differ (account vs org).
- `workspace-only` / `home-only` — exists on one side, nothing on the other.

**Web column:** `—` means no web route exists (§0). Only two rows have a web entry.

### A.1 — Frame and chrome

| # | Page / face | Home composition | Workspace composition (desktop) | Web | Same shell? | Classification | Action | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| A1 | **Shell root / frame** | `pages/home/index.tsx:180` `shell.root` → `:181` `shell.body` → `:193` `shell.surface` | `components/app-shell/app-shell.tsx:212` `styles.root` → `:213` `styles.body` → `:222` `styles.surface` | `src/shared/layout/layout-shell.tsx:82-84` renders children bare and paints `body` `var(--home-frame)` at `:61-69` | **YES** — same module `src/shared/layout/app-shell/app-shell.module.css` (`.root:45`, `.body:65`, `.surface:67`) | shared-already | none | Level 0 of the frame model (`docs/DESIGN-SYSTEM.md:102-140`). The 2026-08-30 ruling that made this shared is `docs/DESIGN-SYSTEM.md:95-96` / `docs/ENGINEERING.md:2384`. |
| A2 | **Account rail** | `pages/home/index.tsx:182-187` `<AccountRail activeWorkspacePublicId={null}>` | `app-shell.tsx:216-221` (and `:177-182` inside the switch skeleton) | re-implemented as `DemoAccountRail` — `marketing/components/banner-demo/demo-home-chrome.tsx:74-120` + `lp-demo-rail-tile` in `marketing.css` | YES | shared-already (SPA) / **duplicated-should-collapse (landing)** | move `account-rail.{tsx,module.css}` down to `src/shared/layout/app-shell/` | Lives in `apps/desktop-ui/src/components/app-shell/account-rail.tsx:43` (92) + `› account-rail.module.css` (152). The landing could not import it, so it re-cut the rail. §D row D1. |
| A3 | **The ONE panel (level 1)** | `pages/home/index.tsx:200-207` — `<main className={cn("page-float !ml-0 flex flex-1 flex-col overflow-hidden bg-home-panel", home.page)}>` | `app-shell.tsx:232` — `<div className={cn("page-float", styles.panel)}>` | — | **YES** — both compose the kit's `.page-float` (`globals.css:856` / `kit.css:136`) | shared-already | none | Home adds `!ml-0` + `bg-home-panel` inline; the workspace does the same two things in CSS (`app-shell.module.css:108-126` zeroes `margin-left`). **The two say one thing in two places** — see B3. |
| A4 | **Sidebar (region of level 1)** | **ABSENT** — /home is one panel wide (`app-sidebar-core.tsx:144-146` says so explicitly) | `app-shell.tsx:233-250` `<AppSidebarCore>` → `app-sidebar-core.tsx:119` `<aside className={styles.sidebar}>`, `:122-138` nav chips, `:149-163` Team upsell card, `:165-174` Settings foot | — | n/a | **host-specific-in-kind** | keep, but see C1 | /home's left column is the CHANNEL LIST; the workspace's is NAV. Both stand on level 1 and paint nothing (`app-shell.module.css:174-190`). |
| A5 | **Workspace switcher (brand pill)** | **ABSENT** — the rail *is* the switcher on /home | `app-shell.tsx:239-248` `<WorkspaceSwitcherCore>` → `workspace-switcher-core.tsx:74-97` (`.brand:194`, `.brandPill:201`) | `WorkspaceGlyph` alone is reused by the demo — `banner-demo/demo-home-chrome.tsx:51` | n/a | workspace-only | keep | `WorkspaceGlyph` is already in the root tree and already has three hosts. |
| A6 | **Routed page card (level 2)** | `pages/home/index.tsx:260-287` — `"mb-3 mr-3 … rounded-[14px] border-2 border-home-panel-line bg-home-card"` + `home.frame` | `app-shell.tsx:265-267` `<div className={styles.pageCard}><Outlet/></div>` → `app-shell.module.css:140-150` (`margin:12px 12px 12px 0; background:var(--home-card); border:2px solid var(--home-panel-line); border-radius:14px`) | — | **NO — same VALUES, two declarations** | **duplicated-should-collapse** | extract `RECORD_SURFACE` (a class string or a `.recordCard` in the shared module) and have both compose it | Byte-comparable: `mb-3 mr-3` vs `margin:12px 12px 12px 0`; the border, radius and fill are identical tokens. This is the single most load-bearing duplication in the document. |
| A7 | **Page's own `.page-float` collapse** | n/a — /home IS the float | `app-shell.module.css:166-172` `.pageCard :global(.page-float){margin:0;background:transparent;border:none;…}` | — | n/a | workspace-only (correct) | none | The mechanism that lets 16 surfaces compose `.page-float` and still nest (`docs/DESIGN-SYSTEM.md` › *INSIDE THE WORKSPACE SHELL*). |
| A8 | **Header strip** | `pages/home/home-header.tsx:37-102` — one 36px row: list-width cell holding "New channel" (`:64-72`), face selector (`:76-83`), search (`:90`), Profile (`:97-100`) | **NONE.** There is no workspace header. Each page draws its own — see A.3 | copied verbatim as `DemoHomeHeader` — `banner-demo/demo-home-chrome.tsx:46-73` | NO | **duplicated-should-collapse (home↔landing)** + **home-only (vs workspace)** | extract a `PageHeaderStrip` into `src/shared/ui/`; give the workspace shell one | `demo-home-chrome.tsx:49-51` is `home-header.tsx:37` and `:64` character for character. The recipes underneath are already shared (`PAGE_ACTION_BTN`, `HOME_TABS`, `SegmentedControl`); the *layout* is not. |
| A9 | **Search** | `pages/home/home-search.tsx:44-67` — kit `.search-expand` pinned open at 260px | **NONE anywhere in the workspace shell.** The channels sidebar has a private filter input (`channels/components/sidebar.tsx:25-27`); no other page has search | `DemoHomeSearch` — `demo-home-chrome.tsx:88-101` (a `<span>` for the `<input>`) | n/a | **home-only** | RULING E3 | The `ui/search-panel` branch (Cmd+K clone) is **not in this worktree** — `grep -rl 'SearchPanel\|cmdk' src apps docs` is empty. |
| A10 | **Settings entry** | `pages/home/home-settings-control.tsx:113-120` — a black `PAGE_ACTION_BTN` pill reading "Profile", plus the same `SettingsModal` | `app-sidebar-core.tsx:165-174` — a `.nav-chip` "Settings" in the sidebar foot, plus `app-shell.tsx:297-306` `<SettingsModal>` | — | n/a | host-specific-in-kind (the *modal* is shared-already) | keep both entries | `home-settings-control.tsx:52-54` also carries a one-slot `openHomeSettings` registry — a /home-only mechanism forced by the 500-line cap (`:30-40`). |
| A11 | **Account/workspace create dialog** | `pages/home/index.tsx:336-343` `<CreateWorkspaceDialogCore>` | `app-shell.tsx:288-295` — same component | — | YES | shared-already | none | `src/features/workspaces/components/create-workspace-dialog-core.tsx` (143). |
| A12 | **Notice / guidance layer** | **ABSENT** — /home mounts no `TourProviderCore`, no `JoinRequestNoticesCore`, no `ConnectAgentBanner`, no `WelcomePopup` | was `app-shell.tsx:252` / `:269` / `:270` / `:271` | — | n/a | **workspace-only** | ✅ RULING R-49 | ⛔ **AND NOW ABSENT EVERYWHERE: all four are DELETED (2026-09-17, wave 7)**, the workspace shell included. The "host-agnostic, no-code-change parity win" this row recorded was overruled; see §C3 and INVARIANTS §15. |

### A.2 — The five /home faces vs their workspace pages

| # | Face | Home composition | Workspace page (desktop) | Web | Same shell? | Classification | Action | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| A13 | **Overview** | `pages/home/overview-panels.tsx:114` `<div className="min-w-0 flex-1 overflow-y-auto p-3">` (the `data-overview-face` stamp was deleted 2026-09-17 with the shadow it scoped) over `overview-sections.tsx` (384), `overview-rails.tsx` (227), `overview-token-spend.tsx` (199), `overview-agent-board.tsx` (186), `overview-usage-filter.tsx` (255) | `pages/overview/index.tsx:123-152` — `page-float` → `max-w-5xl` column of `OverviewHeader` (`:127`), `StatCards` (`:131`), `PeriodStats` (`:132`), `ActivityChart` (`:133`), `NeedsYou` (`:138`), a 48/52 grid (`:142-149`) | — | NO | **duplicated-should-collapse** | one Overview surface, host-scoped payload | Both are 100 % `apps/`-resident. They share exactly ONE thing: `components/charts/bar-series.tsx › BarSeries` (`overview-sections.tsx:12-15`, `overview/activity-chart.tsx:7-10`). ⚠ **`docs/DESIGN-SYSTEM.md:13` claims they also share `pages/overview/overview-bits.tsx` — they do not.** `grep -rn 'overview-bits' apps/desktop-ui/src/pages/home` is empty; its only readers are `overview/period-stats.tsx:4` and `› stat-cards.tsx:4`. **Doc-vs-code disagreement → F-714 (§E9).** |
| A14 | **Channels** | `pages/home/home-panes.tsx:61` (bare-row token) → `relationship-record.tsx:73-145` `<StandaloneChannelSurface>` with `slots.infoTab` (`:95-103`) and `capabilities` (`:140-144`) | `pages/channels/index.tsx:82` `<ChannelsCore>` → `channels-core.tsx:199` `page-float` → the SAME `ChannelSurface` | `src/app/c/[workspaceId]/guest-channel.tsx:140-163` — same `StandaloneChannelSurface`, `capabilities={{memberManagement:false, selfManagement:false}}` (`:158-161`) | **YES** | **shared-already, THE reference implementation** | none — copy this pattern everywhere else | Three hosts, one surface, zero forks. `channel-surface.tsx:97-120` (`ChannelSurfaceSlots`) + `:111-186` (`ChannelSurfaceCapabilities`: `memberManagement`, `peerNamedHeader`, `selfManagement`, `knowledge`, `artifacts`). This is §F's model. |
| A15 | **Knowledge** | `pages/home/knowledge-panels.tsx` (462) — two `SectionPanel`s over `home.module.css › .kbCards` (`:200-230`), cards are `knowledge-v2/home/base-card.tsx` **verbatim** (`knowledge-panel-cards.tsx`) | `pages/knowledge/index.tsx:223` → `knowledge-v2/**` — hero image band + `LiquidGlass` (`knowledge-v2/home/knowledge-home.tsx:122-145`), `SegmentedControl` scope filter (`:146`), `.cardGrid` | — | NO | **shared-but-gated-off** (the CARD is shared; the GRID and the CHROME are not) | make the grid a prop/variant of `knowledge-home.tsx`; delete `.kbCards` | `home.module.css:170-199` argues at length that the card is reused and only its `--kv-*` aliases are rebound — the right instinct, wrong seam: the rebinds are a fourth place the card's face is decided. |
| A16 | **Agents (templates)** | `pages/home/agent-panels.tsx` (360) — three scoped `SectionPanel`s over `agent-panel-cards.tsx` (215) + `agent-editor.tsx` (296), create is `panel-buttons.tsx:50-69 › CreateButton` (black pill) | `pages/agents/index.tsx:40` → `agent-templates-core.tsx:183-198` — `page-float` → a **52px header bar** (`:184`) with `text-display` "Agents" (`:185`) and a **white `.btn-light` pill** (`:190`) → `max-w-[960px]` column of `TemplateSection`s | — | NO | **duplicated-should-collapse** | one templates surface; `visibility` grouping becomes a prop | Both read `agent-templates/lib/visibility.ts` and both render `template-section.tsx`; what differs is the *chrome* and the *section set*. `agent-templates-core.tsx:68` already has a `loadingSkeleton` slot — the slot idiom is established here. |
| A17 | **Ontology** | `pages/home/ontology-panels.tsx:26-63` — mounts the SAME `OntologyView` with `pinnedOntologyId` + `onSelectOntology` + `onCreateOntology` + `settingsMenu` + `frameless` | `pages/ontology/index.tsx:44` → the same `OntologyView` with none of those | — | **YES** | **shared-already via props** (second reference implementation) | none | `ontology-view.tsx:57` `pinnedOntologyId`, `:60` `onSelectOntology`, `:73` `onCreateOntology`, `:83` `settingsMenu(close)`, `:103` `frameless`. `frameless` is *exactly* the host-supplies-the-surface adapter §F asks for. |
| A18 | **Record pane (the crossfading surface)** | `pages/home/index.tsx:294-311` `<Crossfade token={paneToken(tab, selected?.id)}>` → `home-panes.tsx:90-…` | **ABSENT.** The workspace swaps pages by ROUTE, remounting `.pageCard` | — | n/a | host-specific-in-kind | see C2 | `Crossfade` (`src/shared/ui/crossfade.tsx`) already has three other callers (`knowledge-v2/detail/detail-panel.tsx`, `channels/components/info-panel.tsx`). |
| A19 | **Channel list / left column** | `pages/home/relationship-list.tsx:117-158` — 290px column of THREE `WellsColumn` gray boxes (`:125-151`), rows are `HomeChannelRow` cards | `channels/components/sidebar.tsx` (358) — a flat nav tree: hardcoded furniture rows, Favorites, DMs, Channels, 36px `raised-tab`-selected rows (`sidebar-rows.tsx:52-63`) | — | NO | **duplicated-should-collapse** *(by kind, not by code)* | RULING E1 | Two completely different answers to "pick a channel". Home's is the newer one and is already shared with the landing demo. |
| A20 | **Members** | **ABSENT** — the roster is the channel's Info tab (`person-info-tab.tsx` 395, `person-members.tsx:4`) | `pages/members/index.tsx:31` → `members-v2-view.tsx:201` `page-float grid grid-cols-[minmax(380px,42fr)_minmax(0,58fr)]` | — | n/a | workspace-only | keep | `docs/DESIGN-SYSTEM.md:14-30` records that Members is **off the kit's conformance list** and measures 0 lines of the seven dialog primitives. |
| A21 | **Chats** | ABSENT | `pages/chats/index.tsx:84` → `chats-view.tsx:252` `page-float flex` | — | n/a | workspace-only | keep | No skeleton (`section-skeleton.tsx:36-38` hands it `PageLoading`). |
| A22 | **Skills** | ABSENT | `pages/skills/index.tsx:53` → `skills-browser-core.tsx:163-167` `page-float flex`, `h1` at `text-title` | — | n/a | workspace-only | keep | Header recipe #4 (see A.3). |
| A23 | **Settings (workspace)** | The modal only (A10) | `pages/settings/index.tsx:51-62` — `page-float` → a `px-4 py-2` bar with `border-b border-border-subtle` and a `text-title` `h1` | — | n/a | workspace-only | fold into the modal, or give it the one header | Header recipe #3. Also off the dialog-kit list (`docs/DESIGN-SYSTEM.md:14-30`). |
| A24 | **Onboarding** | n/a | `pages/onboarding/index.tsx:54` → `onboarding-flow-core.tsx` (182) | no web route | n/a | shared-already | none | The core is already Next-free and host-agnostic. |
| A25 | **Boot / signed-out** | `pages/home/index.tsx:134` `<SignedOutScreen/>` | `app-shell.tsx:192` — same component | — | YES | shared-already | none | `pages/boot/signed-out-screen.tsx` (100). |

### A.3 — Loading, error and empty states

| # | Surface | Home | Workspace (desktop) | Same? | Classification | Action |
| --- | --- | --- | --- | --- | --- | --- |
| A26 | **Page skeleton** | `pages/home/home-skeleton.tsx` (420) — the rail, the header, the 290px list, the record pane, plus per-face ghosts (`:145-148` `PanelGhost` on `SECTION_PANEL_GROUND`, `:306` selector ghost, `:377` `PLOT_HEIGHT_CLASS` by import) + `channel-record-skeleton.tsx` (254) | `overview-skeleton.tsx` (94), `channels-skeleton.tsx` (139), `agents-skeleton.tsx`, `members-skeleton.tsx` (222), `knowledge-skeletons.tsx` (182) — **and NONE for skills, chats, ontology** (`section-skeleton.tsx:36-40` hands all three `PageLoading`) | partial | **workspace gap** | three page ghosts, or a ruling that `PageLoading` is the answer (E8) |
| A27 | **Frame skeleton** | `home-skeleton.tsx` draws its own | `skeletons/shell-skeleton.tsx:38-60` `ShellChromeSkeleton` — the SAME six boxes by module reference | YES in principle, TWO implementations | duplicated-should-collapse | one `ChromeSkeleton` taking the left column as a slot |
| A28 | **Error state** | `pages/home/index.tsx:135-148` `<div className="flex h-screen w-screen flex-col"><PageError/></div>` | `app-shell.tsx:193-199` — **the identical wrapper and component** | YES, two copies | duplicated-should-collapse (trivial) | extract `FullScreenError` |
| A29 | **Empty state** | `EmptyState` (`src/shared/ui/empty-state.tsx`) via `home-panes.tsx:2`; plus the two-sentence rule `relationship-list.tsx:152-156` (`"No matches"` vs `"No channels yet"`) | `EmptyState` — 22 consumers repo-wide | YES | shared-already | none |

### A.4 — Page header recipes (the workspace has FIVE; /home has ONE)

| # | Recipe | Where | Shape |
| --- | --- | --- | --- |
| H0 | **/home's strip** | `home-header.tsx:37` | No title at all. `py-3 pr-5`, one 36px row: black pill (list-width cell) · plain-pill selector · search · black pill. |
| H1 | **Overview's greeting header** | `overview/overview-header.tsx:25-49` | `text-label` eyebrow ("Good morning") → `text-display` "Here is {name}" → `text-caption` explainer subline → a **hand-cut** `h-8` black pill at `:44`. |
| H2 | **Agents' 52px bar** | `agent-templates-core.tsx:184-196` | `h-[52px] border-b border-border-default px-4`, `text-display` `h1`, spacer, a `.btn-light` **white** `h-8` pill. |
| H3 | **Settings' bar** | `pages/settings/index.tsx:52-58` | `px-4 py-2 border-b border-border-subtle`, `text-title` `h1`, `text-caption` slug. |
| H4 | **Skills' bar** | `skills-browser-core.tsx:167` | `text-title font-semibold tracking-tight`. |
| H5 | **Knowledge's hero band** | `knowledge-v2/home/knowledge-home.tsx:122-145` | A photograph, a `LiquidGlass` card, `text-white` + `text-[#e3e3e3]` copy, a marketing paragraph — then a `SegmentedControl` filter row at `:146`. |

Five recipes, five heights, three ink treatments, two explainer paragraphs (H1's subline and H5's
body) that the minimal-copy ruling forbids in product UI. **One header is the single highest-value
collapse in this document** (§F).

---

## B. UI/UX recipe map

Every visual recipe /home uses that workspaces do not, or use an older version of.

| # | Recipe | Home | Workspace | CSS-only swap or component change? | Risk |
| --- | --- | --- | --- | --- | --- |
| B1 | **`PAGE_ACTION_BTN` — the 36px black page action** | `src/shared/ui/page-action-button.ts:29-30`; worn at `home-header.tsx:68`, `home-settings-control.tsx:117`, `panel-buttons.tsx:62`, `add-person-dialog.tsx:101`, `overview-sections.tsx:257` | **Never used.** `ontology-view.tsx:9-15` explains it cannot import it and reads `bits.tsx › TAB_ACTION` instead | **component change** — import the constant | LOW. Since 2026-09-17 it lives in `src/shared/ui/`, so every workspace surface *can* import it. |
| B2 | **`TAB_ACTION` — the same 36px black pill, second declaration** | — | `src/features/channels/components/bits.tsx:66-73` (`TAB_ACTION_SHELL` + `TAB_ACTION_INK`) | **component change** — make `TAB_ACTION` compose `PAGE_ACTION_BTN` | LOW. Both are `auth-btn-3d` + `h-9` + `rounded-full` + `px-[15px]` + `text-small font-semibold` + `text-text-on-cta`. Two declarations of one face across two root-tree files that CAN see each other. |
| B3 | **Hand-cut `auth-btn-3d` pills** | none | **~20 call sites**, none of which reads either constant. In app UI: `overview/overview-header.tsx:44` (`h-8 px-4 text-white`), `members-v2/list-pane.tsx:106` (`h-8 px-3.5 text-white`), `ontology-view.tsx:326` (`rounded-lg px-4 py-2 text-lead text-white`), `channels/thread-card-row.tsx:170` (`h-8 rounded-[8px] px-3 text-caption`), `create-channel-dialog.tsx:378,437` (`h-10 rounded-[9px]`), `playground/connect-strip.tsx:63`, `tour-popover.tsx:45,83`, `billing/**` ×7, `settings-modal/**` ×4 | **component change** | MEDIUM. Four heights (h-8/h-9/h-10/h-[46px]), five radii, and **`text-white` instead of `text-text-on-cta`** — the exact violation `page-action-button.ts:21-24` names. `grep -rn 'auth-btn-3d' src apps --include='*.tsx'` is the re-derive. |
| B4 | **`HOME_CARD_FACE` / `HOME_CARD_FACE_SELECTED` — the row card** | `src/shared/ui/home-card-marks.tsx:37`, `:68`; worn by `home-channel-row.tsx:129` | **Nothing.** The channels sidebar row is a flat 36px `raised-tab` (`sidebar-rows.tsx:52-63`) | **component change** (the rows carry different facts) | MEDIUM — see C1/E1. |
| B5 | ✅ **RESOLVED (wave 3 bought the count, wave 4 shared the marks).** **`MentionBadge` / `UnreadDot` / `LinkOutChip` — the `@ N` pill, the dot and the chip** | `src/shared/ui/home-card-marks.tsx`, worn by `home-channel-row.tsx` | **All three, from that same module.** The old "deliberately absent" note held while `Channel.unread` was the only signal; R-28 bought `Channel.mentionCount` and the rule it stated — a numeric badge only where a real count exists — is unchanged | done: two inks (`tone`), one implementation, source-scanned | — |
| B6 | **`PANEL_WELL_ON_PANEL` — the collapsible gray well** | `src/shared/ui/panel-well.ts:73`; `relationship-list.tsx:135` | `PANEL_WELL` (`panel-well.ts:41`) is used on the channel-info Agents/Threads tabs (`agents-wells.tsx`, `recency-wells.tsx:171`) and the ontology object panel (`ontology/components/panel-section.tsx:59`). **No workspace PAGE uses either** | **component change** (`WellsColumn` + a well set) | LOW — `collapse-wells.tsx` already takes `wells`, `face`, `showEmpty`, `forceOpen`, `storageKey`. |
| B7 | **`SectionPanel` on `--home-panel` (flat gray section)** | `home.module.css:165-168` scopes `[data-section-panel]` to `background:var(--home-panel); border-color:transparent` — ONE rule grounding both /home faces | `SECTION_PANEL_GROUND` (`section-panel.tsx:51`) — has a `border-border-subtle` hairline | **CSS-only swap** | LOW. The component paints nothing by design (`section-panel.tsx:60-64`). The two grounds are a real decision, not drift — but nothing records WHY the workspace keeps a hairline the /home ruling removed (`panel-well.ts:16-20`). |
| B8 | **`SectionBox` (concave) still in use** | Forbidden on /home (`docs/DESIGN-SYSTEM.md` › Patterns: "/home and `features/agent-templates/**`… no concave surfaces", pinned by `template-editor.test.tsx`) | Live in `members-v2/{tab-access,tab-about,tab-settings,member-facts,team-detail-pane}.tsx`, `billing-invoices.tsx`, `ontology/template-editor.tsx`, `knowledge-v2/detail/overview-contents.tsx` | **component change** | MEDIUM. Two section languages on one app. |
| B9 | **`SegmentedControl variant="plain" size="lg" weight="semibold"` (the face selector)** | `home-header.tsx:76-83` | The component is used 12× but **never in that form**. `overview/activity-chart.tsx:62`, `members-v2/list-pane.tsx:123`, `chats/list-pane.tsx:159`, `skills-browser-core.tsx:190`, `knowledge-home.tsx:146`, `info-panel.tsx:437`, `billing-page-screen.tsx:123` use `pills`/`track`/`underline` at `sm`/`md` | **CSS-only** (props) | LOW. `segmented-control.tsx:72` `variant`, `:82` `size`, `:94` `weight`. |
| B10 | **`.search-expand` pill** | `home-search.tsx:44-67` | Zero workspace consumers. The kit rule is in both copies (`globals.css:1200-1302`, `kit.css:464-568`) | **component change** | LOW to add, but see E3 for what it should search. |
| B11 | **Page-scoped shared-component skin (`home.module.css › .frame`)** | `home.module.css:56-168` — six `:global()` rules repainting the channel surface's dividers (`:56-81`), attribution pills (`:102-106`), composer panels (`:128-130`) and section panels (`:165-168`) | The workspace channel page keeps the neutral kit hairlines — which is the *point* (`home.module.css:37-41`) | n/a — this is the fence | MEDIUM. Three of the six rules select on **Tailwind utility class names** in files /home does not own (`:49-54` admits it degrades silently). A parity pass that reskins the workspace channel page has to decide whether the "account palette" becomes the app palette or stays /home's. |
| B12 | **`.auth-btn-3d-light` re-stated as three declarations** | `home.module.css:102-106` sets `--raised-light-face/-line/-shadow` directly | The same face is `.auth-btn-3d-light` (`globals.css:761`) / `.raised-tab` (`:955`) | **CSS-only** (compose `.raised-tab` instead) | LOW. It reads the tokens, so it cannot colour-drift; it is still a fourth spelling of one recipe. |
| B13 | ~~**`[data-overview-face] .bento` — the deeper card shadow**~~ **RESOLVED BY DELETION 2026-09-17** | Gone: the hook, the rule and `--shadow-card` are deleted (Samuel reverted the elevation); `.bento`'s `--shadow-bento` is the one step | Nothing to adopt — the two surfaces already match | **none** | — |
| B14 | **`Crossfade` on face swaps** | `pages/home/index.tsx:294`, `home-panes.tsx` | Route changes remount `.pageCard` with no transition | **component change** | MEDIUM — see C2. |
| B15 | **`.collapse-grid` (the 0fr→1fr smooth collapse)** | via `WellsColumn` | via `WellsColumn` on the info column's tabs only | shared-already | — |
| B16 | **`FormDialog` popup kit** | 2 /home dialogs conform (`new-channel-dialog.tsx`, `ontology-share.tsx`) | 5 conform (`launch-agent-dialog`, `new-thread-dialog`, `template-editor`, `template-editor-rows`, `new-object-dialog`); **9 INPUT FORMs are still `Todo`** — `create-channel-dialog`, `direct-message-dialog`, `base-settings-modal`, `create-base-dialog`, `move-to-dialog`, `members/create-team-dialog`, `members/invite-dialog`, `create-skill-dialog` (`docs/DESIGN-SYSTEM.md:386-440`) | **component change** | MEDIUM — 9 dialogs, each a small rewrite. |
| B17 | **`UsageMeter` label-less variant** | `overview-sections.tsx › CreditCapacityBar` | Billing uses the labelled form | shared-already (a prop) | — |
| B18 | **`BarSeries` histogram** | `overview-sections.tsx:12-15,372` | `overview/activity-chart.tsx:7-10,72` | shared-already — but the module is `apps/desktop-ui/src/components/charts/bar-series.tsx` (256), **SPA-only** | LOW. Move-down candidate (D5). |
| B19 | **Stat tiles (`IconTile` / `CardLabel` / `StatFigure` / `padCount`)** | **Not used** — /home's Overview uses `TEMPLATE_NAME_TEXT` headings and its own rails | `overview/overview-bits.tsx:9-53`, read by `period-stats.tsx:4`, `stat-cards.tsx:4` | n/a | LOW, but see E9 — the design doc claims they are shared. |
| B20 | **Sidebar's hardcoded type** | n/a | `app-shell.module.css:289` `.wcTitle{font-size:16px}`, `:291` `.wcDesc{font-size:13.5px}` | **CSS-only** | LOW to fix, but it is a live violation of the type scale (`docs/DESIGN-SYSTEM.md:32-52`: "No sizes between or outside these"). |
| B21 | **Knowledge hero's hardcoded ink** | n/a | `knowledge-home.tsx:133` `text-white`, `:135` `text-[#e3e3e3]` | **CSS-only** | LOW. 14 files repo-wide still carry `text-[Npx]` (mostly auth/onboarding, which are exempt; `composer-input.tsx` and `doc-editor.tsx` are not). |
| B22 | **`.glass-panel`** | — | — | Declared in `globals.css:904`, **absent from `kit.css`** — so `/link/{token}`'s claim card cannot render in the SPA | **CSS-only** (port the rule) | LOW. It is one of four kit recipes present in `globals.css` and missing from the SPA copy (`.glass-panel`, `.hairline`, `.hairline-strong`, plus the landing/login set). ⚠ **Nothing gates this**: `scripts/check-css-token-drift.ts:61` compares `--*` declarations only (`:16-22`). |
| B23 | ✅ **ANSWERED 2026-09-17 (wave 4, U28): NO RING, ONE STACK.** **Presence rings** | `home-channel-row.tsx › HomeChannelRow` uses a bare `AvatarStack` — **no presence**, and it stays that way | the workspace channel ROW had NO roster at all and now draws the same bare `AvatarStack` (`sidebar-rows.tsx › ChannelRow`, via `channels/lib/channel-display.ts › channelRowFaces`). The roster PANES keep `AvatarWithPresence`, which reads a real per-member signal | done — and the ring is REFUSED, not deferred: `Channel` carries `onlineMemberCount`, a TOTAL, so a ring on a named face would claim what the payload does not know. ⚠ `AvatarStack` DOES have an `online` key (`avatar-stack.tsx › AvatarStackUser`) — the doc's "no presence variant" was wrong; what is missing is the DATA | — |
| B24 | **Dark mode** | none | none | — | **There is none, and it is deliberate.** `prefers-color-scheme`, `data-theme`, `.dark` and `dark:` all return **0 matches repo-wide**. `globals.css:516-518` states it: *"One palette, from `:root`. No dark/light split."* Same rule at `tokens.css:517`, `app-shell.module.css:371`, `settings-modal.module.css:6`, `billing-page.module.css:10`. **Parity has no dark-mode axis.** |
| B25 | **Token layer** | `apps/desktop-ui/src/styles/tokens.css` (626) + `kit.css` (826) | `src/app/globals.css` (1582) | Two hand-mirrored copies (`globals.css:8` names it F-074) | **In sync apart from a 3-entry allowlist** (`scripts/check-css-token-drift.ts:42-55`: `--font-mono`, `--font-playfair`, `--shell-rail-w` `0px` web vs `54px` SPA). ⚠ The gate covers **tokens only, never the kit classes** — B22 is the live consequence. |
| B26 | **Notch bar / search panel** | — | — | **Not in this worktree.** Both are separate branches (`ui/notch-bar`, `ui/search-panel`); `grep` finds nothing. Out of scope for this parity pass; flagged so the next reader does not look for them. |

---

## C. Navigation and IA

### C1 — Face tabs vs a sidebar: what "parity" actually means

The two hosts answer "where am I and how do I move" in opposite ways.

| | /home | workspace |
| --- | --- | --- |
| Surface switch | **Local state**, not a route — `pages/home/index.tsx:81` `useState<HomeTab>`; nothing links to a face (`index.tsx:52-57`) | **Routes** — `routes.tsx:78-107 › WORKSPACE_PAGES`, mirrored by hand in `app-sidebar-core.tsx:53-70 › NAV` and again in `dopl-desktop-app/main/deep-link-target.js` |
| Control | 5 plain pills in the header (`home-header.tsx:76-83`) | 8 `.nav-chip` rows in a 232px sidebar (`app-sidebar-core.tsx:122-138`) |
| Object picker | The 290px channel column, always present (`index.tsx:229-259`) | Per page; the channels page has its own tree (`channels/components/sidebar.tsx`) |
| Layout invariant | **"ONE LAYOUT FOR ALL FIVE TABS"** — the column and the pane never move (`index.tsx:217-228`) | Each page owns its whole card |
| Title | **None** — the selector replaces it (`home-header.tsx:73`) | Five different titles (A.4) |

**These are not the same problem.** /home has ONE object (a channel) seen five ways. A workspace has
EIGHT objects (channels, agents, bases, skills, ontologies, chats, members, settings), and a face
selector over eight options is a worse control than eight nav rows.

**Recommendation.** Do not give a workspace face tabs. Give it the three things that make /home feel
newer, none of which is the tab row:

1. **One header strip** (A.4 → H0's shape): no page title, the page's ONE primary action on the
   left over its object column, controls right. The sidebar already says where you are; the five
   titles are the duplicate claim `sidebar.tsx:6-8` already rejected for the workspace switcher.
2. **One object column** — the workspace's per-page left columns become the same column recipe
   (`WellsColumn` + a card row), so "pick a thing" is one control on every page.
3. **The record surface** (A6) as the single white card, with `Crossfade` on selection changes
   *inside* a page (C2), never across routes.

**Needs Samuel's ruling:** E1, E2, E4.

### C2 — Crossfade across routes

/home crossfades because its faces are state. A workspace remounts `.pageCard` on every route
change with no transition. Making route changes crossfade means either (a) a shared-layout
transition inside `AppShellLayout`, or (b) accepting the hard swap. **Recommendation: (b) for routes,
(a) for in-page selection changes** — which is what `Crossfade`'s three existing callers already do
(`knowledge-v2/detail/detail-panel.tsx`, `channels/components/info-panel.tsx`, `home-panes.tsx`).

### C3 — What /home lacks that the workspace has (parity runs both ways)

- The guidance/notice layer: `TourProviderCore`, `JoinRequestNoticesCore`, `ConnectAgentBanner`,
  `WelcomePopup` (`app-shell.tsx:252,269,270,271`) — **none mounted on /home** (A12). All four are
  already host-agnostic `src/features` components. **E7.**
- `MyAccessProvider` (`app-shell.tsx:258`) — /home mounts it only inside the KB view
  (`knowledge-base-view.tsx:7`), so any teams-mode gate elsewhere on /home resolves to a false edit
  affordance (the exact failure `app-shell.tsx:256-257` warns about).

---

## D. Shared-tree readiness

**The contract** (`docs/INVARIANTS.md` §1, 2026-09-17): `apps/desktop-ui` **can** import root `src/`
(`@/shared/**` and feature components — /home already does so from **11 feature paths**); the Next
tree can **not** import `apps/` at all. So a face two trees render is **declared in `src/` and
re-exported by the SPA**. The second half of the rule: **sharing a component does not share the
stylesheet** — the SPA loads `apps/desktop-ui/src/styles/index.css` (Tailwind + `tokens.css` +
`kit.css`) plus its own CSS modules; the landing loads `src/app/globals.css` + `marketing.css`.

### D.1 — Already down (the proven pattern, all four moved 2026-09-17)

| Recipe | Now lives at | SPA re-export | Second host |
| --- | --- | --- | --- |
| `PAGE_ACTION_BTN` / `PAGE_ACTION_ICON` | `src/shared/ui/page-action-button.ts` (34) | `pages/home/panel-buttons.tsx:24` | `banner-demo/demo-home-chrome.tsx:52` |
| `HOME_TABS` / `HomeTab` | `src/features/home/tabs.ts` (57) | `pages/home/home-tabs.ts:24-26` | `demo-home-chrome.tsx:55` |
| `HOME_CHANNEL_WELLS` / `_KEY` | `src/features/channels/components/home-channel-wells.ts` (54) | `pages/home/channel-wells.ts:49-53` | `demo-home-chrome.tsx:61-63` |
| `HomeChannelRow` | `src/shared/ui/home-channel-row.tsx` (222) | mounted directly at `relationship-list.tsx:2` | `demo-home-chrome.tsx:54` |

Plus, already shared and needing no move: `home-card-marks.tsx` (159), `panel-well.ts` (76),
`section-panel.tsx`, `collapse-wells.tsx` (364), `segmented-control.tsx`, `crossfade.tsx`,
`empty-state.tsx`, `skeleton.tsx`, `form-dialog.tsx`, `standard-dialog.tsx`, `usage-meter.tsx`,
`popover-menu.tsx`, `select-menu.tsx`, `open-scale-button.tsx`, `naked-icon-button.ts`, `wells.ts`.
/home imports **27 distinct `@/shared/**` paths** and **11 feature areas** — re-derive with
`grep -rh 'from "@/shared/' apps/desktop-ui/src/pages/home/*.tsx | sort -u`.

### D.2 — Move-down candidates, with line counts

| # | What | Current path | Lines | Why it must move | Blocker |
| --- | --- | --- | --- | --- | --- |
| D1 | **`AccountRail`** | `apps/desktop-ui/src/components/app-shell/account-rail.tsx` + `› account-rail.module.css` | 92 + 152 = **244** | Both SPA hosts mount it and the landing had to re-cut it (`demo-home-chrome.tsx:74-120`) | `#/assets/dopl-mark.png?inline` (a Vite `?inline` import) — needs a `mark` prop or a `src/` asset |
| D2 | **`AppShellLayout`** (the assembly) | `apps/desktop-ui/src/components/app-shell/app-shell.tsx` | **327** | It is the ONLY place the six frame boxes are composed; its CSS module already lives in `src/shared/layout/app-shell/` | Router (`react-router`) + transport (`useApiQuery`) — the `*Core` idiom already solves this (`app-sidebar-core.tsx:107-110`) |
| D3 | **`ShellChromeSkeleton`** | `apps/desktop-ui/src/components/skeletons/shell-skeleton.tsx` | **151** | Moves with D2 (it reads the same module, class for class — `:23-30`) | as D2 |
| D4 | **`HomeHeader` strip** | `apps/desktop-ui/src/pages/home/home-header.tsx` | **104** | The landing copies its markup (`demo-home-chrome.tsx:46-73`); the workspace needs one header | none — it is pure markup over already-shared recipes (`:1-6`) |
| D5 | **`BarSeries` / `PLOT_HEIGHT_CLASS`** | `apps/desktop-ui/src/components/charts/bar-series.tsx` | **256** | The only chart recipe in the app; two SPA hosts; any web analytics page would need it | none — it is a pure component |
| D6 | **`HomeSearch`** | `apps/desktop-ui/src/pages/home/home-search.tsx` | **70** | Landing re-cut it (`demo-home-chrome.tsx:88-101`); a workspace search would need it | none |
| D7 | **`HomeSettingsControl`** | `apps/desktop-ui/src/pages/home/home-settings-control.tsx` | **133** | Only if the workspace adopts a Profile pill | `#/components/settings-modal` (SPA binding) |
| D8 | 🟡 **THE WORKSPACE HALF WAS TAKEN FIRST (wave 4); /home's is NOT done.** **`RelationshipList` → an `ObjectColumn`** | `apps/desktop-ui/src/pages/home/relationship-list.tsx` | **231** (measured 2026-09-17; of which the row derivation should stay) | The generic half (290px column + `WellsColumn` + empty sentence) is what every workspace page's left column wants | the derivation reads `HomeRow` — split it first. ⚠ **AND THE MOVE-DOWN IS BLOCKED BY R-03 FOR NOW**: the workspace picker gets its own design later, so there is no second host for a shared column yet. What wave 4 DID take is the same seam on the workspace side — `channels/components/sidebar.tsx`'s search head is `› sidebar-search.tsx`, sections and search being two reasons to change |
| D9 | **The five faces** | `pages/home/{overview,knowledge,agent,ontology}-panels.tsx` + `overview-*.tsx` | **2 200+** | Only if the web ever renders /home again | HIGH — they read `#/hooks/use-api-query`, `#/components/page-states` |
| D10 | **`home.module.css › .kbCards` / `.kbCell`** | `apps/desktop-ui/src/pages/home/home.module.css:200-249` | **50** | The grid should be a variant of `knowledge-v2`'s own, not a fourth rebind of `--kv-*` | none |
| D11 | **`page-states.tsx › PageError` / `PageLoading`** | `apps/desktop-ui/src/components/page-states.tsx` | **86** | Both hosts' error branch is byte-identical (A28) | none |
| D12 | **`.glass-panel`, `.hairline`, `.hairline-strong`** | `src/app/globals.css:904`, `:622`, `:626` | ~30 | Present in `globals.css`, **absent from `kit.css`** — the SPA cannot render `/link/{token}`'s card | none; but **add a class-parity gate** — the token gate does not see this (B22, E6) |
| D13 | **`FullScreenError` wrapper** | duplicated at `pages/home/index.tsx:137` and `app-shell.tsx:195` | 6 ×2 | trivial | none |
| D14 | **A `RECORD_SURFACE` constant** | duplicated at `pages/home/index.tsx:284` and `app-shell.module.css:140-150` | ~10 | A6 — the most load-bearing duplication in the doc | the two spellings differ (utility string vs CSS module); pick the module and let /home compose it |

**Rough total for D1–D8 + D10–D14: ≈ 1 600 lines to move down**, against ≈ 8 200 lines of /home
composition that stay. The ratio is the point: **the /home *page* is host-specific; the /home *system*
is 1 600 lines and is already halfway down.**

---

## E. Items needing Samuel's ruling

**E1 — The channel picker: two designs, one app.**
/home picks a channel from 290px of collapsible gray wells holding raised cards with avatar stacks,
`@ N` pills and a black selected face (`relationship-list.tsx:117-158`, `home-channel-row.tsx`).
The workspace channels page picks one from a flat nav tree of 36px rows with a `raised-tab`
selection and no counts (`channels/components/sidebar.tsx`, `sidebar-rows.tsx:52-63`).
Options: **(a)** the workspace tree adopts the /home column outright; **(b)** it keeps the tree but
adopts the ROW (card face, avatar stack, marks) — needs an unread COUNT the payload does not have
(B5); **(c)** they stay different because a workspace tree nests threads and sections and /home's
does not.
**Recommendation: (b), staged — adopt the card face and the well grouping now, and file the unread
count as a separate data change.** The tree's nesting and its Favorites/DM sections are real
structure a flat well column would lose.

**E2 — Does a workspace get a header strip, and does it lose its page titles?**
/home has no title; the workspace has five different ones (A.4). One header strip means "Overview",
"Agents", "Skills", "Settings" and the Knowledge hero all go away, and the sidebar becomes the only
statement of where you are.
**Recommendation: yes, one strip, no titles** — it is the minimal-copy ruling applied to chrome, and
it is what makes /home read as newer. **The Knowledge hero band and its marketing paragraph
(`knowledge-home.tsx:122-145`) are the one deletion that needs your word.**

**E3 — What does search search?**
/home's pill filters the channel column (`home-search.tsx:13-16`). A workspace-wide search is a
different feature (and the `ui/search-panel` Cmd+K branch is not in this tree).
Options: **(a)** per-page filter, the /home shape, one line of wiring per page; **(b)** one
workspace-wide search panel; **(c)** both.
**Recommendation: (a) now, (b) as its own wave** — (a) is free and makes the header symmetric.

**E4 — Does the workspace shell get a record-pane crossfade?**
**Recommendation: no for routes, yes for in-page selection** (C2). Needs your word only because it
is visible motion.

**E5 — Which section language wins?**
/home is flat (`SectionPanel` on `--home-panel`, no hairline — your 2026-09-13 *"you're adding this
extra border line around the gray. I did not ask for that"*). The workspace still uses the concave
`SectionBox` on Members ×5, Billing, Ontology's template editor and Knowledge's Contents (B8), and
`SECTION_PANEL_GROUND` keeps a hairline `PANEL_WELL` does not.
**Recommendation: flat everywhere; delete `SectionBox`'s remaining consumers in a dedicated pass.**

**E6 — The kit class layer has no drift gate.**
`scripts/check-css-token-drift.ts:16-22` compares `--*` declarations only. Four recipes are in
`globals.css` and not in `kit.css` today (`.glass-panel`, `.hairline`, `.hairline-strong`, plus the
landing/login set) and nothing failed.
**Recommendation: extend the script to compare the `@layer components` class SET (names only, not
bodies) and add its row to `CLAUDE.md` §*Definition of green* in the same change** — the convention
the last five gates followed.

**E7 — Should /home mount the guidance layer?**
Tour, join-request notices, the connect-agent banner and the welcome popup are workspace-only today
(A12) and all four are host-agnostic. A first-run user who lands on /home (the desktop's landing
surface, `home-tabs.ts:28-42`) sees none of them.
**Recommendation: mount `ConnectAgentBanner` and `WelcomePopup` on /home; leave Tour on the
workspace** (its steps are keyed by `NavSection`, `tour-steps.ts`).

→ 🔴 **OVERRULED, AND EXECUTED THE OTHER WAY (Samuel's ruling R-49, 2026-09-17; wave 7).** Nothing is
mounted on /home: all four surfaces are **DELETED**, on the workspace too. A first-run experience is
designed fresh when it is wanted. INVARIANTS §15 carries what went and what survives.

**E8 — Skills, Chats and Ontology have no page skeleton.**
`section-skeleton.tsx:15-19` argues that inventing three shapes to fill the table is worse than
`PageLoading`. /home has eleven bespoke shapes.
**Recommendation: uphold `section-skeleton.tsx`'s own argument — no new ghosts** unless you have
seen one of the three flash and disliked it.

**E9 — A doc-vs-code disagreement to file as F-714.**
`docs/DESIGN-SYSTEM.md:13` says the workspace Overview and /home's Overview face *"share `BarSeries`
and `pages/overview/overview-bits.tsx`"*. `BarSeries` is shared
(`overview-sections.tsx:12-15`, `overview/activity-chart.tsx:7-10`); **`overview-bits.tsx` is not** —
`grep -rn 'overview-bits' apps/desktop-ui/src/pages/home` is empty, and its only readers are
`overview/period-stats.tsx:4` and `› stat-cards.tsx:4`. Per `CLAUDE.md`, the doc is the wrong side
here and should be corrected in the same change as whichever wave touches it. The next free finding
id is **F-714** (highest claimed on this branch: `docs/REFACTOR-FINDINGS.md:9472 › F-713`; re-derive
across live branches before allocating).

**E10 — Does the workspace adopt /home's account palette skin?**
`home.module.css:56-168` repaints the shared channel surface's dividers to `--home-panel-line` at
2px and its composer panels to `--home-panel`, **scoped to /home on purpose** (`:37-41`). Parity
either promotes that skin to the app (and the fence disappears) or keeps two looks for one surface.
**Recommendation: promote it** — it is the same argument the 2026-08-30 frame ruling already made
(`docs/DESIGN-SYSTEM.md:95-96`), and it deletes six fragile `:global()` utility-class selectors.

**E11 — `AppPanel` is dead.** `src/shared/layout/app-shell/app-panel.tsx:20`, zero call sites.
**Recommendation: delete** (delete-don't-disarm).

**E12 — Two declarations of the 36px black pill.** `PAGE_ACTION_BTN`
(`src/shared/ui/page-action-button.ts:30`) and `TAB_ACTION` (`channels/components/bits.tsx:69`) are
the same face in two root-tree files that can see each other; `ontology-view.tsx:9-15` records that
the split was a tree-boundary workaround that **no longer applies** since the 2026-09-17 move.
**Recommendation: `TAB_ACTION` composes `PAGE_ACTION_BTN`; then sweep the ~20 hand-cut sites (B3).**

---

## F. Target structure

### F.1 — The model already exists, twice

Nothing below is new architecture. It is `ChannelSurface` and `OntologyView` applied to the rest of
the app.

**`ChannelSurface`** — `src/features/channels/components/channel-surface.tsx:97-186`. One
implementation, **three hosts**, zero forks:

| Host | Slots | Capabilities |
| --- | --- | --- |
| workspace page | none | none (defaults) — `channels-core.tsx` |
| /home | `infoTab` (`relationship-record.tsx:95-103`) | `{memberManagement:false, peerNamedHeader:false, artifacts:true}` (`:140-144`) |
| guest web | none | `{memberManagement:false, selfManagement:false}` (`guest-channel.tsx:158-161`) |

**`OntologyView`** — `src/features/ontology/components/ontology-view.tsx`. One implementation, two
hosts, four knobs: `pinnedOntologyId` (`:57`), `onSelectOntology` (`:60`), `onCreateOntology` (`:73`),
`settingsMenu(close)` (`:83`), and — the one that matters here — **`frameless`** (`:103`): *"`true`
when the host already IS a floated page panel… the view then fills the host instead of raising a
second `.page-float`."*

### F.2 — The target

```
src/shared/layout/app-shell/           ONE SHELL
  app-shell.module.css                 (already here — the six boxes, levels 0-3)
  app-shell-core.tsx                   ← D2: AppShellLayout, router+transport injected
  account-rail.tsx / .module.css       ← D1
  chrome-skeleton.tsx                  ← D3: the same six boxes, ghosted
      slots:  rail | leftColumn | header | children
      the host supplies:  router, transport, and what goes in the left column

src/shared/ui/
  page-header-strip.tsx                ← D4: ONE header. no title.
      slots:  lead (the primary action, sized to the object column) | selector | controls
  object-column.tsx                    ← D8 (generic half): 290px, WellsColumn, two empty sentences
  record-surface.ts                    ← D14: the level-2 card, as ONE declaration
  page-action-button.ts                (already here — and TAB_ACTION composes it, E12)
  home-channel-row.tsx, home-card-marks.tsx, panel-well.ts, section-panel.tsx,
  collapse-wells.tsx, segmented-control.tsx, crossfade.tsx, skeleton.tsx,
  form-dialog.tsx, empty-state.tsx     (already here)
  charts/bar-series.tsx                ← D5

src/features/<x>/components/<x>-view.tsx     ONE VIEW PER OBJECT
      props:  frameless?  |  pinned<Thing>Id?  |  on Select/Create  |  settingsMenu?
              |  slots?  |  capabilities?  |  loadingSkeleton?
      — exactly the shape ontology-view.tsx and agent-templates-core.tsx already have

apps/desktop-ui/src/pages/**           HOSTS, and nothing else
      a page is: pick the view, pass the capabilities, hand it the transport.
```

**Three rules that keep it at one implementation:**

1. **A view never names its own surface.** It takes `frameless` (or the host wraps it). The float
   collapse (`app-shell.module.css:166-172`) exists because sixteen surfaces already break this
   rule; `frameless` is the fix that scales.
2. **A face is declared in `src/`, the SPA re-exports it** (`docs/INVARIANTS.md` §1). The four
   2026-09-17 moves are the template; `panel-buttons.tsx:24` and `channel-wells.ts:49-53` are what a
   re-export looks like.
3. **A capability REMOVES or ADDS a behaviour and says which way it points**
   (`channel-surface.tsx:161-167`: *"DEFAULT `false`, WHICH INVERTS THE OTHER TWO"*). Never a
   `tone="home"` enum (`section-panel.tsx:60-64` argues this at length).

### F.3 — Migration order

Ordered so that each step is independently shippable and each one makes the next smaller.

| Wave | Steps | Why here |
| --- | --- | --- |
| **0 — no behaviour change** | E11 delete `AppPanel` · E12 `TAB_ACTION` composes `PAGE_ACTION_BTN` · D13 `FullScreenError` · D14 `RECORD_SURFACE` · D11 `page-states` · E6 the class-parity gate + D12 `.glass-panel` | Deletes four duplications and buys the gate that stops the next one. Nothing visible moves. |
| **1 — the header** | D4 move `HomeHeader` down → `PageHeaderStrip` · give `AppShellLayout` a header slot · migrate H2 (agents) → H3 (settings) → H4 (skills) → H1 (overview) → H5 (knowledge) | Five recipes → one. Each page is a one-file change. **H5 needs E2.** Do agents first: it is the closest to /home already and has a `loadingSkeleton` slot to copy the idiom from. |
| **2 — the black pill** | B3 sweep the ~20 hand-cut `auth-btn-3d` sites onto `PAGE_ACTION_BTN` / `TAB_ACTION`, killing `text-white` | Mechanical, and Wave 1 has already put a constant at every header. |
| **3 — the sections** | E5 flat everywhere: `SECTION_PANEL_GROUND` loses its hairline (or /home gains one — your call) · delete `SectionBox`'s eight consumers · D10 fold `.kbCards` into `knowledge-v2` | One section language. |
| **4 — the object column** | D8 split `RelationshipList` into derivation + `ObjectColumn` · adopt it on knowledge, agents, skills, chats · **E1** decides what happens to the channels tree | The biggest visible change and the one that most needs a ruling first. |
| **5 — the shell** | D2 + D3 + D1: `AppShellLayout` and the rail move to `src/shared/layout/app-shell/` behind the `*Core` idiom | Last, because Waves 1–4 shrink what it has to carry — and because moving the shell while five headers are still in flight is the change that breaks everything at once. |
| **6 — the gaps** | E7 mount the guidance layer on /home · `MyAccessProvider` on /home · E3(a) per-page filter · B5 the unread count (a data change, own wave) | Parity running the other way. |
| **deferred** | D9 (the five faces), E3(b) (the search panel), B26 (notch) | Each is its own project. |

---

## Confidence and gaps

**High confidence.** Everything in §0 (no web workspace app, no `app-shell.tsx` in `src/shared`,
`AppPanel` dead), §A.1–A.4, §B1–B4, §B22–B25, §D.1, §D.2 D1–D8/D10–D14, and §F.1. These are direct
reads of the files cited, most of them cross-checked twice (once by me, once by an independent
sweep). The dark-mode finding (B24) is an exhaustive negative grep over five patterns and is as
certain as a negative gets.

**Medium confidence.**
- **Line counts** are `wc -l` at `03506fcd`; the /home total (8 241) excludes `*.test.*`,
  `*-test-harness.*`, `*-test-fixtures.*` and `home-test-ids.ts` — a different exclusion set moves it.
- **The "~20 hand-cut `auth-btn-3d` sites" (B3)** is a grep over `*.tsx`/`*.ts` excluding tests,
  marketing and `globals.css`; it includes auth/onboarding/billing files that
  `docs/DESIGN-SYSTEM.md:30-31` exempts from the kit ("marketing pages and auth + onboarding — their
  own glass/3D kit"). **The in-scope count is smaller than 20 and I did not partition it.**
- **The `FormDialog` conformance counts (B16)** are read from `docs/DESIGN-SYSTEM.md:386-440`
  (measured 2026-09-08 / re-counted 2026-09-13), not re-measured here. The doc gives the re-derive:
  `grep -rln 'FormDialog' src apps`.

**Gaps — what I did not do.**
1. **I did not read the test suites.** Many of the rulings quoted are pinned by tests
   (`frame-palette.test.ts` 500, `page-skeletons.test.tsx` 451, `collapse-wells.test.tsx`,
   `demo-class-coverage.test.tsx`), and those pins are what a migration wave will actually fight.
   A follow-up should map which pins each wave in §F.3 breaks.
2. **I did not run anything** — no build, no lint, no `check-css-token-drift`. E6's claim that the
   class layer is ungated is read from the script's source (`scripts/check-css-token-drift.ts:16-22`,
   `:61`), not from a failing run.
3. **The Overview comparison (A13) is structural, not visual.** Both Overviews are large
   (868 + ~1 640 lines) and I compared their composition, not their rendered output. Whether they are
   "the same page twice" or "two genuinely different reports" is a product question I flagged rather
   than answered.
4. **`src/features/playground/**` was surveyed only where it consumes shared recipes.** It has its
   own shell (`playground-shell.module.css`) and its panes hand-roll several recipes
   (`members-pane.tsx`, `skills-pane.tsx` carry `text-[Npx]`). If the playground is live product it
   belongs in table A; if it is a demo it belongs with marketing. **Unresolved.**
5. **`ui/search-panel` and `ui/notch-bar` are not in this worktree** (B26), so anything those
   branches already built is invisible to this document.
6. **No screenshots, by standing rule.** Every visual claim is a reading of classes and tokens, not
   of pixels; a live review could disagree with any of §B.
