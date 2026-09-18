# 00 — MASTER: workspace parity with the desktop home space

**Synthesis of the six area audits (01–06) plus the KB snapshot (07), built 2026-09-17 against
`docs/workspace-parity` @ `03506fcd` (= `master`). Docs-only; no source file was changed.**

> ⚠ **Every `path:line` in this document is a MEASUREMENT taken 2026-09-17, not an anchor.**
> CLAUDE.md § *Standing rules for writing docs* rule 2 says a bare line number is wrong within a
> day. The symbol is the reference; the number is a finding aid. Re-grep before acting.
> The 500-line cap is a **code** rule (`eslint.config.mjs › "max-lines"` over `src/**`,
> `packages/*/src/**`, `apps/*/src/**` — INVARIANTS §1); docs are not capped, so this is one file.

---

## 0. Read me first

> ✅ **RULINGS RECORDED 2026-09-17.** Every R-id in §2.4 now carries a `→ ✅ RULED 2026-09-17 — Samuel:`
> line under it, in place. §5 and §6 are updated where a ruling changed the work.
> ⚠ **Items sourced from the 2026-08-30 drift ledger are EXPIRED unless re-found in current code**
> (Samuel: the web app was retired then; three-week-old audit questions are not to be acted on).
> That is R-43 in general and R-13 in particular — do not open either as a batch.

This is the master list for bringing **workspaces** up to the **desktop home space**, and the
roadmap for getting there with less code than we have now, not more.

**The premise in the brief was wrong in one way that changes the plan.** There is **no web
workspace app**. `find src/app -name 'page.tsx'` returns 21–23 routes and not one is
workspace-scoped (01 §0; 03 §0). The hosts that actually exist are:

1. **WS** — the desktop workspace pages (`apps/desktop-ui/src/pages/*`), eight routed pages in a shell.
2. **HOME** — the desktop `/home` account surface (`apps/desktop-ui/src/pages/home/**`).
3. **GUEST** — the web `/c/{containerId}` lane, the only product surface left on the web.
4. **DEMO** — the marketing hero, a fourth **read-only** host that re-renders /home's chrome.

So parity is a **WS ↔ HOME** question, with GUEST as a genuinely different-in-kind lane and DEMO as
a reason some /home code must live in `src/` rather than `apps/`.

**Headline numbers.** The six audits carry well over 500 inventory rows between them; deduplicated
they become **183**: **40 to port**, **41 to keep**, **34 to remove or change**, **49 rulings for
you**, **19 reverse-map rows** — plus **63 UI/UX differences**, **9 waves**, and **≈1,600 lines** to
move down into the shared tree against **≈8,200** lines of /home composition that stay where they
are. **Seven rulings block wave 1: R-18, R-19, R-20, R-21, R-22, R-45, R-46.** R-08 was in that
list and is **not** a wave-1 blocker — nothing in wave 1 asks whether a room is shared. It blocks
**wave 0**, which is where the predicate is executed, so it is still the first thing you rule on.

---

## 1. Executive summary

**1. There is no web workspace app, so parity is a two-host question, not a three-host one.**
The website is retiring; `src/features/workspaces/url.ts:16-18` already hands workspace deep links
to `dopl://open/{segment}`. Anything scoped as "fix the web workspace pages" is scoped against a
surface that does not exist. *(03 §0; 01 §0)*

**2. The channel surface is already one implementation. What is broken is smaller and sharper than
"the workspace page is old."** Three things: one capability switched off for workspaces
(`artifacts`), **four hand-wirings of one component** that have already drifted (the agent pane on
WS renders no colour), and **one slot that replaces a body** instead of adding to it — which is the
exact mechanism that has now lost a capability on /home three times in three weeks. *(01 §A/§C;
02 §0/§C; 06 "The one hazard this archive exists to prevent")*

**3. The expensive fork is underneath the UI, not in it.** "Which channels am I in and what is
their state" is answered by **three projections, two routes, two client caches and two hand-written
cache-to-cache bridges** — and that has already produced a user-visible bug Samuel reported
("the bookmark icon like alway breaks and is super buggy", `use-home-channel-sync.ts:23-34`). One
projection with `scope=container|account` deletes both bridges. *(05 §A.2, §B.2)*

**4. Parity runs both ways, and the home side has two live gaps plus an orphan class.** /home has
no Chats face and no Skills face, while `dopl_chats(op="export")` with no `workspace=` already
resolves the caller's personal container and files a chat **nothing in the product lists**. /home
also mounts none of the guidance layer and no `MyAccessProvider`, so `canEdit` falls open there.
Conversely /home's Overview analytics (credits by channel / person / tool, live agent board, token
spend, a range switcher) is the one place the home space is genuinely ahead in **function**.
*(04 §B-1, §B-2, §B-6, §B-8; 03 §A12, §C3)*

**5. Nothing here is safe to start today — gates before ports.** The **root lint is red** at HEAD
(F-688, sixteen unexempted files over the 500-line cap), **/home cannot tell a member from a guest**
inside a container (F-343, `containerTarget.role` hardcoded `"owner"` — ✅ **fixed 2026-09-17 in
`5d9f215d`**, after this capture was taken), and a ruling that changes
**workspace** behaviour is recorded but unexecuted (F-513: three sites still gate on the kind —
`mcp-server/src/factory.ts › lockedTo`, `tools/confirm-token.ts › sharedContainer`,
`workspaces/server/shared-publish.ts › assertSharedPublishAcknowledged` — while a fourth spelling,
`channels/lib/tool-profile-resolve.ts › isSharedChannel`, is **already kind-blind**, so the tree
answers "is this room shared" two ways today). Samuel's own standing rule: red CI is a P0, and the prior drift audit's advice
was *"Gates first… without them §4 is re-audited in six weeks."* *(06 §C.0, §C.1, P25; 04 §0.6)*

---

## 2. Parity map — the five lists

Rows are deduplicated across 01–06. Each keeps its strongest `path:line` evidence and names the
research doc it came from (e.g. "01 §A row 5").

### 2.1 — List 1: PORT to workspaces (functionality)

**Size:** S ≤ 1 day · M = a few days · L = its own wave.
**Mechanism:** flag flip · hand-wiring · collapse duplicate · new adapter · new code · move down.

| # | Item | What home has | What workspace has | Mechanism | Size | Depends on | Ref |
|---|---|---|---|---|---|---|---|
| P1 | Agent pane colour banner | `color` resolved off `data.liveAgents` (`surface-agent-view.tsx:54-58`) | never passed (`overlays.tsx:73-86`) → `agent-panel.tsx:179` defaults `null` | collapse duplicate (C1) | S | — | 01 §A row 5; 02 A.4 P2 |
| P2 | One wiring of `ChannelsAgentPanel` | `SurfaceAgentView` (12 props derived from `data`) | the same 12 props forwarded by hand through `ChannelsOverlays`; **9 of `ChannelsOverlays`'s own 19 props disappear** with the collapse (counted at `overlays.tsx › ChannelsOverlays`, 2026-09-17 — the doc previously said "14 forwarded props") | collapse duplicate | S | — | 01 §C1; 02 §C1 |
| P3 | ✅ **DONE 2026-09-17 (wave 2)** — Artifacts face (list + opened artifact) | `artifacts: true` (`relationship-record.tsx › RelationshipRecord`) | **`channels-core.tsx › ChannelsCore` passes `capabilities={{ artifacts: true }}`** (R-16(a); the guest lane still does not — see the wave row) | flag flip | S | R-16, F-712 | 01 §A row 49; 02 A.2 R1/R4/R5 |
| P4 | ✅ **DONE 2026-09-17 (wave 2)** — Threads↔Artifacts toggle + tab-heading flip + badge drop | drawn (`threads-tab.tsx › ThreadsTab`, `info-panel-tabs.ts › threadsFaceOption`) | engages; pinned at the PAGE by `channels-core-artifacts.test.tsx` (R-17: a toggle, never a fifth tab) | rides P3 | S | R-16, R-17 | 02 A.2 R2/R3 |
| P5 | ✅ **DONE 2026-09-17 (wave 2)** — Artifacts flat column + clip / member-ceiling notes | `artifacts-tab.tsx › ArtifactsTab`, `› ARTIFACTS_CLIPPED_NOTE`, `› OpenArtifact` | the same component, mounted with the face | rides P3 | S | R-16 | 02 A.2 R8/R11 |
| P6 | Curated `info_card` custom rows (hover ×) | `person-info-tab.tsx:305-314` | `grep -c infoCard info-tab.tsx` = **0**, though the column is validated and PATCH-writable | collapse duplicate | M | R-19 | 01 §A row 60 |
| P7 | ONE info-tab body (absorb `person-info-tab.tsx`) | forked 395-line body | `info-tab.tsx` | collapse duplicate | M | R-19..R-22, R-45, R-46 | 01 §C2 |
| P8 | `activity: {bins, loading}` on `ChannelInfoTabContext` | own hook wrapper `person-thread-activity.tsx:47` | handed down `info-tab.tsx:248-263` | collapse duplicate | S | — | 01 §A row 51; 02 §C4 |
| P9 | `members` + `headerEditable` on the context | second `useChannelMembers` (`person-info-tab.tsx:166-169`); rule spelled twice (`:144` / `info-tab.tsx:106`) | one source | collapse duplicate | S | — | 01 §A rows 54/55 |
| P10 | 🟡 **MOVED 2026-09-17 (wave 2); the CALL SITES are not** — channel-record loading ghost, promoted to the shared tree | real two-column shape, tab count by import (`src/features/channels/components/channel-record-skeleton.tsx`); `pages/home/channel-record-skeleton.tsx` is a re-export | `channels-skeleton.tsx › ChannelsSkeleton`, still self-described *"a rough fit"*; GUEST still uses kit generics | move down ✅ + new call sites 🔴 | S | — | 01 §C4; 06 P13; F-220 |
| P11 | 🔴 **CLOSED BY R-03, NOT BUILT (Wave 4, 2026-09-17)** — the workspace picker gets its OWN design later, so no well is added to it; `home-channel-wells.ts` stays shared and unported. Recency wells on the channel picker (Pinned / Recent / Earlier) | `relationship-list.tsx:125-128` over `home-channel-wells.ts:48-52` (already in `src/`) | flat tree (`sidebar.tsx`) | new call site over a shared module | S | R-03 | 01 §A row 71; 03 §E1 |
| P12 | 🟡 **SPLIT BY R-03 (Wave 4, 2026-09-17): the FACE is closed, the AVATAR STACK is DONE.** No card face and no selected face are ported — the picker's own design is a later wave. The STACK is not a face: it is `Channel.peers`, the same fact off the same projection, so the workspace row draws it through the same `AvatarStack` and the same derivation (`channels/lib/channel-display.ts › channelRowFaces`) in its own 36px layout. See U28. Channel row card face + avatar stack + selected face | `home-channel-row.tsx:129` wearing `HOME_CARD_FACE` (`home-card-marks.tsx:37,68`) | flat 36px `raised-tab` (`sidebar-rows.tsx:52-63`) | new call site | M | R-03, R-40 | 03 §B4; 01 §A row 74 |
| P13 | ✅ **THE COUNT IS BUILT (Wave 3, R-28)** — `Channel.mentionCount`, server-computed on every row of both scopes off the inbox's own `mentionContainmentFilter`; the workspace ROW's badge is Wave 4's. Unread **mention count** `@ N` on a channel row | `HomeChannel.unreadMentions` (`types.ts:164`) ← `repository-unread.ts › listMyMentionStamps` | boolean dot only; `sidebar-rows.tsx:69-73 › "NO UNREAD BADGE"` forbids inventing a count (the doc previously cited `:27-31`, which is the re-export docblock) | new code (server projection) | M | R-28 | 01 §A row 72; 05 A12 |
| P14 | Last-message preview on a row | `lastMessagePreview` on the wire (`types.ts:128`) — **rendered by nothing since 2026-09-13** | absent | new code, or delete the field | S | R-28 | 01 §A row 73; 05 A15 |
| P15 | Agents-tab recency wells recognised as a workspace surface | four wells (`agents-tab.tsx:417` → `agents-wells.tsx:123`) | **identical — already shared** | none (verify + keep) | S | — | 02 A.3 G4 |
| P16 | ✅ **DONE 2026-09-17 (wave 2)** — Held-gate Approve/Deny reachable from the agent WINDOW | `agent-window.tsx › ChannelsAgentWindow` mounts `agent-held-gate.tsx › AgentHeldGates` on both hosts' windows (one page, one implementation) | same | new wiring | M | R-24 | 02 A.5 W3 |
| P17 | ✅ **DONE 2026-09-17 (wave 2 review)** — One `AgentStats` | `src/features/channels/components/agent-stats.tsx › AgentStats` — the ONE declaration | the panel, the WINDOW and the marketing demo all import it; `AgentWindowStats` deleted | collapse duplicate | S | — | 02 §C2 |
| P18 | ✅ **DONE 2026-09-17 (wave 2 review)** — One template save/remove orchestration | `src/features/agent-templates/hooks/use-template-save.ts › useTemplateSave` | both hosts call it; what each ADDS rides `extras` | collapse duplicate → `use-template-save.ts` | S | — | 02 §C3 |
| P19 | ONE page header strip (no title) | `home-header.tsx:37-102` — one 36px row | **five recipes**: H1 overview greeting, H2 agents 52px bar, H3 settings bar, H4 skills, H5 knowledge hero | move down + new adapter | L | R-02 | 03 §A.4, §D4 |
| P20 | Per-page search | `home-search.tsx:44-67`, kit `.search-expand` pinned at 260px | none anywhere in the workspace shell | move down + one line per page | M | R-04 | 03 §A9, §E3 |
| P21 | `PAGE_ACTION_BTN` as the one 36px black pill | `src/shared/ui/page-action-button.ts:29-30` | `TAB_ACTION` (`bits.tsx:66-73`) + ~20 hand-cut `auth-btn-3d` sites with `text-white` | collapse duplicate | M | — | 03 §B1–B3, §E12 |
| P22 | `RECORD_SURFACE` — one declaration of the level-2 card | `pages/home/index.tsx:284-285` (utility string) | `app-shell.module.css:140-150` (CSS module) | collapse duplicate | S | — | 03 §A6, §D14 |
| P23 | `FullScreenError` wrapper | `pages/home/index.tsx:135-148` | `app-shell.tsx:193-199` — byte-identical | collapse duplicate | S | — | 03 §A28, §D13 |
| ✅ P24 | `.glass-panel` / `.hairline` / `.hairline-strong` in the SPA kit | n/a | in `globals.css`, **absent from `kit.css`** | DONE 2026-09-17: `.glass-panel` mirrored byte-exact into `kit.css`; `.hairline` / `.hairline-strong` had ZERO users in either tree and were DELETED from `globals.css` instead. Gate: `check-css-token-drift.ts` compares the `@layer components` class set (R-41) | S | R-41 | 03 §B22, §D12 |
| ✅ P25 | `Crossfade` on in-page selection changes — **AND ON PAGE SWITCHES (R-05 chose (a))** | `pages/home/index.tsx:294` | DONE 2026-09-17 (wave 5): `app-shell.tsx › AppShellLayout` wraps `<Outlet/>` in `Crossfade`, token = the PAGE segment (a record pick inside a page is that page's own fade, not a second one). ⚠ The outgoing page is the ROUTER's tree, so the token says WHEN to fade, not WHAT to hold | new call site | S | R-05 | 03 §B14, §C2 |
| P26 | `FormDialog` conformance for the 8 remaining input forms | 2 /home dialogs conform | 5 conform, **8 `Todo`** (`grep -c 'Todo' docs/DESIGN-SYSTEM.md` = 10, of which 2 are prose; the doc previously said 9) (`create-channel-dialog`, `direct-message-dialog`, `base-settings-modal`, `create-base-dialog`, `move-to-dialog`, `create-team-dialog`, `members/invite-dialog`, `create-skill-dialog`) | new code, 9 small rewrites | M | — | 03 §B16 |
| P27 | ✅ **DONE 2026-09-17 (wave 6)** — flat section language (`SectionPanel` paints `SECTION_PANEL_GROUND` itself) | one ground, no hairline, on every host | the hairline is `border-transparent`; `SectionBox`'s desktop consumers are `SectionPanel` (X13) | CSS + delete consumers | M | R-39 | 03 §B7/B8, §E5 |
| P28 | ✅ **DONE 2026-09-17 (wave 6)** — the account palette skin over the shared channel surface | the six rules are the KIT's, keyed on `data-frame-skin` (`src/app/globals.css` › THE ACCOUNT PALETTE SKIN, mirrored in `kit.css`) | the workspace channels page wears the same attribute; the `marketing.css` port and the `[data-section-panel]` fence are deleted with it | CSS promotion | M | R-38 | 01 §D; 03 §B11, §E10 |
| P29 | Knowledge card grid as a variant of `knowledge-v2` | `home.module.css:200-249 › .kbCards` (a 4th `--kv-*` rebind) | `.cardGrid` in `knowledge-v2` | collapse duplicate | S | — | 03 §A15, §D10 |
| P30 | ✅ **DONE 2026-09-17 (Wave 3, R-26 (b)).** ONE channel-list resource, `?scope=container\|account`. `GET /api/home/channels` DELETED (the POST moved to `?scope=account`); `HomeChannel` deleted; the five home-only fields folded onto `Channel` as `types-list.ts › ChannelRowExtras`. `GET /api/channels/account/status` STAYS — it answers *what needs you*, not *what the rows are* | was `GET /api/home/channels` → `HomeChannel` | `GET /api/channels` → `Channel` | new adapter | L | R-26, R-27 | 05 §A.2, §B.3 collapse 1 |
| P31 | ✅ **DONE 2026-09-17 (Wave 3).** Both cache-to-cache bridges deleted with the second cache — one projection needs no bridge (§4.2 G4) | was `use-home-channel-sync.ts` (113 lines) + `use-home-unread-refresh.ts` | n/a | rides P30 | S | P30 | 05 §B.2 |
| P32 | ✅ **DONE 2026-09-17 (Wave 3, R-27).** ONE wire name for `channel_members.favorited_at` — `myFavoritedAt`, on `Channel`, on the home row **and** on `ChannelMember` (a THIRD spelling the audit had not counted). ⚠ Not cross-package after all: the SDK's `HomeChannel` mirror never carried the field | was `HomeChannel.favoritedAt` | `Channel.myFavoritedAt` | rename | M | R-27 | 05 §A10, §R7 |
| P33 | ✅ **DONE 2026-09-17 (Wave 8, R-29(b)).** ONE overview **series** vocabulary in `src/features/overview-series/windows.ts` — the range union, the bucket, `overviewWindows`, `overviewSince`, `binByWindow`'s zero-fill. Both hosts are adapters over it; the workspace series gained `range` + a `credits` metric + `truncated`. ⚠ **THE PAYLOADS DID NOT MERGE and that is the ruling** — two fences, two wire shapes (INVARIANTS §9). ⚠ Two host-specific facts: the workspace set has **no `24h`** (its bin is a calendar DAY) and **defaults to `31d`**, the pre-wave window the Info-tab strip reads | `credits\|mcp\|messages`, 4 ranges, `&channel=`, `&month=` | `messages\|mcp\|threads\|credits`, `&range=`, `&channelId=` | new adapter | M | R-29 | 05 §A19, §B.3 collapse 2 |
| P34 | ✅ **DONE 2026-09-17 (Wave 8, R-29(b)).** The workspace Overview now carries the credit BREAKDOWN (`pages/overview/usage-rails.tsx`, on `WorkspaceOverview.usage`), the LIVE AGENT BOARD (`pages/overview/agent-board.tsx`, R-25 semantics, peer rows read-only) and a TOKEN SPEND panel (`pages/overview/token-spend.tsx`, `GET /api/workspaces/[workspaceSlug]/token-spend`). All three fenced per container: seat wallets only (`workspaces/server/service-usage.ts › isWorkspaceSeatBurn`), the by-channel rail viewer-filtered because it prints a name, the board carrying none of the seven operator-only columns. 🔒 **TOKEN SPEND IS PER-MEMBER-OWN AND THERE IS NO WORKSPACE-WIDE FIGURE** — the fence decision, recorded in INVARIANTS §9. The three /home components were EXTRACTED rather than copied (`#/components/overview/{rank-rail,agent-board,token-spend-strip}.tsx`); /home's face is unchanged (R-40) | `overview-panels.tsx` `CreditsBar`, `TokenSpendPanel`, `overview-agent-board.tsx` | ⚠ **CORRECTED 2026-09-17** — the workspace Overview was **not** spend-free: it already read `useWorkspaceEntitlements` and rendered `<PeriodStats credits=…>`. What was missing is what this row shipped | new code, fenced per container | L | R-29 | 02 A.8 C-2/C-3 (corrected); 04 §A-25, §B-8 |
| P35 | `truncated` + one clipped-list wording on merged reads | three non-reporting ceilings (200/50/500) | reports `truncated` | collapse duplicate | S | P30 | 05 §B.3 collapse 3 |
| P36 | `isSoleAudience` as one derivation | hand-spelled `memberCount === 1` | same, in five places | collapse duplicate | S | R-08 | 05 §D.3 |
| P37 | `containerNoun(kind)` for agent-facing copy | `containerKindLabel` exists (`workspace-directory.ts:218`) | ~8 hardcoded "this workspace" strings in `tools/map.ts`, `tools/members.ts`, `channel-ops-hold-workspace.ts` | collapse duplicate | S | — | 05 §A44, §D.3 |
| P38 | One liveness mechanism for the channel list | no doorbell; invalidates off the transcript cache entry | the channels doorbell (`live.ts › useChannelsLive`) | collapse duplicate | M | P30, F-222 | 05 §A50 |
| P39 | Per-container `AccountRail` / shell assembly in the shared tree | `account-rail.tsx` (92+152) and `app-shell.tsx` (327) are SPA-only; the landing had to re-cut the rail | same files | move down behind the `*Core` idiom | L | — | 03 §D2 D1/D2/D3 |
| P40 | `BarSeries` / `PLOT_HEIGHT_CLASS` in the shared tree | `apps/desktop-ui/src/components/charts/bar-series.tsx` (256) | same file | move down | S | — | 03 §D2 D5 |

**Row count — List 1: 40 rows.** Mechanism: collapse duplicate 18 · new code 7 · move down 6 ·
flag flip 1 · new adapter 3 · rides another row 3 · new call sites 2.
Size: S 22 · M 12 · L 6.

### 2.2 — List 2: KEEP in workspaces as-is (workspace-only, or different in kind)

| # | Item | Why it stays | Risk the uplift poses | Guard (test / gate) | Ref |
|---|---|---|---|---|---|
| K1 | `memberManagement` defaulting `true` on WS | /home's `false` names an operation a link container cannot perform at any size (`LINK_CONTAINER_CLOSED`) | a "simplification" that makes the flag global kills Add members + Delete channel on WS | `workspaces/server/link-container-guard.test.ts` | 01 §A row 12; 04 §A-1 |
| K2 | Create-channel / DM dialogs | /home's create mints a **container**; WS's creates a channel in one. Different acts | folding them loses the container mint | `home/server/service-writes.test.ts` | 01 §A row 6 |
| K3 | First-run explainer (`ChannelsOnboardingCore`) | the only consumer of the `Link` prop; /home has no router link | deleting it takes the router-free rule with it | `channels-core` suite | 01 §A row 7 |
| K4 | Channel tree nesting, Favorites and DM sections | a workspace tree nests threads and sections; a flat well column would lose that structure | R-03(a) would delete real structure | — (**gap**, see §7) | 03 §E1 |
| K5 | `Link`, `initialChannelId`, `onRosterChanged` | workspace-only by construction — a pinned host owns no channel LIST to invalidate | removing them breaks list invalidation on roster change | `channels-core` suite | 01 §B; 02 §B |
| K6 | `webView` single column + `selfManagement:false` (GUEST) | one flag, two controls, one story (Samuel R2/R3 2026-08-25) | splitting the flag ships a dead control | `guest-channel.test.tsx`, `app-shell-guest.test.tsx` | 01 §A row 13/19 |
| K7 | Members console v2 (roster ∥ teams, 4 detail tabs) | home's members-lite is the **ruled** shape, not a stub; three of v2's capabilities have no referent in a link container | 37 files / 4,941 lines with **4** unit tests and no server or RLS suite — the least-covered module in the set | `members/activity-visibility.test.ts`, `members-v2/visibility.test.ts`, `pages/members/index.test.tsx` | 04 §A-1, §B-3 |
| K8 | Teams + `resource_grants(scope_type='team')` | `offersTeamScope === (kind === "standard")`, Samuel 2026-09-08 | reading the two DROP migrations as a retirement deletes a **live capability** (B4 retires the AXIS, not the CAPABILITY) | `teams/server/repository-tables.test.ts` (L225), `agent-team-axis.test.ts` | 04 §A-2, §C-4 |
| K9 | Email invitations + standing join link + join requests | a workspace grows by invitation; a container grows one person at a time by a bound single-use token. Two proofs, both correct | collapsing the two doors loses `assertMemberAddable`'s fence | `link-container-guard.test.ts`, `workspaces/components/{accept-invite,join-link}-card.test.tsx` | 04 §A-3/§A-4, §B-7; 05 §A36 |
| K10 | `claimBoundLink` writing the member row itself | pinned as an **absence** — no mock would catch tidying it through the shared guard | a refactor that routes it through `assertMemberAddable` closes the only home admission door | `link-container-guard.test.ts` | 05 §A38 |
| K11 | The workspace Knowledge create **audience picker** | ruled 2026-08-27 with a reason: that button names no audience, *"so it is the one place the question is still worth asking"* | removing it reverses a ruling rather than finishing a port | — (confirm, R-42) | 06 §A.4; 04 §A-8 |
| K12 | The knowledge **audience ceiling** | link container with a peer → only bases carrying a channel grant, narrowed to the session's channel; a null member count **fails closed** | any merged read that loses the null-fails-closed arm widens agent reach | `knowledge/server/rls-redteam*.test.ts` (2 suites) | 04 §A-8; 05 §D.2 |
| K13 | Ontology audience: `standard` → `unrestricted` | a workspace board is workspace-wide by definition; the share trigger RAISEs for any kind but `link` | rewriting the early return as `!== 'link'` silently admits `personal` (F-564 shape) | `ontology/server/rls-redteam.test.ts`, `guest-lane.test.ts` | 05 §A33, §C.5 |
| K14 | `workspace_activity_events` + its admin-only verb set | the only server-side-filtered audit surface in the product; three of its verbs have no producer in a link container | extending it to home builds an oversight tool for a room with nothing to oversee | `members/activity-visibility.test.ts` | 04 §C-3, §E-8 |
| K15 | Tour, onboarding flow, welcome popup on the workspace shell | the tour's five steps are keyed to `NavSection`; a home tour needs a second vocabulary | a shell refactor can silently break the first-run path | `deep-link-target.test.mjs` (the four-file page rule) | 04 §A-19/§A-21 |
| K16 | Two plan sets picked by kind (`plansForKind`) | ruled explicitly: personal wallet vs seat wallet, *"I don't think it should be pooled"* | a surface reading the wrong set badges a plan the container cannot hold | `webhook-plan.test.ts › planFitsKind`, `checkout/route.test.ts` | 04 §A-14; 05 §E4 |
| K17 | The wallet routing table (`containerTarget`) and rule B | `link`'s arm is a **fallthrough**, not a branch, so a fourth kind inherits the safe answer | rewriting it as `=== "link"` breaks that; moving where a call declares its channel **moves who pays** | 30 billing suites; `credits-link-reroute.test.ts`, `credits-channel-attribution.test.ts` | 04 §D-3; 05 §E1/E2 |
| K18 | `resolveActiveWorkspace` auto-targeting **standard only** | a container is never auto-targeted | any "helpful" fallback writes rows nothing can find | `resolve-active-workspace.test.ts` | 05 §A6 |
| K19 | `assertMemberAddable` read **negatively** | a fence must inherit: a fourth kind gets the refusal rather than opting in | the positive-form rule (G3.1) applies to LABELS, not to this fence | `link-container-guard.test.ts` | 05 §G3 rule 1 |
| K20 | `GET /api/workspaces` unfiltered by contract | `main/channel-listener.js` fans over this exact list | "tidying" the route at the server breaks the desktop listener | INVARIANTS §4A; `check-role-drift.ts` | 05 §A3 |
| K21 | Mentions as a collapsed disclosure with a badge on WS | ruled in kind — *"a `defaultOpen` flag would make one component mean two layouts"*; `inset` deliberately has **no default** | unifying the wrapper reverses a ruling | `mentions-list` suite | 01 §A row 62; 06 §D.1 |
| K22 | `emptyLine` on `MemberRoster` (on for WS, off for HOME) | a home channel always has the caller in it | — | `person-members` suite | 01 §B |
| K23 | Per-section create affordance on /home vs page-header create on WS | sections pre-decide the scope on purpose | one create button loses the scope decision | `agent-panels` suite | 02 A.6 E5 |
| K24 | Template shelf (`"home"` vs `"workspace"`) | two PLACES over one table; the exclusion runs **both ways** | an omitted `?shelf=` **widens** — it means both shelves | `agent-templates/server/service-shelf.test.ts`, `check-knowledge-type-drift.ts` | 04 §A-10; 06 §A.4 |
| K25 | Author marker (`by <member>`) on /home template cards only | a security signal specific to a shared container | — | `template-editor-surface.test.tsx › HOME_FILES` | 02 A.6 E7 |
| K26 | Analytics write paths inside `withAuth` / `withWorkspaceAuth` | 617 lines, ONE test, instrumented in the hot wrappers | anything that touches a wrapper touches analytics | (**gap** — 1 test) | 04 §A-22 |
| K27 | `/admin/**` (oldest UI in the tree) | out of scope; retires with the website | a kit sweep that "fixes" it wastes a wave | — | 04 §A-23 |
| K28 | Get-started + marketing + auth glass/3D kit | DESIGN-SYSTEM exempts them; they retire with the site | a `text-white` sweep that includes them is noise | `docs/DESIGN-SYSTEM.md:30-31` | 03 §B3 note; 04 §F-5 |
| K29 | The POP thread window as a deliberate subset | transcript + composer only; no info column | adding an info column makes it a second channel host | — | 01 §0 |
| K30 | `PANEL_WELL` (no `face`) on the Threads and Agents tabs | `recency-wells.tsx:130-131` forbids a `face` there; `face` varies FILL and may never vary LAYOUT | a "consistency" pass that adds `PANEL_WELL_ON_PANEL` there breaks a ruling | `collapse-wells.test.tsx` | 02 §D |
| K31 | Shared well **storage keys** across hosts | `well-state.ts:44-47` scopes by SURFACE, not by host — deliberate | per-host keys would make one surface remember two states | `well-state` suite | 02 §D |
| K32 | Absence pins: no launch control on either Agents face; no `#<id>` tie-break; `HIDDEN_TOOLS` empty; `unarmed_room` with no producer | each is a ruling enforced as a "this does not exist" assertion | a wave that adds a surface will be tempted to delete the test — which deletes the ruling | `home-agents-tab` absence tests, `agent-id-visibility.test.ts`, `law-scan.test.ts` | 04 §F-5a |
| K33 | `workspace_credit_usage` + `consume_workspace_credits`, `default_workspace_of` | marked retired-from-writes; the DROP is its own later migration | deleting a marked-retired object early acquires an unplanned migration | INVARIANTS §12 | 04 §C-8 |
| K34 | The desktop `main/` tree | **already at parity by construction** — no "home" concept; every store key is channel-id-keyed and container-blind | introducing a kind branch there creates the fork that does not exist yet | `test/session-*.test.mjs` | 05 §G.4 |
| K35 | Deletes permanent + confirmed + app-only; MCP deletes refused at one choke point | standing ruling, app-wide | any new destructive control in the uplift needs a confirm, and no MCP delete op may appear | `law-scan.test.ts`, `delete-block.test.ts` | 06 §A.9, P14 |
| K36 | `channels.deleted_at` as a **DM-only** mechanic | a tombstoned DM is live product state | a tombstone-cleanup migration that includes `channels` destroys product state | `channels/schema-sql.test.ts` | 06 §A.9 |
| K37 | `HomeAgentRow` carrying no `model` / `toolLabel` / `tokensSpent` | *"a peer learns THAT an agent is working, never what it costs its operator"* | porting the agent board to a workspace must port the fence, not just the panel | `20260822150000` operator-only telemetry fence | 05 §F R2 |
| K38 | `workspace_token_spend` fenced per OPERATOR | a member-scoped read *"would leak a colleague's spend"* | a workspace token-spend strip must answer the privacy half first | migration `20260927120000` L149-153 | 05 §A21, §F R2 |
| K39 | Guest floors (14) and the guest-role model | `guest` below `viewer`; the LINK carries the grant | a shell/route refactor that moves a floor re-opens the inverted blast radius | the guest floor set, 7 suites | 04 §F-2 |
| K40 | `revisions` families (5) as a shared primitive | family-agnostic by design; **chats and skills are deliberately NOT in it** | extending revisions to skills/chats is a separate project | `revisions/server/service` suite | 04 §A-12 |
| K41 | The seven `canSee*` predicates as **kind-blind** | RLS parity is already achieved by construction; not one SELECT policy reads `workspaces.kind` | letting a container capability become a visibility gate is the one way to break it | `check-rls-pair-gate.ts`, the 7-file `rls-redteam` job | 05 §C intro, §G.3 rule 2 |

**Row count — List 2: 41 rows.**

### 2.3 — List 3: REMOVE or CHANGE in workspaces

"Does the reasoning hold for multi-member?" is the column Samuel asked for: it is where a home-shaped
deletion could be wrong for a 20-person room.

| # | Item | Home replacement | Ruling (date / source) | Holds for multi-member? | Ref |
|---|---|---|---|---|---|
| X1 | "Linked threads" section + `HARDCODED_LINKED_THREADS` (`info-tab.tsx:229-244`) | nothing — /home never had it | marked hardcoded at its render site since 2026-08-18; INVARIANTS §5 dead-control rule | **Yes** — a dead control is worse in a busy room | 01 §A row 59, §E-7 |
| X2 | The two inert `IconButton`s in the WS Members heading (`info-tab.tsx:271-272`) | /home deliberately did not copy them | Samuel 2026-08-25, `ENGINEERING.md:3662`: *"a port is not a transcription"* | **Yes** | 01 §A row 63, §E-6 |
| X3 | Threads-count row (`info-tab.tsx:224-226`) | the tab row already badges Threads (`info-panel-tabs.ts:75`) | minimal-copy ruling | **Yes** | 01 §A row 58, §E-8 |
| X4 | `knowledge` capability + `knowledge-tab.tsx` + the fifth-tab width branch + `channelPaneTabs`'s `knowledge` arm | the knowledge SHELF (two /home sections) | F-340 (2026-08-27 desktop), Samuel 2026-09-04 (web) → F-666; *"re-adding the face needs Samuel's word"* | **Yes**, but it is a ruling either way — see R-18 | 01 §A row 15, §E-4; 02 §B |
| X5 | `person-info-tab.tsx` (395 lines) | the one shared `info-tab.tsx` body | the slot-replaces-body defect, INVARIANTS:151 | **Yes** — the fork is the bug | 01 §C2 |
| X6 | `person-thread-activity.tsx` (63 lines) | `info-tab.tsx:248-263` from context | F-316 closed the data gap 2026-09-05; this is its composition residue | **Yes** | 01 §C3; 02 §C4 |
| X7 | `HARDCODED_THREAD_ACTIVITY` (`fixtures.ts:93`) + two stale comments | the wired strip on both hosts | *"keep the PICTURE and make it true"* (Samuel 2026-08-25); both sides are now wired | **Yes** — ⚠ re-derive first; `bits.tsx › agentAccent` (F-711) is the cautionary precedent | 02 §C5 |
| X8 | `channels-skeleton.tsx`'s "rough fit" two-pane ghost | `ChannelRecordSkeleton`, geometry by reference | Samuel 2026-08-28 / 2026-09-10 / 2026-09-13, three complaints; F-220 | **Yes** — the 2026-09-10 complaint was explicitly about switching workspaces | 01 §C4; 06 §C.2 |
| X9 | `AppPanel` (`src/shared/layout/app-shell/app-panel.tsx:20`) — zero call sites | none needed | delete-don't-disarm (P2) | **Yes** | 03 §E11 |
| X10 | `TAB_ACTION` as a second declaration of the 36px black pill | `PAGE_ACTION_BTN` in `src/shared/ui/` since 2026-09-17 | `ontology-view.tsx:9-15` records the tree-boundary workaround that **no longer applies** | **Yes** | 03 §B2, §E12 |
| X11 | ~20 hand-cut `auth-btn-3d` sites (4 heights, 5 radii, `text-white`) | the constant | `page-action-button.ts:21-24` names the exact violation | **Yes**; ⚠ exclude the auth/onboarding/billing exempt set | 03 §B3 |
| X12 | Five page-header recipes (H1–H5) + the Knowledge hero band and its marketing paragraph | one header strip | minimal-copy ruling (2026-08-19, reaffirmed 2026-09-17) | **Yes** — but the hero deletion needs Samuel (R-02) | 03 §A.4, §E2 |
| X13 | ✅ **DONE 2026-09-17 (wave 6)** — `SectionBox` (concave) desktop consumers | flat `SectionPanel`; Members ×5 files, Billing's invoice history, the chats disclosure body and the members skeleton ghost. ⚠ **`SectionBox` is NOT deleted** — the WEB playground still mounts it (R-39 left the web on concave) — and `SECTION_BOX_INSET` survives on the FROZEN settings surfaces and the composer launch panel's own ruling. Census: `template-editor-surface.test.tsx › the concave section recipe is off the desktop`. | Samuel 2026-09-13: *"you're adding this extra border line around the gray. I did not ask for that"* | **Yes** — needs R-39 | 03 §B8, §E5 |
| X14 | `home.module.css › .kbCards` / `.kbCell` (a fourth `--kv-*` rebind) | a grid variant of `knowledge-v2` | one-fact-one-place (P8) | **Yes** | 03 §D10 |
| X15 | `pages/home/index.tsx` + `app-shell.tsx` duplicate error wrapper | `FullScreenError` | trivial | **Yes** | 03 §A28 |
| X16 | Two declarations of the level-2 record card | `RECORD_SURFACE` | *"the single most load-bearing duplication in the document"* | **Yes** | 03 §A6 |
| X17 | ✅ **DONE 2026-09-17 (Wave 3, R-26 (b))** — both bridges deleted with the second cache; `use-home-unread-refresh.ts` survives RENAMED as `use-home-unread-clear.ts`, which is ONE invalidation of ONE cache and no longer a bridge | one projection | they exist **only** because there are two caches | **Yes** — a multi-member room makes the staleness worse | 05 §B.2 |
| X18 | `HomeChannel.lastMessagePreview` on the wire with no renderer | either render it (P14) or delete it | Samuel 2026-09-13: on the list column a last message *"just doesn't make sense imo"* | **Re-ask** — a workspace row may want it | 05 §A15 |
| ✅ X19 | The full workspace shell for a non-guest member of a `link` container | `/home` | **CLOSED 2026-09-17 (wave 5, R-01(a))** — `app-shell.tsx › AppShellLayout` redirects every member of a non-standard container off `/{segment}/...`, gate read through `isStandardWorkspace` rather than the ROLE; `app-shell-guest.test.tsx` 6 cases → 12 | **N/A → this IS the multi-member question.** R-01 | 04 §E-1 |
| X20 | `/billing/[segment]` rendering Starter/Team for a `link` container | `/billing?plan=pro` | F-678 OPEN; its Team checkout 400s. ⚠ **R-01(a) LANDED 2026-09-17 and closes the DESKTOP route into it, not the WEB route itself** — `/billing/{segment}` is a Next page outside the SPA shell, so F-678 stays open and is re-measured there, not assumed dead | **Yes** — closed by construction if R-01(a) wins | 04 §C-6 |
| X21 | ✅ **DONE 2026-09-17 (Wave 3, R-48)** — migration written, not applied; TS references removed | nothing wrote it since 2026-09-06 | delete-don't-disarm | **Yes** | 05 §C.1, §F R8 |
| X22 | `knowledge_bases.home_scoped` / `agent_templates.home_scoped` columns | `workspace_id = the personal container` | B10/#18 2026-09-02; drop is HELD in `supabase/migrations-held/` behind two `count(*) = 0` checks | **Yes**, but ⚠ the column is also the rollback path — once dropped the deploy is one-way | 04 §0.4; 05 §C.2 |
| X23 | Playground (18 files, 4,467 lines, 0 tests, unauthenticated provisioning, 3 static mirror panes) | nothing; the website replaced it and is retiring | **not found as a ruling in this tree** — treat as a question | **Yes** if the site retires | 04 §C-5, §E-9 |
| X24 | `mcp_tokens.workspace_lock_kind` | superseded, retires in B13 | stated in the migration | **Yes** | 05 §C.1 |
| X25 | SDK `listKbBases(opts:{shelf?})` — no MCP call site passes it | the shelf resolves server-side (`resolveShelfScope`) | dead param | **Yes** | 05 §A45 |
| X26 | SDK `getHomeChannels` binding — called nowhere in `packages/mcp-server/src` outside tests | — | `peers`, `peer`, `linkOut`, `pendingLinks` have no agent-facing surface | **Re-ask** — an account-wide agent read may want it | 05 §A46 |
| X27 | `settings-modal-core.tsx`'s members pane | `/members` is the ONE console | ASK-1 RULED (a) 2026-08-30 — *"delete, don't disarm: there is no nav stub"* | **Yes** — recorded so a parity wave does not "restore" it | 04 §C-1; 06 §A.8 |
| X28 | `dopl_home(op="create_channel")` | `dopl_workspaces(op="create_home_channel")` | F-621 RESOLVED (Desktop Agent default, Samuel may reverse); the SHAPE is still owed | **Stronger** in a multi-member container — minting a room and inviting into one are different acts | 04 §C-2, §E-7 |
| X29 | `variant="tab"` wells; the per-device `localStorage` pin; the `channels-v2` name; the flat agent row; the `Agent · <id>` chip; `.selected-ring` | all deleted | six same-day or next-day reversals, each marked *"do not re-derive"* | **Yes** | 06 §A.3, §A.5, §D.6 |
| X30 | Stale docblock: `channel-surface.tsx:152-160` (*"EXACTLY ONE HOST PASSES `knowledge`"*) | — | code wins; F-666 is the record | **Yes** — a doc bug, fix in the same change | 02 §B ⚠ |
| X31 | Stale docblock: `authz.ts:34-53` describing the retired TWO-MEMBER CAP and a dropped trigger | — | cap retired 2026-08-26; trigger dropped by `20260830120000` | **Yes** — and it is exactly the multi-member sentence | 05 §F-note 1 |
| X32 | Stale claims in `packages/contracts/src/workspaces.ts:47-64` (`link` = "ONE or TWO members"; `personal` = "NO ROW HAS THIS KIND YET") | — | both false; `TENANCY_PERSONAL_CONTAINER` is read by no code | **Yes** | 05 §F-note 2 |
| X33 | `DESIGN-SYSTEM.md:13` claiming the two Overviews share `overview-bits.tsx` | they share only `BarSeries` | doc-vs-code; allocate **F-714** (highest claimed on this branch is F-713) | **Yes** | 03 §E9 |
| X34 | Stale comments in `person-thread-activity.tsx:10-13` and `thread-activity.tsx:9` naming the fixture | F-316 closed 2026-09-05 | doc bug | **Yes** | 02 §C5 |

**Row count — List 3: 34 rows.** Of these, 12 are deletions of code, 5 are deletions of data-model
objects, 5 are doc repairs, 12 are changes.

### 2.4 — List 4: NEEDS SAMUEL'S RULING

> ✅ **ALL 49 ARE RULED (2026-09-17).** Each carries a `→ ✅ RULED 2026-09-17 — Samuel:` line in
> place, below its options. **The ⛔ marks below are HISTORY** — every wave-0 and wave-1 blocker is
> answered and no wave is ruling-blocked. Five rulings did not pick a listed option and changed the
> work rather than choosing: **R-02** (keep the titles), **R-03** (own design later), **R-21** (remove
> the archive feature entirely), **R-32** (a first-class container address) and **R-49** (delete the
> guidance layer instead of mounting it). **R-13 and R-43 are EXPIRED** — see §0.

**This is the section to read.** Every §E from the six audits, plus the archive's §D contradictions
and §E questions, plus the drift ledger's unruled ASKs that this uplift triggers — deduplicated and
numbered. One question in plain English, the options, a recommendation, and what it blocks.

**⛔ here = blocks Wave 1.** **Seven** of the forty-nine do. (In §5 the same mark means "blocks the
wave it is listed under" — that convention was already in the roadmap and is left alone.)
R-08 carried a ⛔ in the first draft; it blocks **Wave 0**, not Wave 1, and the mark has moved with
it. R-44 was merged into R-39 — they asked the same question — and R-50 was added, so the live total
is still 49.

#### Theme A — Surface and information architecture

**R-01. Should a member of a home-channel container be able to open the full workspace shell?**
Today, typing `/{link-segment}/members` gives a non-guest member of a relationship container the
whole eight-row nav, the Members console, Skills, Chats and a Settings page with an owner delete
(`app-shell.tsx:84-87` fences only `personal`). Nothing links there.
(a) Redirect any `link` segment to `/home`, like `personal`. (b) Make the nav kind-aware.
(c) Leave it — it is URL-only.
**Recommend (a).** One effect, deletes a redirect instead of adding a branch, and closes F-678 by
construction. *Blocks: Wave 5 (the shell), and R-10.* — 04 §E-1

→ ✅ RULED 2026-09-17 — Samuel: yes — **(a)**. Any `link` segment redirects to `/home`.

**R-02. Does a workspace get one header strip, and lose its five page titles?**
/home has no title at all; the workspace has "Overview", "Agents", "Skills", "Settings" and a
Knowledge hero band with a marketing paragraph.
(a) One strip, no titles — the sidebar already says where you are. (b) Keep titles, unify only the
geometry. (c) Leave five recipes.
**Recommend (a).** It is the minimal-copy ruling applied to chrome. ⚠ **The Knowledge hero band and
its paragraph (`knowledge-home.tsx:122-145`) are the one deletion that needs your word.**
*Blocks: Wave 5.* — 03 §E2

→ ✅ RULED 2026-09-17 — Samuel: **KEEP the workspace sidebar and the page titles.** The /home header strip vs the workspace sidebar is an **intentional difference**, not drift — so P19 does not collapse the titles away, and the Knowledge hero band is not deleted on R-02's authority.

**R-03. The channel picker: two designs, one app.**
/home picks a channel from 290px of collapsible gray wells holding raised cards with avatar stacks
and an `@ N` pill. The workspace picks one from a flat tree of 36px rows with no counts.
(a) The workspace tree adopts /home's column outright. (b) It keeps the tree but adopts the ROW
(card face, avatar stack, marks) and the well grouping. (c) They stay different — a workspace tree
nests threads and sections that a flat column would lose.
**Recommend (b), staged:** card face and wells now, the unread count as its own data change (R-28).
*Blocks: Wave 4.* — 01 §E-9; 03 §E1; 06 §E2

→ ✅ RULED 2026-09-17 — Samuel: **the workspace picker gets its OWN design later — do not port /home's.** Not (a), not (b): neither column is the answer. The wells, the card face and the selected face stay where they are until that design exists.

**R-04. What does search search?** /home's pill filters the channel column. A workspace-wide search
is a different feature, and the `ui/search-panel` Cmd+K branch is not in this tree.
(a) Per-page filter, /home's shape, one line of wiring per page. (b) One workspace-wide panel.
(c) Both. **Recommend (a) now, (b) as its own wave.** *Blocks: Wave 5.* — 03 §E3

→ ✅ RULED 2026-09-17 — Samuel: **answered by the search popup — one surface.** Not (a): there is no per-page filter. The one search popup is the workspace's search.

**R-05. Does the workspace shell crossfade when you switch pages, or only when you pick a
different row on one page?**
(a) Crossfade route changes too. (b) In-page selection changes only. (c) No motion at all.
**Recommend (b)** — which is what `Crossfade`'s three existing callers already do. Needs your word
only because it is visible motion. *Blocks: Wave 5 (P25 only).* — 03 §E4

→ ✅ RULED 2026-09-17 — Samuel: **crossfade on page switches too** — i.e. (a), not the recommended (b).

**R-06. Skills, Chats and Ontology have no page skeleton.** `section-skeleton.tsx:15-19` argues that
inventing three shapes is worse than `PageLoading`; /home has eleven bespoke shapes.
(a) Uphold that argument — no new ghosts. (b) Build three.
**Recommend (a)** unless you have seen one of the three flash and disliked it.
*Blocks: nothing — it only decides whether Wave 5 adds three page ghosts.* — 03 §E8

→ ✅ RULED 2026-09-17 — Samuel: **no skeletons now, later.** (a) stands for this roadmap; the three shapes are a later job, not a never.

**R-07. Does "Agents" get disambiguated?** /home Agents = template **identities**; the channel info
column's Agents tab = live **sessions**. The collision was recorded and deliberately not resolved,
on the argument that the two names live on different surfaces. **The uplift puts them on one.**
(a) Rename one. (b) Keep both names and rely on context. (c) Rename the tab only.
**Recommend: your word** — the original ruling says renaming needs it. *Blocks: Wave 5.* — 06 §E10

→ ✅ RULED 2026-09-17 — Samuel: **keep both names as-is** — (b).

#### Theme B — Members and permissions

**R-08. Confirm F-513: "shared" means any channel with more than one member, whatever the
container kind.** The ruling exists and **three sites still gate on the kind** —
`mcp-server/src/factory.ts:186-191 › lockedTo`, `tools/confirm-token.ts:181-188 › sharedContainer`
and `workspaces/server/shared-publish.ts:123` — while a fourth spelling,
`channels/lib/tool-profile-resolve.ts › isSharedChannel`, is **already kind-blind**. The tree
answers the question two ways today. Honouring the ruling **changes workspace behaviour**: a two-member
private channel in a standard workspace becomes "shared", turning on the container-publish
acknowledgement and tightening the knowledge audience ceiling.
(a) Execute it as its own wave, first. (b) Execute it inside the first surface wave. (c) Amend the
ruling to link containers only.
**Recommend (a).** Every row in these audits that reasons about "shared" is currently reasoning
about the wrong thing, and it is reversible in one predicate — so confirm before we build on it.
*Blocks: Wave 0 — where the predicate is executed. It is **not** a wave-1 blocker: nothing in
wave 1 asks whether a room is shared.* — 04 §E-11; 06 §E11; 05 §D.2

→ ✅ RULED 2026-09-17 — Samuel: **(a)** — execute F-513 as its own wave, first.

**R-09. What should a home container's member management be able to do?**
🔒 **Unbuildable until F-343 lands** — /home carries no caller role (`containerTarget.role` is
hardcoded `"owner"`), so nothing can be gated.
(a) Roster + add only (today): a person admitted at `guest` is a guest forever and cannot be
removed from /home. (b) Add remove/leave — the server already allows it, UI-only change.
(c) (b) plus a role change after claim. (d) Full members-v2 on home.
**Recommend (b).** "Departure is removal" is already ruled, and a container you cannot leave from
its own surface is the sharper defect. *Blocks: Wave 7 (V9); itself blocked on F-343 in Wave 0.*
— 04 §E-2

→ ✅ RULED 2026-09-17 — Samuel: **add remove + leave** — (b).

**R-10. Should `/{segment}/settings` exist for a link container, and should it offer DELETE?**
On a relationship container, "delete workspace" means "delete this relationship, and everyone in
it". (a) R-01(a) makes it unreachable. (b) Make `WorkspaceSectionBody` kind-aware: rename yes,
delete refused, naming the channel-deletion path instead. (c) Leave it.
**Recommend R-01(a) first, then (b) as belt-and-braces** — the settings body is shared with the
modal, and the modal is reachable from /home. *Blocks: Wave 5 (it rides R-01).* — 04 §E-3

→ ✅ RULED 2026-09-17 — Samuel: **(a)** — R-01(a) makes it unreachable — **and the settings page is FROZEN for Samuel's separate overhaul.** Nothing in these waves restyles, re-headers or re-dialogs `/settings`.

**R-11. Is the member Activity tab worth its cost?** A table, a revoked grant, a server-side filter
with an admin-only verb set and a fail-closed path — for one tab in a console with four unit tests.
(a) Keep. (b) Keep and pair the presence rule (R-12). (c) Retire the tab, keep the ledger for `/admin`.
**Recommend (a).** It is the only server-side-filtered audit surface in the product.
*Blocks: nothing.* — 04 §E-8

→ ✅ RULED 2026-09-17 — Samuel: **keep** — (a).

**R-12. `showPresence` has no server half.** The client hides `lastSeenAt`; the column still ships
in the roster payload. (a) Scrub it per caller in the members DTO. (b) Drop the client rule.
(c) Leave it. **Recommend (a), in the same wave that touches the members DTO and not before.**
*Blocks: Wave 7 (it rides the members DTO).* — 04 §E-10

→ ✅ RULED 2026-09-17 — Samuel: **(a)** — scrub `lastSeenAt` per caller, **with the members DTO** and not before.

**R-13. Does the guest's workspace CHROME get ported?** ASK-2 (2026-08-30) redirected a guest
somewhere that works and explicitly left them *"still wearing a nav they cannot use."*
(a) Port the chrome now. (b) R-01(a) subsumes it. (c) Leave.
**Recommend (b) then (a)** — the residual is real and was recorded, not fixed.
*Blocks: Wave 5 (it rides R-01).* — 06 §E18

→ ✅ RULED 2026-09-17 — Samuel: **EXPIRED** (2026-08-30 drift-ledger item) — **and the guest nav goes**: guests cannot use it, so it is removed rather than ported.

**R-14. Do the four container product questions deferred to you get answered?** F-296 deleting a
container blocks nobody · F-297 the public claim surface is unthrottled · F-298 no per-user mint
quota · F-299 a claim reveals both parties' emails with no accept step.
(a) Answer all four now. (b) Answer F-299 only. (c) Defer all four again.
**Recommend (b)** — F-299 is a live privacy item and a multi-member container makes it worse, not
better. *Blocks: nothing in the nine waves.* — 06 §E17

→ ✅ RULED 2026-09-17 — Samuel: **channel delete is CREATOR-ONLY and BLOCKED while others are members** (the creator removes people first) · **ADD a rate limit to the public claim surface** (F-297) · **NO mint quota** (F-298 declined) · **a claim reveals NAMES only, never emails** (F-299).

**R-15. Should the MCP container LOCK arm for a multi-member STANDARD workspace too?** Today it arms
only for a shared home channel, so a session pinned to a shared standard workspace sees the
operator's **entire** directory. (a) Keep — a workspace is not a private relationship. (b) Arm for
any container with 2+ members. **Recommend: ask.** The argument that bought the home lock ("a peer's
room must not be a directory oracle") is not obviously weaker here.
*Blocks: nothing in the nine waves — but it is an enumeration leak while it stands.* — 05 §F R4

→ ✅ RULED 2026-09-17 — Samuel: **(b)** — the MCP container lock arms for **any container with 2+ members**, standard workspaces included.

#### Theme C — Channel features

**R-16. Does the Artifacts face come to the workspace channels page?** Today it is /home-only under
your 2026-09-16 home-space-first ruling — but the *inline* artifact card already renders in the
workspace transcript, so a workspace reader can see an artifact and cannot browse the channel's
artifacts. The reads mount with the face, so an unopened workspace channel pays nothing.
(a) Pass `artifacts: true` from `channels-core.tsx` — one line. (b) Keep /home-only.
(c) Also give it to the guest lane.
**Recommend (a), after F-712 is fixed** — a browse list whose span numbers are silently wrong above
~20 members per artifact is worse in a busy room than in a two-person channel. ⚠ The Artifacts
design doc lists the **web renderer** among the things *deliberately not designed*, so (c) is
building an undesigned half. *Blocks: Wave 2.* — 01 §E-1; 02 §R-1; 06 §E4

→ ✅ RULED 2026-09-17 — Samuel: **yes — (a), after F-712.**

**R-17. Artifacts: a toggle everywhere, or a fifth tab — and does the drag handle discharge the
four-tab width budget (F-340)?** The 380px budget was a measurement for four tabs; 2026-09-13 made
the width the operator's with 380px as fallback and floor. Whether that settles it is a judgment.
(a) Toggle everywhere (the /home shape). (b) Toggle on desktop, a dropdown entry on the web.
(c) Fifth tab. **Recommend (a)** — a face that is one control on one host and a tab on another is
two mental models for one list. *Blocks: Wave 2.* — 02 §R-2; 06 §E6

→ ✅ RULED 2026-09-17 — Samuel: **(a)** — the toggle everywhere.

**R-18. ⛔ The `knowledge` capability has no host. Delete the lane, or restore it?** WS never passed
it; /home stopped 2026-08-27 (F-340); GUEST stopped 2026-09-04 (F-666). The component, hook and four
routes are live with no caller. (a) Delete the capability, `knowledge-tab.tsx`, the fifth-tab width
branch and `channelPaneTabs`'s `knowledge` arm. (b) Restore it on GUEST. (c) Leave it parked.
**Recommend (a)** — the ruling that took it off GUEST said re-adding needs your word, and
unreachable UI with a width budget attached is exactly what this wave is for.
*Blocks: Wave 1 (it changes the tab set and the record skeleton).* — 01 §E-4; 02 §B; 06 §E5

→ ✅ RULED 2026-09-17 — Samuel: **delete the dead lane** — (a).

**R-19. ⛔ The curated `info_card` on workspace channels.** Stored, validated and PATCH-writable —
and rendered on exactly one surface. **A workspace channel can carry curated rows no workspace
surface shows.** (a) Render it on the one shared body. (b) Gate it with an `infoCard` capability.
(c) Leave the divergence.
**Recommend (a)** — the column is on `channels`, not on a home type; a stored row nothing displays
is a data trap. *Blocks: Wave 1.* — 01 §E-5; 06 §A.3

→ ✅ RULED 2026-09-17 — Samuel: **(a)** — render the curated `info_card` on the one shared body.

**R-20. ⛔ "Created" vs "Date of creation".** Three differences on one row: label, formatter and
source. Nothing records a ruling either way. (a) Both become "Created" + `formatDate`.
(b) Both become "Date of creation" + `formatShortDate`. (c) Keep the divergence.
**Recommend (a).** *Blocks: Wave 1.* — 01 §E-2

→ ✅ RULED 2026-09-17 — Samuel: **(a)** — "Created" + `formatDate` on both.

**R-21. ⛔ The Status row (Active / Archived) on /home.** A home container's channel **can** be
archived by the same lifecycle write, and /home's Info tab cannot show it.
(a) Add the Status row to the one shared body. (b) Declare archive meaningless for a link container
and hide the archive control there too. (c) Leave it.
**Recommend (a)** — (b) is a second, larger ruling about link-container lifecycle.
*Blocks: Wave 1.* — 01 §E-3

→ ✅ RULED 2026-09-17 — Samuel: **REMOVE THE ARCHIVE FEATURE ENTIRELY, both surfaces** — *"a user can delete a channel; no point in archives."* Not (a) and not (b): there is no Status row to add because there is no archived state to show. The archive control, the lifecycle write, the Archived filter and every reader of the flag go.

**R-22. ⛔ The Threads-count row duplicates the tab-row badge.** (a) Delete the row. (b) Keep it and
add it to /home for symmetry. **Recommend (a).** *Blocks: Wave 1.* — 01 §E-8

→ ✅ RULED 2026-09-17 — Samuel: **delete** — (a).

**R-50. Does a pre-2026-08-24 home container get its channel name and description back?** Those
containers' channels still carry `is_direct = true`, and both info bodies spell
`headerEditable = canEdit && !channel.isDirect` (`info-tab.tsx:106`, `person-info-tab.tsx:144`), so
their Info card is **display-only** — you cannot rename the channel from it. The rule is right for a
real 1:1 (the title is the other person, so a field bound to `channel.name` edits an invisible value)
and wrong for these older rooms, which are ordinary channels wearing an old flag.
(a) Lift `is_direct` on the pre-2026-08-24 containers with a one-line migration. (b) Keep the flag
and make the rule ask something else. (c) Leave them display-only.
**Recommend (a)** — INVARIANTS:151 already calls it *"a one-word ruling, not a code question."*
*Blocks: nothing, but answer it with Wave 1 — P9 moves this exact line onto the shared context, and
it is a one-word change while it is being moved.* — 06 §E12

→ ✅ RULED 2026-09-17 — Samuel: **leave** — (c). The pre-2026-08-24 containers stay display-only; no migration.

**R-23. Do the thread pop-out and the agent window actually open from a /home channel?** The button
is drawn on every host and routes into `/{linkContainerSegment}/thread-window/…`;
`resolveWorkspaceSegmentForUser` does not filter `kind` but applies a `viewer` floor, so a
**guest-role peer may fail**. Nothing pins it.
(a) Measure, then pin both windows for a link container. (b) Assume it works. (c) Fence both windows
to standard workspaces. **Recommend (a)** — this is a measurement before it is a ruling, and it
gates whether we keep the control. *Blocks: nothing — but take the measurement in Wave 0.*
— 02 §R-3/§R-4

→ ✅ RULED 2026-09-17 — Samuel: **measured: they open.** The pop-out and the agent window both open from a /home channel; the control is kept and nothing is fenced.

**R-24. Where do the held-gate card and the posture selects live?** The **panel** has Pause/End/
Open-window + the held gate and no posture; the **window** has posture + model and neither. An
operator working in the agent window **cannot answer a held call from it**.
(a) Both surfaces get both. (b) The held gate moves to the window too; Pause/End stays panel-only.
(c) Leave it — the notification is the window's answer path.
**Recommend (b)** — the held gate is the one control whose absence stops work; adding a destructive
verb to a window that never had one is a new control. *Blocks: Wave 2 (P16).* — 02 §R-5

→ ✅ RULED 2026-09-17 — Samuel: **(b)** — the held gate moves to the window too; Pause/End stays panel-only.

→ ✅ **DONE 2026-09-17 (wave 2).** `AgentHeldGates` is mounted in `agent-window.tsx › ChannelsAgentWindow`, under the posture box and above the stream, on the SAME bridge capability (`agents-gate-controls.ts › canAnswerPermission`) and with `use-desktop-sessions.ts › refresh` for the refusal path. The boundary is pinned as well as the card: `agent-window-held-gate.test.tsx` asserts no Pause and no End.

**R-25. Peer-agent visibility on a 20-person workspace channel.** The Agents tab is an **operator**
surface: own agents from this machine's feed, peers as state-only cards.
(a) Leave it — `peerCardsFor` already thread-scopes and the agent cap is 15 per workspace, so the
list is bounded. (b) Cap or group the peer section. (c) Opt-in above N members.
**Recommend (a)**, revisit only if you report it as noise. *Blocks: nothing.* — 02 §R-7

→ ✅ RULED 2026-09-17 — Samuel: **show EVERYONE's live agents; ended agents hidden.** Not (a): the Agents tab stops being an own-agents-plus-state-cards surface — every member's LIVE agent is listed, and an ENDED agent is not.

→ 🟡 **EXECUTED 2026-09-17 (wave 2), AND THE EXECUTION SPLIT THE RULING IN TWO.** The **room-wide half needed no code and is now pinned**: `session-state-service.ts › listChannelSessions` is channel-scoped behind `loadVisibleChannel`, `surface-info-panel.tsx` hands `peerSessions` to the tab on EVERY host, and `agents-model.ts › peerCardsFor` already drops an ended row that a legacy desktop reports (`main/session-state-push.js › liveForWire` keeps it off the wire to begin with). `agents-tab-room.test.tsx` asserts peer-live-visible, peer-ended-absent and peer-rows-read-only. ⚠ **The "operator-scoped" premise in the question was wrong** — the peer cards have been a server read since 2026-08-20; what was missing was the pins. 🔴 **The OWN-ended half collides head-on with Samuel's 2026-08-22 rule** (*"the card is still drawn"*, `agent-ended.test.tsx`) and is **F-724, OPEN** — neither side edited, today's behaviour pinned, one question owed.

#### Theme D — Data and API

**R-26. Is the account surface a third host, or is it "the workspace host with `scope=account`"?**
This decides whether the channel-list collapse is possible at all.
(a) Third host with its own endpoints (today): every new channel-list field is built twice forever,
two caches and a bridge per fact. (b) One resource family, `scope=container|account` as a parameter
— the fence differs, the projection does not.
**Recommend (b).** `GET /api/channels/account/status` already spans all three kinds with one type,
and `?shelf=home|workspace` proves the pattern twice more. *Blocks: Wave 3.* — 05 §F R1

→ ✅ RULED 2026-09-17 — Samuel: **(b) — one endpoint.**

**R-27. One wire name for `channel_members.favorited_at`.** `HomeChannel.favoritedAt` vs
`Channel.myFavoritedAt`. Two names for one column is the whole of the pin bug you reported.
(a) `myFavoritedAt` everywhere. (b) `favoritedAt` everywhere.
**Recommend (a)** — the `my*` prefix states the caller-relativity an account-wide payload will stop
being able to assume. ⚠ Cross-package: both SDK types and a committed `dist/` move with it.
*Blocks: Wave 3.* — 05 §A10, §F R7

→ ✅ RULED 2026-09-17 — Samuel: **(a)** — `myFavoritedAt` everywhere.

**R-28. Does the workspace channel row get the `@ N` mention badge?** This was **ruled against, for
a stated reason**: `Channel.unread` is a BOOLEAN there, so a numeric badge would have no count
behind it. Carrying the badge means carrying the count — a server projection mirroring
`home/server/service-reads.ts:169-172`, not a UI port.
(a) Build the count and port the badge. (b) Port the wells only and leave the badge.
(c) Neither. **Recommend (b) now, (a) as its own slice.**
*Blocks: Wave 3 (the field's fate, X18/V16) and Wave 4 (the badge).* — 01 §E-9; 03 §B5; 06 §E3

→ ✅ RULED 2026-09-17 — Samuel: **mention badges YES on workspace rows** — (a), which means carrying the count (the server projection), not porting a badge with nothing behind it.

**R-29. Does the workspace Overview show the credit BREAKDOWN, token spend and a live agent
board?** ⚠ **Corrected 2026-09-17:** the workspace Overview already shows a credit figure —
`pages/overview/index.tsx:94` reads `useWorkspaceEntitlements` and `:131` renders `PeriodStats`
("Credits used", this billing period). The payloads are **near-disjoint, not disjoint**: workspace =
counts + activity + member load + a period credit figure; home = credits by channel / person / tool
+ live agents + token spend + scanned. (a) No — the workspace Overview is an ACTIVITY page and /home
is a SPEND page. (b) Yes, one set of sections, host-selected. (c) Unify the payload behind one
service with a `scope` parameter.
**Recommend (b) for the SERIES first**, and not (c) for the payload — the fences are genuinely
different and collapsing them is how a container leak gets built.
⚠ **(b) has a privacy half that must be answered in the same breath:** `workspace_token_spend` is
fenced per OPERATOR on purpose (*a member-scoped read "would leak a colleague's spend"*), and
`HomeAgentRow` deliberately carries no `model` / `toolLabel` / `tokensSpent`.
⚠ **And the meters must not mix** — a `seat` row is on no /home figure, and summing across wallets
was the exact 2026-09-12 bug. *Blocks: Wave 8.* — 02 §R-6; 04 §E-5; 05 §F R2

→ ✅ RULED 2026-09-17 — Samuel: **(b)** — one set of Overview sections, host-selected; the SERIES first, and not (c) for the payload.

**R-30. Does a standard workspace get per-ontology sharing — and is the home/workspace boundary
general?** Today every member of a standard workspace sees every board (`unrestricted`), while a
link container has a full three-audience matrix per `(ontology, channel)` whose trigger RAISEs for
any kind but `link`. Separately, `home-ontology.md › Q5` refuses a home ontology shared into a
standard workspace channel with a 400 and freezes the workspace Ontology page.
(a) Keep both — and **write the boundary down as a rule** (personal-shelf resources never reach a
standard workspace channel) rather than leaving it as an early return in one file.
(b) Extend the share row to workspace channels — one trigger clause, one audience arm.
(c) Let each module answer for itself.
**Recommend (a), stated once in INVARIANTS §4A.** It makes R-33's "no channel sharing in wave 1" a
consequence rather than a separate judgement. *Blocks: nothing in the nine waves — it is deferred,
and answering it early makes R-33 smaller.* — 04 §E-12; 05 §F R3; 06 §E1

→ ✅ RULED 2026-09-17 — Samuel: **(a)** — keep both, and write the boundary down as a rule in INVARIANTS §4A.

**R-31. Should the audience-change PREVIEW (the confirm token) fire in a standard workspace?**
Today it fires only inside a shared link container. Publishing a KB, skill or template
**workspace-wide** gets no preview, no token and no acknowledgement. **The workspace door is wider
and quieter than the home door.**
(a) Fire it for any container with a second audience. (b) Keep it link-only. (c) Fire it above N
members. **Recommend: ask.** The stated reason ("a workspace publish is expected") is plausible but
this is the single largest behavioural home-only gate on the MCP surface.
*Blocks: nothing in the nine waves.* — 05 §F R5

→ ✅ RULED 2026-09-17 — Samuel: **fire** — (a). The audience-change preview fires for any container with a second audience, standard workspaces included.

**R-32. `workspace=` is slated for removal next release, and it is the only way to address a
container.** Containers get no slug.
(a) Block the removal until a container has an address the other nine ops accept. (b) Give
containers slugs, then remove it. (c) Remove it as planned and lose container addressing.
**Recommend (a)**, with (b) as the real fix. *Blocks: Wave 3 (it decides what the one projection is
addressed by).* — 05 §F R6

→ ✅ RULED 2026-09-17 — Samuel: **give containers a first-class address.** Personal = the reserved name `home`, resolved per caller · a home-channel container = its channel slug · a workspace = its slug. **One `container=` parameter replaces `workspace=`.** Container **KIND becomes a typed field on every MCP row and list**, and `dopl_map` shows **"Home space" as its own top-level node**. An unaddressed call resolves to home. Samuel: *home must be structurally distinct, never just a prompt line.*

**R-33. Do Skills and Chats come to the home space?** Both are plain `workspace_id`-scoped, both
already work in a personal container via MCP, neither has a surface — and `dopl_chats(op="export")`
with no `workspace=` is already filing chats nothing lists.
(a) Both, as personal-shelf faces. (b) Chats only — it has the live defect. (c) Neither, and then
answer what the export should do instead. (d) Both **plus channel sharing**, which drags in a
publish acknowledgement chats has never had.
**Recommend (a) without (d).** Two mounts against modules that are already tested, already
MCP-reachable and independent of the channel world. ⚠ It changes the marketing hero (the landing
draws /home's tab strip) and it touches the tour. *Blocks: Wave 7.* — 04 §E-6

→ ✅ RULED 2026-09-17 — Samuel: **NO — Skills and Chats stay out of home.** (c). The export's behaviour is still owed an answer (V2 remains a live orphan class).

**R-34. `dopl_workspaces(op="create_home_channel")` — confirm the shape.** F-621 is resolved on a
Desktop-Agent default and its own entry says the SHAPE is what needs you: the op on the orientation
tool, a dedicated write tool, or app-only. **Recommend: confirm the default.**
*Blocks: nothing in the nine waves.* — 04 §E-7

→ ✅ RULED 2026-09-17 — Samuel: **the home space is auto-created per account, permanent, and never created or deleted via MCP.** `create_home_channel` is not the shape; there is no MCP door onto the home space's existence.

**R-35. Does a new user get a standard workspace at all?** Two statements in one wave document
disagree, and one flags itself as the contradiction. If signup mints only a personal container,
"workspace parity" describes a surface most users never reach — **which changes this roadmap's
priority, not just its scope.**
(a) Signup keeps minting a standard workspace. (b) Signup mints only a personal container and a
standard workspace is opt-in. **Recommend: measure the code first, then rule.**
*Blocks: nothing mechanically — but it re-prices every wave in §5.* — 06 §E13, §D.4

→ ✅ RULED 2026-09-17 — Samuel: **every user gets exactly a home space; no default standard workspace.** (b), executed: **remove any code that mints one.**

**R-36. G20: land the eighth session-health field, or retire the guardrail?** A prohibition agents
are told has no fence in the code, against your own standing rule that it must.
**Recommend: land the field.** *Blocks: nothing in the nine waves.* — 06 §E15

→ ✅ RULED 2026-09-17 — Samuel: **do not land an eighth field, and CORRECT the sentence to SEVEN** (not delete it). The session-health set is seven and `scripts/check-session-health-drift.ts` is what holds that number; the doc claimed an eighth was still owed. Executed 2026-09-17 in `docs/specs/mcp-v2-wave-b.md` (both G20 rows) and recorded in `06-rulings-archive.md` §D.8. G20 stays prose — recorded as a residual, not glossed.

**R-37. Does a folder-scoped knowledge attachment NARROW an agent's reach, or only re-point it?**
F-680: the 2026-09-08 ruling asked for folder/entry selection and did not say what it means for
reach. (a) It NARROWS — the agent may read only the attached folder. (b) It only RE-POINTS — the
agent still reaches the whole base. **Recommend: ask**; (a) is the safer default if you are unsure.
*Blocks: nothing in the nine waves.* — 06 §E14

→ ✅ RULED 2026-09-17 — Samuel: **narrowing** — (a). A folder-scoped attachment means the agent may read only the attached folder.

#### Theme E — Design recipes

**R-38. Does the workspace adopt /home's account-palette skin?** Six scoped `:global()` rules
repaint the shared channel surface's dividers to 2px `--home-panel-line` and its composer panels to
`--home-panel`, **fenced to /home on purpose**. (a) Promote the skin to the app — the fence
disappears and six fragile utility-class selectors are deleted. (b) Keep two looks for one surface.
**Recommend (a)** — it is the same argument the 2026-08-30 frame ruling already made.
⚠ Note that three of the six rules select on Tailwind utility class names in files /home does not
own and admit they degrade silently. *Blocks: Wave 6.* — 03 §E10; 01 §D

→ ✅ RULED 2026-09-17 — Samuel: **yes** — (a). Promote the account-palette skin to the app and delete the six `:global()` fence rules.

**R-39. Which section language wins — flat or concave?** /home is flat (your 2026-09-13: *"you're
adding this extra border line around the gray. I did not ask for that"*). The workspace still uses
the concave `SectionBox` on Members ×5, Billing, Ontology's template editor and Knowledge's
Contents, and `SECTION_PANEL_GROUND` keeps a hairline `PANEL_WELL` does not.
(a) Flat everywhere; delete `SectionBox`'s consumers in a dedicated pass. (b) Keep both.
**Recommend (a).** ⚠ This is also the Agents-page question (Q4): the spec that authorised /home's
flat face says a reversal for visual parity *"is an ENGINEERING.md entry, not a styling choice"*,
and Q4 was never reviewed.
⚠ **R-44 MERGED IN HERE (2026-09-17 review).** R-44 asked you to confirm the /home Agents-face
defaults Q1–Q6 that were *"ruled by the orchestrator while Samuel slept"*. Its only parity half was
**Q4, which is this question**; Q1–Q3, Q5 and Q6 are defaults that shipped and stand unless you say
otherwise. Answering R-39 answers R-44. *Blocks: Wave 6.* — 03 §E5; 06 §E7, §D.9

→ ✅ RULED 2026-09-17 — Samuel: **flat; remove concave from the desktop app.** (a). The web login page may keep concave for now.

**R-40. Three home-only design asymmetries carry no recorded reason.** The credit bar dropping its
`label`, `HOME_CARD_FACE_SELECTED` (the black selected row), and the Agents page staying
"pixel-unchanged". The 2026-08-30 charter says the surfaces must match.
**Which of these are asymmetries BY RULING and which are simply not-yet-ported?**
**Recommend: port the selected-row face with R-03; leave the credit-bar label alone (it is a stated
per-host difference on a shared recipe); the Agents-page flatness is R-39.**
⚠ **The two audits disagree about the selected-row face.** 01 §A row 74 records it as
*host-specific-in-kind*, ruled by you on 2026-09-15 (`home.module.css:17-31`); 06 §E8 lists it among
the asymmetries with **no recorded reason**. Read the module before porting it — if 01 is right,
this half of R-40 is already answered and P12 should keep the workspace's selection ring.
*Blocks: Wave 4 (the selected-row face) and Wave 6 (the rest).* — 06 §E8, §D.1; 01 §A row 74

→ ✅ RULED 2026-09-17 — Samuel: **keep all three home items** — the credit bar without its label, `HOME_CARD_FACE_SELECTED`, and the Agents page's face. **A "recorded reason" is not required** for a home-only choice.

→ ✅ **EXECUTED AS "NOTHING" 2026-09-17 (wave 6), AND MEASURED RATHER THAN CLAIMED.** `git diff master -- apps/desktop-ui/src/pages/home/overview-sections.tsx src/shared/ui/home-card-marks.tsx apps/desktop-ui/src/pages/home/{agent-panels,agent-panel-cards}.tsx src/features/agent-templates/components/agent-templates-core.tsx` is EMPTY on `wave6/palette-flat`. ⚠ **ONE DIVERGENT EQUIVALENT DID MOVE, AND IT IS R-39's DOING RATHER THAN A PORT**: the WORKSPACE Agents page's section ground (`agent-templates/components/template-section.tsx › TemplatePanel`) dropped the `border-border-subtle` hairline when `SECTION_PANEL_GROUND` went flat, so the two Agents faces now share one recipe instead of differing by a line. /home's face did not change — it already had no hairline, through the `:global()` rule R-38 deleted.

**R-41. The kit class layer has no drift gate.** `check-css-token-drift.ts` compares `--*`
declarations only; four recipes live in `globals.css` and not in `kit.css`, and nothing failed.
(a) Extend the script to compare the `@layer components` class SET (names only) and add its row to
CLAUDE.md § *Definition of green* in the same change. (b) Leave the class layer ungated and rely on
review. **Recommend (a)** — the convention the last five gates followed.
*Blocks: Wave 0 exit (and P24, which adds three classes to the SPA kit).* — 03 §E6

→ ✅ RULED 2026-09-17 — Samuel: **(a)** — extend the drift script to the `@layer components` class SET and add its CLAUDE.md row in the same change.

**R-42. Does the workspace Knowledge page keep its audience picker?** Ruled **yes** in 2026-08-27
for a stated reason — that page's create button names no audience, *"so it is the one place the
question is still worth asking."*
(a) Keep the picker (confirm the 2026-08-27 reason still holds after B10 collapsed the shelf axis).
(b) Remove it and let the page's scope name the audience. **Recommend (a), confirmed not assumed.**
*Blocks: Wave 6 (P29 touches that page).* — 06 §E9

→ ✅ RULED 2026-09-17 — Samuel: **(a)** — keep the audience picker.

→ ✅ **VERIFIED AND PINNED 2026-09-17 (wave 6).** It is untouched — `create-base-dialog.tsx › ScopePicker` under `DialogField label="Who can access"`, gated by `› scopePicker`, which is the negation of the two props a caller sets when its own button already named the audience. The 2026-08-27 reason still holds after B10. ⚠ **ONLY ITS ABSENCE WAS PINNED** (`pages/home/knowledge-panels.test.tsx › asks the audience question ONCE`); its PRESENCE on this page now is too — `pages/knowledge/home.test.tsx › KEEPS the audience question`.

**R-43. Do the 31 unruled ASKs from the 2026-08-30 drift audit get answered as a batch?** Only 5 of
36 were ever ruled. Several are literally *"is this /home's or the app's?"* — ASK-11
(`CACHE-SHAPE FALLBACK` marker), ASK-12 (`.search-expand` app-wide or /home's), ASK-8 (text
loaders), ASK-20, ASK-24, ASK-25, ASK-26, ASK-27, ASK-35.
⚠ **Four of them block work, in this order:** ASK-9 → the shared skeleton promotion · ASK-32 → the
DiffModal port · ASK-24 (with F-345's correction) → the icon-button batch · ASK-13 →
`base-settings-form` · ASK-10 → the realtime wave · ASK-4 → whether the upgrade modal is in scope.
**Recommend: answer ASK-9, ASK-12, ASK-24 and ASK-32 with this roadmap; batch the rest.**
*Blocks: Wave 1 through **ASK-9**, which owns the shared-skeleton promotion (P10) — so ASK-9 is due
with Wave 0, alongside ASK-12, ASK-24 and ASK-32.* — 06 §E16

→ ✅ RULED 2026-09-17 — Samuel: **EXPIRED.** No batch. The 2026-08-30 drift-audit ASKs are not answered as a group; an item is only live if it is re-found in current code.

**R-44. → MERGED INTO R-39 (2026-09-17 review).** It asked the same question in other words: its
only live half was Q4, *"does the workspace Agents page adopt /home's flat face"*, which is R-39.
The id is kept here so a reference to R-44 still lands somewhere. — 06 §D.9

→ ✅ RULED 2026-09-17 — Samuel: → answered by **R-39**'s ruling above (flat; concave removed from the desktop app).

#### Theme F — Deletions that want a veto

**R-45. ⛔ Delete the "Linked threads" section** (`info-tab.tsx:229-244`) — hardcoded since
2026-08-18, buttons with no `onClick`, no relation to any read. (a) Delete section +
`HARDCODED_LINKED_THREADS`. (b) Keep as a placeholder. **Recommend (a).**
*Blocks: Wave 1.* — 01 §E-7

→ ✅ RULED 2026-09-17 — Samuel: **delete** — (a).

**R-46. ⛔ Delete the two inert `IconButton`s in the WS Members heading.** (a) Delete both.
(b) Wire "Add member" to the existing invite dialog and delete only the filter. (c) Leave.
**Recommend (a)**, with (b) as a follow-up ticket. *Blocks: Wave 1.* — 01 §E-6

→ ✅ RULED 2026-09-17 — Samuel: **delete** — (a).

**R-47. Does the playground retire with the website?** 18 files, 4,467 lines, zero tests, a
deliberately unauthenticated provisioning route that creates real `auth.users` rows, a reaper cron,
and three **static mirror panes** of surfaces this refactor is about to change.
(a) Retire with the site. (b) Keep, freeze the panes. (c) Keep and re-point the panes at real
components. **Recommend (a).** (c) is the one to avoid — it makes a public anonymous surface depend
on the modules under refactor. ⚠ The website-retirement direction is **not stated as a ruling in
this tree**; treat this as a question. *Blocks: nothing — deferred, its own project.* — 04 §E-9

→ ✅ RULED 2026-09-17 — Samuel: **leave the playground** — (b). It does not retire with the site in this roadmap.

**R-48. Drop the `channel_personal_arming` table?** Nothing writes it (you reversed task 11 on
2026-09-06; `shared/tenancy/personal-reach.ts:14-18` says so in place); three live policies still
count against the RLS surface. (a) Drop the table and its policies. (b) Leave it inert.
**Recommend (a)**, per delete-don't-disarm. *Blocks: Wave 3 (ledger row 17).* — 05 §F R8

→ ✅ RULED 2026-09-17 — Samuel: **drop the table** — (a).

**R-49. Should /home mount the guidance layer?** Tour, join-request notices, the connect-agent
banner and the welcome popup are workspace-only today and all four are host-agnostic. A first-run
user lands on /home and sees none of them.
(a) Mount all four. (b) Mount `ConnectAgentBanner` and `WelcomePopup`; leave Tour on the workspace
(its steps are keyed to `NavSection`). (c) None.
**Recommend (b)**, and revisit the Tour once R-33 is answered — a tour that names Skills and Chats
is either wrong for home or becomes right for free. *Blocks: Wave 7 (V5).* — 03 §E7; 04 §E-4

→ ✅ RULED 2026-09-17 — Samuel: **delete the guidance-banner code now, reimplement later.** Not (a) and not (b): nothing is mounted on /home. The Tour, the join-request notices, the connect-agent banner and the welcome popup are DELETED, and a first-run experience is designed fresh when it is wanted.

**Row count — List 4: 49 live rulings** — R-01–R-43 and R-45–R-50. (**50 ids**: R-44's id is kept
as a pointer to R-39, which absorbed it.) By theme:
Surface/IA 7 · Members & permissions 8 · Channel features 11 (R-50 added) · Data/API 12 ·
Design recipes 6 (R-44 merged into R-39) · Deletions 5.
**Wave-1 blockers (7): R-18, R-19, R-20, R-21, R-22, R-45, R-46.**
**Wave-0 blockers (3): R-08, R-41, and R-43's ASK-9 arm** (ASK-9 owns P10's skeleton promotion,
which lands in Wave 1).

### 2.5 — List 5: REVERSE MAP — what the workspace has that home lacks, and the orphan classes

| # | Item | Recommendation | Ref |
|---|---|---|---|
| V1 | **Chats** — no /home face; scoping is plain `workspace_id`, no kind awareness anywhere | 🔴 **DO NOT EXTEND — R-33 ruled NO (2026-09-17)**, and the absence is pinned (`src/features/home/tabs.test.ts`, wave 7) | 04 §B-1 |
| V2 | **Orphan class: exported chats nothing lists.** `dopl_chats(op="export")` with no `workspace=` resolves the caller's `personal` container; `ChatsView` has one mount (the workspace route); the rail filters to `isStandardWorkspace` | **Extend, or answer what the export should do instead.** This is a live defect, not a missing feature | 04 §B-1; R-33 |
| V3 | **Skills** — no /home face; the MCP tool is *already* link-container aware (a public publish inside a shared container needs a one-time confirm token) | 🔴 **DO NOT EXTEND — R-33 ruled NO (2026-09-17)**, and the absence is pinned (`src/features/home/tabs.test.ts`, wave 7). The MCP half is untouched: `dopl_skill` still reaches a personal container | 04 §B-2 |
| V4 | **`ConnectedAppsSection`** — reachable only from the workspace `/settings` PAGE; the modal passes no `extras` | **Extend (one prop).** An operator who works entirely in the home space cannot see or revoke their connected apps — security-relevant, not cosmetic | 04 §B-6 |
| V5 | **The guidance layer** — `TourProviderCore`, `JoinRequestNoticesCore`, `ConnectAgentBanner`, `WelcomePopup`, none mounted on /home; all four already host-agnostic | ✅ **RULED R-49 AND EXECUTED THE OTHER WAY — DONE 2026-09-17 (wave 7): all four DELETED**, on the workspace too, not mounted on /home | 03 §A12, §C3 |
| V6 | **`MyAccessProvider`** — /home mounts it only inside the KB view, so any teams-mode gate elsewhere on /home resolves to a false edit affordance (F-330: `canEdit` **falls open**) | **Extend.** The prescribed fix shape is to report PROVIDERLESS distinctly from PENDING — **do not flip the default closed** | 03 §C3; 06 §C.1 |
| V7 | **Members console** | **Do not extend.** Close the gap the other way: add remove/leave to /home's roster (R-09(b)). Three of v2's capabilities have no referent in a link container | 04 §B-3 |
| V8 | **Member role change after claim** — the role is set once, by the link | **Ruling R-09(c); hold until asked** | 04 §B-3 |
| V9 | **Member removal from /home** — `membership-admin.ts` leaves removal and departure open **server-side** and no /home surface calls them | **Extend (UI-only).** Blocked on F-343 | 04 §B-3 |
| V10 | **Activity feed** (`workspace_activity_events`) | **Do not extend** — three of its verbs have no producer in a link container; the rest is legible from the channel | 04 §C-3 |
| V11 | **Settings page** | **Not a gap** — the modal already serves both; the composition is already correct | 04 §B-4 |
| V12 | **Email invitations / standing join link** | **Not a gap** — two admission models for two population shapes | 04 §B-7 |
| V13 | **"Waiting on you" and "Recent threads" on /home Overview** | **Leave — these are DELETIONS, not gaps.** Both cards went with all their plumbing 2026-09-05; the channel-scoped overview panel was deleted as *"a duplication bug, not a preference"*. A wave that adds them back reverses two rulings | 04 §B-8 |
| V14 | **Personal shelf on a workspace** | **Leave** — the personal container is one per USER by construction | 04 §B-9 |
| V15 | **Orphan: `HARDCODED_THREAD_ACTIVITY`** — no production reader (measured once, 2026-09-17) | **Delete after re-deriving.** `bits.tsx › agentAccent` (F-711) is the precedent for exactly this shape | 02 §C5 |
| V16 | **Orphan: `HomeChannel.lastMessagePreview`** — on the wire, rendered by nothing since 2026-09-13, kept alive by the SDK mirror and a committed `dist/` | **Render it on the workspace row (P14) or delete the field.** R-28 | 05 §A15 |
| V17 | **Orphan: `AppPanel`** — zero call sites (verified 2026-09-17: the only two matches in the tree are prose, `members/constants.ts:2` and `pages/overview/index.tsx:40`) | **Delete** (delete-don't-disarm) | 03 §E11 |
| V17b | ⚠ **UNVERIFIED — `bits.tsx › agentAccent` is NOT an orphan.** F-711 says it *"has no call site left"*; at HEAD `attribution-pill.tsx:50` imports it and `:313` calls it (`!framed && agentId && agentAccent(agentId)`) | **Do not delete.** Code wins over the finding (CLAUDE.md § *Precedence*) — file the disagreement against F-711 instead. This also weakens X7/ledger row 6's use of it as a "measure once, delete" precedent: the lesson it actually teaches is **re-derive** | 06 §C.3 (F-711); measured 2026-09-17 |
| V17c | ⚠ **`.selected-ring` is already DELETED, not an orphan** — Samuel 2026-09-17, from both kit copies, and the absence is **pinned by three tests** (`home-search.test.ts:83-85`, `frame-palette.test.ts:439`, `relationship-list.test.tsx:342`) | **Nothing to delete.** See X29 and K32 — deleting the *test* would delete the ruling | 06 §A.3/§D.6; measured 2026-09-17 |
| V18 | **Orphan: `resource_grants scope_type='container'`** — schema with **no writer** | **Not obsolete; unfinished.** It is the natural home of any container-level sharing R-33(d) would grow, and costing it as a wiring job is wrong — it is a feature | 04 §C-7 |
| V19 | **Orphan: `channel_personal_arming`, `home_scoped` columns, `mcp_tokens.workspace_lock_kind`, SDK `listKbBases(shelf)`, SDK `getHomeChannels`** | **Drop / hold per row** — see the deletions ledger §6 | 05 §C.1/§C.2/§A45/§A46 |

**Row count — List 5: 19 rows** (V17 split into V17/V17b/V17c by the 2026-09-17 review; the three
were one row that was wrong about two of its three items).

---

## 3. UI/UX map — every difference a user would notice

`CSS` = a paint or token swap. `BEH` = behaviour, a control, or data. **Wave** points into §5.

### 3.1 Scale and recipes

| # | Difference | Home | Workspace | Kind | Wave |
|---|---|---|---|---|---|
| U1 | The 36px black page action | `page-action-button.ts:29-30` worn at 5 sites | `TAB_ACTION` (`bits.tsx:66-73`) + ~20 hand-cut `auth-btn-3d` sites, 4 heights, 5 radii, `text-white` | CSS | 0, 5 |
| U2 | Section ground | flat `--home-panel`, no hairline (`home.module.css:165-168`) | `SECTION_PANEL_GROUND` keeps a hairline | CSS | 6 |
| U3 | Concave `SectionBox` | forbidden on /home (pinned) | live in members-v2 ×5, billing, ontology template editor, knowledge Contents | CSS | 6 |
| U4 | Segmented control form | `plain` / `lg` / `semibold` (`home-header.tsx:76-83`) | 12 uses, never that form | CSS | 5 |
| U5 | `.auth-btn-3d-light` re-stated | `home.module.css:102-106` sets the raised-light vars directly | `.auth-btn-3d-light` / `.raised-tab` in `globals.css` | CSS | 6 |
| U6 | ~~`[data-overview-face] .bento` deeper shadow~~ **RESOLVED BY DELETION 2026-09-17** | hook, rule and `--shadow-card` deleted — Samuel reverted the elevation | already matched: both wear `--shadow-bento` | none | — |
| U7 | Kit class parity | SPA `kit.css` | `globals.css` carries `.glass-panel`, `.hairline`, `.hairline-strong` the SPA lacks; the token gate does not see class names | CSS + gate | 0 |
| U8 | Sidebar hardcoded type | n/a | `app-shell.module.css:289` `16px`, `:291` `13.5px` — outside the type scale | CSS | 6 |
| U9 | Knowledge hero hardcoded ink | n/a | `knowledge-home.tsx:133` `text-white`, `:135` `text-[#e3e3e3]` | CSS | 5 |
| U10 | Dark mode | none | none — `prefers-color-scheme`, `data-theme`, `.dark`, `dark:` all return **0 matches repo-wide**, and that is stated as a rule | — | n/a |

### 3.2 Headers and navigation

| # | Difference | Home | Workspace | Kind | Wave |
|---|---|---|---|---|---|
| U11 | Page title | **none** — the selector replaces it (`home-header.tsx:73`) | five titles, five heights, three ink treatments | BEH | 5 |
| U12 | Header strip | one 36px row: action · selector · search · Profile | **no workspace header at all**; each page draws its own | BEH | 5 |
| U13 | Search | `.search-expand` pinned open at 260px (`home-search.tsx:44-67`) | none; the channels sidebar has a private filter input | BEH | 5 |
| U14 | Surface switch | local state, 5 pills, no routes (`index.tsx:81`) | 8 routes + a 232px sidebar mirrored in three places | BEH (in kind) | keep |
| U15 | Settings entry | black "Profile" pill | a `.nav-chip` in the sidebar foot | BEH (in kind) | keep |
| U16 | Knowledge chrome | two `SectionPanel`s over `.kbCards` | hero photo band + `LiquidGlass` + a marketing paragraph + a scope filter | BEH | 5 |
| U17 | Guidance layer | absent | tour, join notices, connect banner, welcome popup | BEH | 7 |
| U18 | Route transition | `Crossfade` on face swaps | `.pageCard` remounts, no transition | BEH | 5 |

### 3.3 Cards and wells

| # | Difference | Home | Workspace | Kind | Wave |
|---|---|---|---|---|---|
| U19 | Channel picker shape | three collapsible gray wells (Pinned / Recent / Earlier), 290px | flat nav tree with Favorites / DMs / Channels sections | BEH | 🔴 **CLOSED BY R-03** — its own design, later |
| U20 | Channel row face | raised card, avatar stack, `HOME_CARD_FACE` | 36px `raised-tab` row | CSS + BEH | 🔴 **FACE CLOSED BY R-03**; the stack landed 2026-09-17 (U28) |
| U21 | Selected row | black 3D button face, no ring, no shadow | selection ring | CSS | 🔴 **CLOSED BY R-03** |
| U22 | Row marks | `@ N` mention pill + 6px dot, exclusive | ✅ **DONE 2026-09-17 (wave 4)** — the count was bought in wave 3 (R-28) and the workspace row now draws all three marks from `shared/ui/home-card-marks.tsx`: badge suppresses dot, plus the "Link out" chip. TWO INKS (`tone`), ONE implementation | BEH (data) | 4 ✅ |
| U23 | Row subtitle | last-message preview on the wire, rendered by nothing | absent | BEH | 4 |
| U24 | Well fill | `PANEL_WELL_ON_PANEL` on /home's column | `PANEL_WELL` on the info tabs; **no workspace PAGE uses either** | CSS | 🔴 **MOOT — CLOSED WITH U19 BY R-03** |
| U25 | Wells always render when empty | yes, both tabs and the column | yes (same module) | — | shipped |
| U26 | Empty-well copy | none — the sentence sits **beside** the boxes | same | — | shipped |
| U27 | Template card grid | three scoped `SectionPanel`s, per-section create | 52px header bar, `text-display` h1, white `.btn-light` pill, `max-w-[960px]` | CSS + BEH | 5, 6 |
| U28 | Presence rings | bare `AvatarStack`, no presence | `AvatarWithPresence` in 5 places | BEH | ✅ **ANSWERED 2026-09-17 (wave 4): NO RING, ONE STACK.** The workspace channel ROW had no roster at all and now draws /home's `AvatarStack`. Neither row gets a ring — `Channel` carries `onlineMemberCount`, a TOTAL, and a ring driven by a total claims a NAMED person is here. The 5 roster panes read a real per-member signal and keep `AvatarWithPresence` |

### 3.4 The channel record

| # | Difference | Home | Workspace | Kind | Wave |
|---|---|---|---|---|---|
| U29 | Pane frame | 2px `--home-panel-line` + `bg-home-card` card | `.page-float` white card | CSS | 6 |
| U30 | Structural dividers | 2px (`home.module.css:65-81`) | kit hairline | CSS | 6 |
| U31 | Resize pill | sits on a 2px line via `--channel-divider-w` | falls back to the hairline | CSS | 6 |
| U32 | Attribution pill face | raised-light (`[data-attribution-pill]`) | flat `.bento` | CSS | 6 |
| U33 | Composer panels | filled `--home-panel` (`[data-composer-panel]`) | neutral `bg-bg-inset` | CSS | 6 |
| U34 | Info card: curated rows with a hover × | present | **not rendered at all** | BEH | 1 |
| U35 | "Created" vs "Date of creation" | `formatDate`, `homeChannel.createdAt` | `formatShortDate`, `channel.createdAt` | BEH | 1 |
| U36 | Status pill (Active / Archived) | absent | present | BEH | 1 |
| U37 | "Linked threads" — 3 inert hash rows | absent | present, hardcoded | BEH | 1 |
| U38 | Members heading | count only | count + two inert icon buttons | BEH | 1 |
| U39 | Mentions | top-level category, always open, flush rows | collapsed disclosure with an unread badge, nested inset | BEH (ruled in kind) | keep |
| U40 | Artifacts toggle in the Threads heading | present | absent | BEH | 2 |
| U41 | Add person / Link out under the roster | present | absent (a link mint is not a member picker) | BEH (in kind) | keep |
| U42 | Header hashtag glyph / info-toggle circle | gone | gone | — | shipped |
| U43 | Click-to-edit name + description | live | live | — | shipped (markup still forked → Wave 1) |

### 3.5 Agents and threads

| # | Difference | Home | Workspace | Kind | Wave |
|---|---|---|---|---|---|
| U44 | Agent pane colour banner and stream accent | drawn | **not drawn** — the prop is never passed | BEH (drift) | 1 |
| U45 | Agent pane geometry | 380px overlay, `--home-card` ground, 2px divider | 380px overlay, neutral hairline (GUEST: full main area) | CSS (in kind for GUEST) | 6 |
| U46 | Agent window body | `AgentWorkingOn` → posture → stream → composer; **no Pause/End, no held gate** | identical | BEH (both) | 2 |
| U47 | Agent post accent (framed pill + side bar) | one drawn shape | identical | — | shipped |
| U48 | Agent card / peer card / launch row | identical | identical | — | shipped |
| U49 | Thread cards in four recency wells | identical | identical | — | shipped |
| U50 | Artifact list card / opened artifact | drawn | not drawn | BEH | 2 |
| U51 | Artifact card inline in the transcript | drawn | **drawn** — so a workspace reader already sees artifacts inline | — | shipped |
| U52 | Channel-activity strip | `PersonThreadActivity`, its own hook | `info-tab.tsx:248-263` from handed-down bins | duplicated, pixel-identical | 1 |
| U53 | Info column width persistence | shared `--info-w` | same | — | shipped |

### 3.6 Empty and loading states

| # | Difference | Home | Workspace | Kind | Wave |
|---|---|---|---|---|---|
| U54 | Channel record ghost | exact two-column shape, tab count by import | `channels-skeleton.tsx` "a rough fit"; **GUEST draws kit generics** | BEH | 1 |
| U55 | Page ghosts | 11 bespoke shapes across 8 files | 5 pages have one; **skills, chats and ontology have none** | BEH | R-06 |
| U56 | Frame ghost | `home-skeleton.tsx` draws its own | `ShellChromeSkeleton` — the same six boxes, second implementation | BEH | 5 |
| U57 | Error state | `PageError` in a full-screen wrapper | the identical wrapper and component, second copy | BEH | 0 |
| U58 | 🟡 **OPEN, AND RE-MEASURED 2026-09-17 (wave 4): it is NOT a copy alignment.** "No channels at all" | one whole-column line — `pages/home/relationship-list.tsx` (`No channels yet`, no full stop) — plus the record pane's `EmptyState` (`pages/home/home-panes.tsx`) | **per-SECTION lines, no whole-column state**: `channels/components/sidebar.tsx › EmptyRow` says `No direct messages yet.` and `No channels yet.` (with the full stop), and a Favorites section with nothing in it is ABSENT, header included | BEH | 4 — **blocked**: a whole-column statement collides with the ruled *"a home section emptied by the move keeps its header and says its ordinary 'none yet' line"* (INVARIANTS §5A), so it is a DESIGN decision, and R-03 holds the picker's design for a later wave. The surviving one-line delta — the full stop — is not worth a ruling on its own |
| U59 | ✅ **CLOSED 2026-09-17 BY DELETION ON BOTH SIDES, NOT BY A PORT (wave 4 review).** Two-sentence empty rule ("No matches" vs "No channels yet") | the "No matches" half went with the SEARCH NARROWING (`pages/home/home-rows.ts › hasLinkOut`'s neighbouring docblock records it; `home-panes.tsx` carries *"ONE SENTENCE SINCE 2026-09-17"*) | its twin `SIDEBAR_NO_MATCHES` was deleted the same day (`channels/components/sidebar.tsx › ChannelsSidebar` docblock) | — | **nothing to port**: neither picker has a second sentence any more, so there is no two-sentence rule left. What remains of the empty-state gap is U58 alone |
| U60 | "This channel is gone" ending | `EmptyState` on a pinned host | falls back to the first row — never an ending | BEH (in kind) | keep |
| U61 | Info-column tab bodies while loading | four tabs render nothing | same | BEH (both) | R-43 (ASK-35) |
| U62 | Skeleton announces itself (`role="status"`) | 2 of 8 exports | same | BEH (a11y) | 0 |
| U63 | Reduced-motion opt-out | on the surface, desktop only | **no web-tree rule stops `animate-pulse`** | BEH (a11y) | R-43 (ASK-9) |

**Row count — §3: 63 rows.** CSS-only 20 · behaviour 35 · already shipped/unified 8.

⚠ **The CSS fence is already correct architecture and should not be "fixed" by accident.**
`home.module.css:33-54` states it: the shared surface keeps neutral hairlines, and only the copy
mounted inside `.frame` wears the account palette, hooked on **attributes** rather than utility
classes. R-38 decides whether that fence is promoted or kept — it must not be dissolved by a sweep.

---

## 4. Target clean code structure

### 4.1 The host contract, keyed on CONTAINER KIND — never on the word "home"

"Home" names four different things in the tree today (the account surface, a `kind='link'`
container, the caller's default standard workspace, and the personal shelf) and three of them appear
in the same files. **Any contract that keys on "home" inherits that ambiguity.** The axis is the
closed set `WorkspaceKind = "standard" | "link" | "personal"`.

```ts
// ── LAYER 2 of §4.3: what a CONTAINER can do. Derived ONCE from the workspace row.
//    Never by negation; never an authorization answer.
interface ContainerCapabilities {
  kind: WorkspaceKind;                       // the closed set, positive form
  membership:                                // 1. roster shape + the one door in
    | { model: "roles"; roles: Role[]; addVia: "invitation" | "join_link" }   // standard
    | { model: "token"; addVia: "bound_link"; mintFloor: Role }               // link
    | { model: "solo" };                                                      // personal
  offersTeamScope: boolean;                  // 2. is `team` a grantable audience here
  isSoleAudience: boolean;                   // 3. memberCount === 1, FAIL CLOSED when unknown
  wallet: { kind: WalletKind; payer: "caller" | "owner" };                    // 4. whose credits
  address: { slug: string | null; id: string };                               // 5.
  noun: "workspace" | "home channel" | "personal container";                  // 6. agent-facing copy
}
```

Four of the six already exist as one function each (`containerTarget`, `offersTeamScope`,
`containerKind`, `assertMemberAddable`); two are hand-spelled in five and three places.

```ts
// ── The UI half. CAPABILITIES narrow or add; SLOTS add and never replace;
//    CONTEXT carries what the surface has ALREADY paid for.
interface ChannelSurfaceCapabilities {
  memberManagement?: boolean;   // narrows, default true
  selfManagement?: boolean;     // narrows, default true
  peerNamedHeader?: boolean;    // narrows, default true
  artifacts?: boolean;          // ADDS, default false  → R-16; delete the flag if it goes always-on
  // knowledge?: boolean;       // → R-18: delete, no host passes it
}

interface ChannelSurfaceSlots {
  infoExtras?: (ctx: ChannelInfoTabContext) => {   // ADDITIVE regions, never a body
    belowCard?: ReactNode;      // /home: Add person / Link out
    belowRoster?: ReactNode;
  };
}

interface ChannelInfoTabContext {
  gate: MutationGate;                        // 2026-08-25
  mentions: MentionsBundle;                  // 2026-09-15  ← added after a slot dropped it
  headerEdit: ChannelHeaderEdit;             // 2026-09-17  ← added after a slot dropped it
  headerEditable: boolean;                   // ← MOVE HERE (kills two spellings of one rule)
  members: ChannelMember[];                  // ← ADD (kills /home's second useChannelMembers)
  activity: { bins: readonly ActivityBin[]; loading: boolean };  // ← ADD
  mentionsLayout: "disclosure" | "category"; // the ONE ruled presentational fact
}

// ADAPTERS — what only a host can answer, as plain props:
//   workspaceId · workspaceSlug · channel · currentUserId · role · kind
//   onRosterChanged · onDeselect · webView · initialThreadId · Link
```

**A view never names its own surface.** `OntologyView`'s `frameless` prop is the model: *"`true` when
the host already IS a floated page panel."* The float-collapse CSS rule
(`app-shell.module.css:166-172`) exists because sixteen surfaces break that rule today.

### 4.2 The four rules

**G1 — One implementation per feature; a host NARROWS it, never forks it.** A capability is one flag
per *story*; a face two trees render is **declared in `src/` and re-exported by the SPA**, never
declared twice. *"A SECOND DECLARATION OF ANY OF THESE IS THE BUG."*

**G2 — A slot may ADD, never REPLACE.** Every parity bug in the channel area has one cause: a
body-replacing slot threw away something the surface had already paid for (`mentions` 2026-09-15,
`headerEdit` 2026-09-17, `activity` today). Additive slots make that class of bug unexpressible.

**G3 — A host passes `kind` and `role`, never a boolean `isHome`.** The kind is asked **positively**
(`kind === "link"`, or a `switch` with a `default`), never `!isStandardWorkspace(…)`. The one
exception is a **fence** (`assertMemberAddable`), which negates on purpose so a fourth kind inherits
the refusal. A fence negates; a label does not. And a capability is **not** authorization — the
seven `canSee*` predicates and their RLS twins stay kind-blind.

**G4 — No cache-to-cache bridges: one projection.** Two names for `favorited_at`, two caches and two
hand-written bridges is the shape that produced a user-visible bug. Before any field joins a merged
projection it gets **one** name. A scope resolver **refuses** rather than falling back
(`resolveShelfScope` is the worked example already in the tree).

### 4.3 The shared-tree layout

```
BEFORE (today)                                  AFTER (target)
──────────────────────────────────────────────  ──────────────────────────────────────────────
src/shared/layout/app-shell/                    src/shared/layout/app-shell/
  app-shell.module.css        (419)               app-shell.module.css
  app-sidebar-core.tsx        (177)               app-sidebar-core.tsx
  workspace-switcher-core.tsx (227)               workspace-switcher-core.tsx
  app-panel.tsx               DEAD  ✗ delete      app-shell-core.tsx      ← moved down (327)
                                                  account-rail.tsx/.css   ← moved down (244)
                                                  chrome-skeleton.tsx     ← moved down (151)
src/shared/ui/                                  src/shared/ui/
  page-action-button.ts, home-channel-row.tsx,    + page-header-strip.tsx ← moved down (104)
  home-card-marks.tsx, panel-well.ts,             + object-column.tsx     ← the generic half (~160)
  section-panel.tsx, collapse-wells.tsx,          + record-surface.ts     ← ONE declaration (~10)
  segmented-control.tsx, crossfade.tsx,           + page-states.tsx       ← moved down (86)
  form-dialog.tsx, empty-state.tsx, skeleton.tsx  + charts/bar-series.tsx ← moved down (256)
                                                  + search-field.tsx      ← moved down (70)
src/features/channels/components/               src/features/channels/components/
  channel-surface.tsx        (the FRAGMENT)       channel-surface.tsx          unchanged in shape
  channel-surface-data.ts    (the ONE loop)       channel-surface-data.ts      unchanged
  channel-surface-standalone.tsx                  channel-surface-standalone.tsx
  surface-info-panel.tsx                          surface-info-panel.tsx       mints the context
  info-panel.tsx / info-panel-tabs.ts             info-panel.tsx               (4 tabs, not 5)
  info-tab.tsx                                    info-tab.tsx     *** THE ONE INFO BODY ***
  knowledge-tab.tsx          NO HOST  ✗ delete    surface-agent-view.tsx *** THE ONE AGENT WIRING ***
  overlays.tsx  (2nd agent wiring) ✗ collapse     channel-record-skeleton.tsx  ← moved in (254)
  home-channel-wells.ts      (already here)       home-channel-wells.ts
apps/desktop-ui/src/pages/home/                 apps/desktop-ui/src/pages/home/
  person-info-tab.tsx        (395) ✗ delete       relationship-record.tsx  host: capabilities + extras
  person-thread-activity.tsx  (63) ✗ delete       person-members.tsx, link-out-panel.tsx,
  relationship-list.tsx      (253) → split          add-person-dialog.tsx    ← extras CONTENT
  home-header.tsx            (104) → move down    home.module.css            the paint fence
  home-search.tsx             (70) → move down    overview-*.tsx, *-panels.tsx  (≈2,200, stay)
  channel-record-skeleton.tsx (254) → move in
apps/desktop-ui/src/pages/**                    apps/desktop-ui/src/pages/**
  thin wrappers + 868-line Overview + 8,241        HOSTS ONLY: pick the view, pass the
  lines of /home composition                       capabilities, hand it the transport
```

**Move-down ledger (line counts measured 2026-09-17):** `AccountRail` 92 + 152 = **244** (blocker: a
Vite `?inline` asset import — needs a `mark` prop) · `AppShellLayout` **327** (blocker: router +
transport, solved by the `*Core` idiom) · `ShellChromeSkeleton` **151** · `ChannelRecordSkeleton`
**254** · `BarSeries` **256** · `RelationshipList` **253** (only the generic ~160 moves; the row
derivation stays) · `HomeHeader` **104** · `HomeSettingsControl` **133** (blocker: an SPA settings
binding) · `page-states.tsx` **86** · `HomeSearch` **70** · `.kbCards`/`.kbCell` **50** ·
`.glass-panel`/`.hairline`/`.hairline-strong` **~30** · `RECORD_SURFACE` **~10** ·
`FullScreenError` **6 × 2**. **Total ≈ 1,600 lines down, against ≈ 8,200 lines of /home composition
that stay.** The five /home faces (≈2,200 lines) move only if the web ever renders /home again.

### 4.4 The duplicates that collapse, with both paths

| Duplicate | Path A | Path B | Collapses to |
|---|---|---|---|
| The agent-pane wiring | `channels/components/surface-agent-view.tsx:44-80` | `channels/components/overlays.tsx:73-86` | `SurfaceAgentView`, rendered by `ChannelsOverlays` |
| The Info tab body | `channels/components/info-tab.tsx` | `apps/desktop-ui/src/pages/home/person-info-tab.tsx` | `info-tab.tsx` + `infoExtras` |
| The activity strip | `channels/components/info-tab.tsx:246-263` | `pages/home/person-thread-activity.tsx:55-60` | the shared strip, fed from context |
| `headerEditable` | `info-tab.tsx:106` | `person-info-tab.tsx:144` | `ChannelInfoTabContext.headerEditable` |
| The roster read | `info-tab.tsx:94` (prop) | `person-info-tab.tsx:166-169` (own hook) | `ChannelInfoTabContext.members` |
| Agent stats | `channels/components/agent-panel.tsx:461-483` | `pages/agent-window/agent-window.tsx:403-439` | one `AgentStats({showStarted?, className?})` |
| Template save/remove | `agent-templates-core.tsx:141-176` | `pages/home/agent-editor.tsx:222-275` | `agent-templates/hooks/use-template-save.ts` |
| The level-2 record card | `pages/home/index.tsx:284-285` | `src/shared/layout/app-shell/app-shell.module.css:140-150` | `record-surface.ts` |
| The full-screen error | `pages/home/index.tsx:137` | `components/app-shell/app-shell.tsx:195` | `FullScreenError` |
| The 36px black pill | `src/shared/ui/page-action-button.ts:30` | `channels/components/bits.tsx:69` | `TAB_ACTION` composes `PAGE_ACTION_BTN` |
| The frame ghost | `pages/home/home-skeleton.tsx` | `components/skeletons/shell-skeleton.tsx:38-60` | one `ChromeSkeleton` with the left column as a slot |
| The channel ghost | `pages/home/channel-record-skeleton.tsx` | `pages/channels/channels-skeleton.tsx` + kit generics on GUEST | `ChannelRecordSkeleton` in `src/` |
| The account rail | `components/app-shell/account-rail.tsx` | `marketing/components/banner-demo/demo-home-chrome.tsx:74-120` | one `AccountRail` in `src/shared/` |
| The /home header strip | `pages/home/home-header.tsx:37-102` | `banner-demo/demo-home-chrome.tsx:46-73` (character for character) | `PageHeaderStrip` in `src/shared/ui/` |
| The knowledge card grid | `home.module.css:200-249` | `knowledge-v2/home/knowledge-home.tsx` `.cardGrid` | a grid variant of `knowledge-v2` |
| The channel list projection | `features/home/types.ts › HomeChannel` (15 fields) | `features/channels/types.ts › Channel` (26) + `types-account.ts › AccountChannelStatus` | one `Channel` + `?scope=` |
| The overview series | `GET /api/home/overview-series` | `GET /api/workspaces/[slug]/overview-series` | one `metric` × `range` vocabulary, two fences |
| `isSoleAudience` | 5 hand-spelled `memberCount === 1` sites | — | one derivation on `ContainerCapabilities` |
| The container noun | `workspace-directory.ts:218 › containerKindLabel` | ~8 hardcoded strings in `tools/map.ts`, `tools/members.ts`, `channel-ops-hold-workspace.ts` | `containerNoun(kind)` |
| `isStandardWorkspace` | `src/features/workspaces/types.ts:89` | `packages/dopl-client/src/types.ts:104` | one, gated (F-295 / G5) |


---

## 5. Roadmap

Nine waves. Each is independently shippable, each makes the next smaller, and the order is chosen so
**nothing workspace-only is deprecated by accident**. One worktree per wave.

**Definition of green for every wave** (CLAUDE.md § *Definition of green*; re-derive with
`grep -n 'run:' .github/workflows/ci.yml`): five suites, **two** lints, **two** typechecks (the SPA
is outside the root tsconfig — `npm run typecheck -w @dopl/desktop-ui`), and **ten** non-suite gates
including `node scripts/check-doc-refs.mjs`, the `size-check` job, the committed-`dist` check
(`npm run build:packages` then `git status --porcelain -- 'packages/*/dist/*'` — the trailing `/*`
**is** the gate) and the `rls-redteam` job over **seven named files, not a glob**.
`npm run test:all` chains four suites and is **not** the definition.

**Always green, in every wave** (04 §F-1, the substrate): `workspace-kind.test.ts` ·
`link-container-guard.test.ts` · `resolve-active-workspace.test.ts` · `membership-admin.test.ts` ·
`home-channel-derivation.test.ts` · `b10-no-derived-default.test.ts` · `shared-publish.test.ts` ·
`check-role-drift.ts` · `check-rls-pair-gate.ts` · `check-tenancy-move-gate.ts` ·
`deep-link-target.test.mjs` · the seven `rls-redteam` files.

---

### Wave 0 — Gates and blockers. Nothing visible moves.
**Worktree `parity/w0-gates`.**

**Goal:** make the tree green, make the three prerequisites true, and buy the gates that stop the
next five waves being re-audited in six weeks.

| Item | Source |
|---|---|
| ✅ **F-688** — CLOSED 2026-09-17 by MEASUREMENT, not by splits. The root lint exits 0 at `cf87e6f6`, the sweep returns the three exempted files exactly, `packages/` is under the cap, and a 520-line probe proves the rule is live. The audit's *"sixteen unexempted files … the root lint is RED at HEAD"* was the 2026-09-09 number; the sixteen closed one at a time as their own contract changes arrived. **A parity branch starts GREEN** | 06 §C.0 |
| ✅ **F-343 — DONE 2026-09-17 in `5d9f215d`.** `HomeChannel.role` carries the caller's membership role per container; the hardcoded `"owner"` is gone and four /home controls gate on it. The rule is INVARIANTS §4A; the finding carries the shape | 04 §0.6-ii |
| ✅ **F-513** — DONE 2026-09-17 (R-08 confirmed, R-15 ruled yes): all four sites ask `isSharedRoom(memberCount)` — one predicate per tree, because `packages/` cannot import `src/`, pinned by a parity + census test. ⚠ The knowledge AUDIENCE CEILING asks the same conjunction and was NOT moved — **F-718** | 04 §E-11 |
| ✅ **F-712 — DONE 2026-09-17 (Wave 0c), BOTH HALVES.** The code half counts through `channel_artifact_spans`; the deploy half is `20261008120000_artifact_spans_rpc.sql`, applied **by NAME**, byte-exact. ⚠ It was a HARD dependency — unapplied, `artifactSpans` answers `PGRST202` and the card read fails loudly — so the row is done only because the apply is. **Re-derive, never quote:** `supabase migration list` / MCP `list_migrations`, joined on the NAME (F-304) | 02 A.2 R12 |
| **The slot-replacing-host audit** — walk every `slots.*` host and assert nothing the surface already minted is dropped. Three capabilities have been lost this way in three weeks | 06 "The one hazard…" |
| **Measure deploy state** — `npx supabase migration list --linked`, joined on the migration **NAME**, never the filename prefix. Two team migrations say *"WRITTEN, NOT APPLIED"* and `drop_home_scoped` is in `migrations-held/` | 04 §0.5; 05 §C.7 |
| ✅ **R-41** — DONE 2026-09-17: `check-css-token-drift.ts` compares the `@layer components` class SET in both directions (selector names, inside the layer only), with rows in CLAUDE.md § Definition of green and INVARIANTS §14 in the same change | 03 §E6 |
| ~~**Measure R-23**~~ — ✅ **MEASURED 2026-09-17: they open.** Both the /home pop-out and the /home agent window open; the control is kept and neither window is fenced to standard workspaces | 02 §R-3/§R-4 |
| ✅ **R-35 — DONE 2026-09-17, AND THE MEASUREMENT IS THE FINDING: there was no such code left to remove.** Both provisioning sites (`src/app/auth/callback/route.ts`, `workspaces/server/segment.ts › getBootState`) already called `ensurePersonalContainer` — wave B B14 had retired the default-minting path and only the DOCS still said otherwise. What the ruling bought instead is **PERMANENCE**, which nothing enforced: `deleteWorkspaceForUser` and `removeMember` now refuse a `kind='personal'` container (403 `PERSONAL_CONTAINER_PERMANENT`) and `20261009120000_personal_container_permanent.sql` (written, not applied) puts the refusal in the database with a `pg_trigger_depth()` exemption so account deletion still works. `default_workspace_of` untouched — it is still the hold point ledger 24 names | R-35 |
| ✅ **R-36 — DONE 2026-09-17: the sentence is CORRECTED TO SEVEN, not deleted** (Samuel: it should claim seven). The session-health set is seven fields and `scripts/check-session-health-drift.ts` is what holds that number; the doc now agrees with the gate instead of naming a field nobody landed | R-36 |
| Free deletions and collapses: X9 `AppPanel` · X15 `FullScreenError` · X16 `RECORD_SURFACE` · X10 `TAB_ACTION` composes `PAGE_ACTION_BTN` · ✅ P24 **DONE 2026-09-17** — `.glass-panel` mirrored into `kit.css`, `.hairline`/`.hairline-strong` DELETED from `globals.css` (zero users in either tree), and the class set is gated (R-41) | 03 §F.3 wave 0 |
| Doc repairs, each in the change that touches the file: X30 `channel-surface.tsx`'s `knowledge` docblock · X31 `authz.ts`'s retired two-member cap · X32 `packages/contracts/src/workspaces.ts` · X33 `DESIGN-SYSTEM.md:13` (allocate **F-714** — highest claimed on this branch is F-713; re-derive across live branches) · X34 the two fixture comments | 02 §C5; 03 §E9; 05 §F-notes |

**Rulings needed: ALL RULED 2026-09-17 — this wave is unblocked.** R-08 → **(a)**, executed here.
R-41 → **(a)**, the exit gate. ⚠ **R-43 is EXPIRED**, so the ASK-9 arm is gone: the shared-skeleton
promotion (Wave 1 item 6) proceeds on its own merits and nothing waits on a 2026-08-30 ASK batch.
**R-23 is ANSWERED by measurement — both windows open** — so the "Measure R-23" row below is
already discharged; keep the control and drop the fence question.
**Added to this wave by the rulings:** **R-36** — ✅ DONE 2026-09-17: the eighth-field sentence is
**corrected to SEVEN**, not deleted (do **not** land an eighth field); **R-35** — ✅ DONE 2026-09-17:
no code mints a default standard workspace at signup (it was already gone; the docs were the drift),
and the home space is now PERMANENT in code and in a written migration; **R-32** — the container-address change lands as the addressing
contract Wave 3 is built on (see Wave 3).
**Files touched:** ~40 (16 over-cap splits, 5 doc files, 4 deletions, 2 gate scripts).
**Risk:** a cap split moves code without changing it — the risk is a moved export path. **Rollback:**
each split is its own commit; revert individually.

---

### Wave 1 — One channel record surface, zero forks.
**Worktree `parity/w1-channel-surface`.**

🟢 **MERGED TO `master` 2026-09-17 — WAVES 1A AND 1B ARE DONE, AND ITEM 6 IS NOT.**
`wave1/one-record-surface` (1A, plus F-722 and one review commit) fast-forwarded onto master after
the full gate set. ⚠ **THIS ROW SAYS "MERGED", NOT "COMPLETE"**, and the difference is item 6: the
`ChannelRecordSkeleton` move is still 🔴 open and still in `apps/desktop-ui/`. Items 1–5 and 7 are
done, so what is left of Wave 1 is that one move — re-scope it as its own branch rather than
inheriting a worktree that no longer exists. **Review pass (2026-09-17), on the merge commit:** the
client mirror of `canManageChannel` collapsed to one declaration
(`channels/lib/channel-manage-gate.ts › canManageChannelHere`, was three call sites),
`MentionsLayout` became one exported union (was three literals), and the wave's files lost a NET
356 comment lines (705 deleted, 349 rewritten shorter — measured 2026-09-17 on the review commit).
INVARIANTS §5A's click-to-edit clause still described the deleted `infoTab` slot and was corrected
in the same change.

**Goal:** the thing Samuel is looking at. One info body, one agent wiring, one loading ghost — and
the three capability-losing slots closed for good.

| Order | Items | Why here |
|---|---|---|
| 1 | ✅ **DONE (wave 1A) — P2 + P1** — `ChannelsOverlays` renders `SurfaceAgentView`; **eight** forwarded props disappear (the doc said 9 and 14 before; the number is `git show` on `overlays.tsx`) and the missing colour is fixed as a side effect, not a patch | smallest blast radius, closes a live visible drift |
| 2 | ✅ **DONE (wave 1A) — P8** — `activity` onto `ChannelInfoTabContext`; **X6** `person-thread-activity.tsx` deleted. **X7** done too — `HARDCODED_THREAD_ACTIVITY` and `fixtures.test.ts` deleted after re-deriving: the array's only reader since 2026-09-05 was its own test | the context pattern's fourth application |
| 3 | ✅ **DONE (wave 1A) — P9** — `members` **and `index`** onto the context, which is where **F-723** died. ⚠ **`headerEditable` was NOT added and deliberately so**: the second spelling of that rule was `person-info-tab.tsx`'s, and it died with the file — a context field nothing reads is the debt this wave is removing, not adding | kills /home's second and third roster hooks and two spellings of one rule |
| 4 | ✅ **DONE (wave 1A) — P7 + P6** — one `info-tab.tsx` (+ `info-tab-card.tsx` at §1's cap) with `mentionsLayout` and `infoExtras`; **X5** `person-info-tab.tsx` deleted. ⚠ **`mentionsLayout` IS A CAPABILITY, NOT A CONTEXT FIELD** — 08 §6.1 put it on `ChannelInfoTabContext`, which is the surface→host direction, and this is a host→surface decision. R-19 · R-20 · R-22 · R-45 · R-46 had already landed in wave 1B | one body, one ruled face |
| 5 | **X4** — delete the `knowledge` capability, tab, width branch and `channelPaneTabs` arm (**R-18**) | it changes the tab set, so it must land with the body |
| 6 | 🟡 **THE MOVE IS DONE (wave 2, 2026-09-17); THE TWO ADOPTIONS ARE NOT — P10 + X8.** `ChannelRecordSkeleton` is in `src/features/channels/components/` and `pages/home/channel-record-skeleton.tsx` re-exports it, so no call site moved and the byte-share pins are UNCHANGED — which is the evidence the move carried no edit. ⚠ **THE SEAM WAVE 1A PREDICTED WAS REAL AND IT WAS `SkeletonSurface`**: SPA-only, and `src/features/channels/` cannot import `#/` (§1), so that wrapper (with `SkeletonChrome` and its CSS module, renamed `skeleton-surface.module.css`) moved to `src/shared/ui/skeleton-surface.tsx` in the same change, with the SPA path re-exporting both — nine SPA skeletons kept their import. 🔴 **STILL OPEN: GUEST adopts it; WS composes it beside its tree ghost** — those are call-site changes with a visible result, and wave 2's rules forbade a visual change. Original scope: ⚠ **No longer gated on ASK-9** (R-43 expired). ⚠ **WAVE 1A LEFT IT ON PURPOSE AND MEASURED WHY:** it is neither small nor disjoint from the wave's subject — the file is 240+ lines, imports the SPA's own `SkeletonSurface` (so the move needs a seam, not a `git mv`), and `pages/home/channel-record-skeleton.test.tsx` pins it by BYTE-SHARE against the live panes the wave was rewriting. Doing it inside a commit that reshaped those panes would have made the byte-share pins unreadable as evidence | closes F-220 and the guest layout jump |
| 7 | 🔴 **R-21 — REMOVE THE ARCHIVE FEATURE ENTIRELY, on BOTH surfaces.** Samuel: *"a user can delete a channel; no point in archives."* Not a Status row: the archive control, the lifecycle write, the Archived filter and every reader of the archived flag go. It lands here because it changes the same info body — but it is **larger than the body** and reaches the channel service and the list filters. See ledger row 23 | the ruling, and the only NEW work this wave acquired |

🟢 **WAVE 1A LANDED 2026-09-17 (branch `wave1/one-record-surface`, one commit each) — ITEMS 1, 2 AND 3 ARE DONE AND THE FORK IS GONE.**
**Item 1** — `overlays.tsx` renders `SurfaceAgentView`; eight forwarded props deleted, and the
agent COLOUR the workspace page had never rendered arrives as a side effect of there being one
wiring (pinned by `channels-core-agent-color.test.tsx`, mounted on the PAGE).
**Items 2 + 3** — `ChannelInfoTabContext` gained `members`, `index`, `activity`, `channelName`;
`ChannelSurfaceSlots.infoTab` is **DELETED** and replaced by `infoExtras`, a record of NAMED
REGIONS that cannot be handed a body; `ChannelSurfaceCapabilities` gained `mentionsLayout`
(`"disclosure" | "category"`), which is the ONE ruled presentational difference between the two
surfaces. **`person-info-tab.tsx` (402), `person-thread-activity.tsx` (63) and
`banner-demo/demo-info-tab.tsx` (206) are deleted**; `person-members.tsx` is reduced to
`person-roster-actions.tsx` (Add person / Link out only). **The hero demo was a FIFTH copy of the
body and is now a fourth HOST of it.**
🔴 **F-723 — THE LIVE DEFECT 08 §4.3 FOUND IS FIXED AND PINNED.** /home's roster passed no
`viewerUserId`, so the OPERATOR read as offline in their own home channel.
➕ **AND ONE ITEM WAVE 1A ACQUIRED: F-721 RESOLVED (Samuel, 2026-09-17 — R-46's option (b),
answered yes later the same day).** The Members heading gets **Add member** back — as the
page-action pill over the existing `invite-dialog.tsx › InviteDialog`, gated `channel.role ===
"owner" || meetsMinRole(role, "admin")` under `capabilities.memberManagement`, hidden not
disabled, mounted only while open. ⚠ **NOT the mock's inert `IconButton`, and "Filter members"
stays deleted.** It landed here because wave 1A owns `info-tab.tsx`.
⚠ **WHAT WAVE 1A DID NOT DO: item 6** — see the row below it.

🟢 **WAVE 1B LANDED 2026-09-17 (branch `wave1/deletions-and-info-rows`, one commit each).** The
DELETIONS and the small info-tab rows are **DONE**: **R-18** (item 5 — the whole knowledge lane, not
only the tab: component, hook, client module, capability, width branch, `channelPaneTabs` arm, the
four `(route, method)` pairs across three route files, the shared route helper, the lane's payload
service, and four now-unreachable gates in `service-channel-grants.ts`) · **R-45** · **R-22** ·
**R-46** · **R-20** (a shared `channel-display.ts › CREATED_ROW_LABEL` + `formatDate` on both
bodies) · **R-19** (the shared body renders the curated rows through `info-card-rows.tsx ›
InfoCardCustomRow`, the write minted in `surface-info-panel.tsx` beside `headerEdit`) · **R-21**
(the archive feature removed end to end; the column drop is WRITTEN NOT APPLIED).
⚠ **WHAT WAVE 1B DID NOT DO, AND IT IS THE REST OF THIS TABLE:** items 1, 2, 3 and 6 — the
`SurfaceAgentView` collapse, `activity`/`members`/`headerEditable` onto the context, the
`person-info-tab.tsx` absorption, and the skeleton move. **R-19 landed WITHOUT the collapse**, so
/home still renders its own copy of the curated rows; that is the one-body step's to remove, and
/home's rendering was left byte-identical on purpose. New findings: **F-720** (a granted KB now has
no channel-side human reader), **F-721** ("Add member" → invite dialog, R-46's option (b) as a
ticket), **F-722** (the THREAD info tab still says "Date of creation").

**Rulings: ALL SEVEN RULED 2026-09-17 — this wave is unblocked.** R-18 → delete the dead lane ·
R-19 → (a) · R-20 → (a) · **R-21 → remove the archive feature entirely (item 7 — this GREW the wave)** ·
R-22 → delete · R-45 → delete · R-46 → delete. **R-43 is EXPIRED**, so item 6 has no ASK-9 gate.
**R-50 → leave** — the pre-2026-08-24 containers stay display-only and step 3 moves the line unchanged;
no migration.
**Files touched:** ~22 as scoped, **plus the archive removal (R-21)** — re-scope before opening the
worktree; the archive reaches the channel service and the list filters, not only the info body.
**Gates:** `channels` suite · `page-skeletons.test.tsx` (TEN page shapes) + `channel-record-skeleton.test.tsx` byte-share pins · `knowledge-tab.test.tsx › the capability, per host` · `guest-channel.test.tsx` · `settings-tab.test.tsx › minimal copy` (8-word caption bound).
**Risk:** the collapse breaks `person-info-tab*.test.tsx` (**6 files**) and `surface-slot-fixtures.tsx`; **nobody has counted the assertions that move** (01 gap 1). **Rollback:** the slot still exists — restoring `person-info-tab.tsx` as an `infoExtras` consumer is a one-file revert.

---

### Wave 2 — Artifacts and the info-column capability set.
**Worktree `parity/w2-artifacts`.**

🟢 **MERGED TO `master` 2026-09-17** (branch `wave2/artifacts-agents-heldgate`, 5 build commits +
1 review commit, fast-forward). **FIVE ITEMS DONE, ONE HALF HELD** — P3 · P4 · P5 · P16 · P17 ·
P18, with R-25's own-ended half open as F-724.
✅ **P3 + P4 + P5 (R-16 / R-17)** — `channels-core.tsx` passes `capabilities={{ artifacts: true }}`.
⚠ **The GUEST lane deliberately does NOT get it**: the route floor IS `guest`
(`src/app/api/channels/[channelId]/artifacts/route.ts`, both verbs), so a guest *could* read — but
R-16 was ruled **(a)**, not (c), and the Artifacts design lists the web renderer among the things
deliberately not designed. Four docblocks saying "/home only" were corrected.
✅ **P16 (R-24)** — `AgentHeldGates` mounts in `agent-window.tsx`; Pause/End did not follow, and the
test asserts their absence.
🟡 **R-25** — the room-wide half needed NO CODE (see the ruling) and is pinned; the ENDED half is
**F-724, OPEN**.
🟡 **Wave 1 item 6** — the skeleton MOVE is done; its two adoptions are not (see that row).
✅ **P17 + P18 LANDED IN THE REVIEW COMMIT** (they were out of the build's scope and are in the
review's): `AgentStats` is one declaration in its own file — a SPLIT, because `agent-panel.tsx`
stood exactly at §1's cap and a file at 500 cannot absorb a prop — and `useTemplateSave` is one
create-or-patch-or-delete orchestration both authoring surfaces call.
🐛 **AND THE REVIEW FIXED ONE REAL BUG, WIDENED BY THIS WAVE.** `artifacts-tab.tsx` dropped the
`error` BOTH its hooks return, so a refused list read — a reader whose access went away
mid-session, an offline desktop, a 500 — rendered `ARTIFACTS_EMPTY_NOTE`: *"No artifacts in this
channel yet"*, a positive claim about the channel made from a failure to ask it. R-16 put that face
on a second host. Both arms now say the read failed (`ARTIFACTS_UNREAD_NOTE`), and only when there
is nothing already on screen. ⚠ **The GUEST lane needed no new pin** — `guest-channel.test.tsx`
asserts its capability object by `toEqual`, so an `artifacts` key appearing there fails.
**Gates run at merge, 2026-09-17:** `npm run typecheck` · `npm run typecheck -w @dopl/desktop-ui` ·
`npx vitest run` at the ROOT (563 files / 8050 passed, 42 skipped) · `npm test -w @dopl/desktop-ui`
(72 / 644) · `npm run lint -- --max-warnings 0` · `npx tsx scripts/check-css-token-drift.ts`
(241 tokens, 33 kit recipes) · `node scripts/check-doc-refs.mjs` · the five drift scripts · the
500-line sweep over `src`/`packages`/`apps` (three known exemptions, nothing new). ⚠ **NOT run
here: the `rls-redteam` job** — no schema, no migration and no predicate touched, and it needs
Docker. ⚠ **`@dopl/mcp-server` was not run either: `packages/` has no diff on this branch.**

**Goal:** stop a workspace reader seeing an artifact inline and being unable to browse the channel's
artifacts.

**Items:** P3 · P4 · P5 (all ride one flag) · P16 held-gate in the agent window · P17 one
`AgentStats` · P18 one template save orchestration.
**Rulings: ALL RULED 2026-09-17 — unblocked.** R-16 → **yes (a), after F-712** (Wave 0) ·
R-17 → **(a)**, the toggle everywhere · R-24 → **(b)**, the held gate moves to the window too and
Pause/End stays panel-only.
**Added by the rulings:** **R-25** — the Agents tab shows **everyone's LIVE agents and hides ended
ones**. That is not "leave it": it replaces the own-agents-plus-peer-state-cards model, so it is new
work in the same surface.
**Files touched:** ~8 (one line in `channels-core.tsx`; the rest is de-dup).
**Gates:** `agents-tab-launch.test.tsx` · `agent-post-accent*.test.tsx` · **F-712 must be fixed in Wave 0** — a browse list with silently wrong span numbers is worse in a busy room than in a two-person channel.
**Risk:** low; the flag adds a face whose reads mount with it, so an unopened channel pays nothing. **Rollback:** flip the flag back.

---

### Wave 3 — One channel projection. The substrate.
**Worktree `parity/w3-one-projection`.**

**Goal:** one answer to "which channels am I in and what is their state"; delete both cache bridges.

**Items:** P30 `?scope=container|account` · P32 one wire name for `favorited_at` · P31 delete
`use-home-channel-sync.ts` + `use-home-unread-refresh.ts` · P35 one clipped/`truncated` vocabulary ·
P36 `isSoleAudience` · P37 `containerNoun(kind)` · P38 one liveness mechanism ·
X18/V16 decide `lastMessagePreview`'s fate · X21/R-48 drop `channel_personal_arming`.

✅ **MERGED TO `master` 2026-09-17** (branch `wave3/one-channel-projection`, 5 build commits + 1
review commit, fast-forward, full gate set green). **What the review changed, one line each:** the
`scope=account` membership PROOF was written TWICE (`repository-account.ts › listAccountChannelRefs`
and `repository-list-extras.ts › listAccountChannelRows` each spelled the container lock, the stable
order and the `>=` ceiling) and is now ONE function, `listMyChannelMemberships`, pinned by a twin
test · `repository-collab.ts › presenceForWorkspaces` collapsed a person's N container rows by
"last row read wins", which PostgREST does not order — it takes the FRESHEST `last_seen_at` now,
pinned in both row orders · `ChannelListPayload` gained the `truncated` key the handler was already
emitting and the SDK already declared · the two /home surfaces that want channels-without-rows went
through one memoised `use-home-channels.ts` instead of two un-memoised call sites · INVARIANTS §4A
still described `HomeChannel.peers`/`peer` as LIVE (the doc-refs gate passed only because a docblock
happened to carry the string) and now states the `ChannelRowExtras.peers` that replaced them; three
findings-log anchors at the deleted `hydrateChannels` were repointed · 153 comment lines removed
across the wave's files, mostly the same R-26 ruling restated in nine headers. **New coverage:**
`app/api/channels/route-scope-fence.test.ts` (which wrapper each arm carries, both account arms
`withUserAuth`, the B1 lock, a bad `scope` reaching neither) and
`channels/server/service-list-fence.test.ts` (the four personas — non-member, guest, departed member,
a container the caller cannot see — asserting the channel is never NAMED, not merely filtered).

🟢 **WHAT LANDED: P30, P31, P32, P35, R-28's COUNT, R-48 and F-719.** One endpoint (`GET|POST /api/channels?scope=container|account`), one row type
(`Channel & types-list.ts › ChannelRowExtras`), one client cache per scope, both bridges deleted,
`myFavoritedAt` everywhere, `Channel.mentionCount` server-computed off the inbox's own predicate,
the arming table's drop written (not applied), and the MCP's ambiguous-slug refusal.
⚠ **P35 IS HALF-ANSWERED ON PURPOSE:** `scope=account` reports `truncated`, replacing two of /home's
three silent ceilings; the MENTION scan stays non-reporting because a badge that under-counts is a
nudge and not a claim about the list. **P36, P37, P38 and X18/V16 are NOT done** — `lastMessagePreview`
was DELETED from the projection rather than decided (ledger row 22 stays open: nothing had rendered
it since 2026-09-13, so keeping it on a new wire shape would have been re-minting the orphan).
⚠ **R-32's MCP half was Wave 0's and was already in `master`;** what this wave added is the typed
`container {id, kind, segment}` on every channel ROW, which is the same contract one layer down.
⚠ **P33 (one overview-series vocabulary) MOVED OUT OF THIS WAVE (2026-09-17 review):** it depends on
**R-29**, which is scheduled for Wave 8, and no wave may depend on a ruling that lands later. P33 is
Wave 8's first item and Wave 8 already says so.
**Rulings: ALL RULED 2026-09-17 — unblocked.** R-26 → **(b), one endpoint** · R-27 → **(a)**,
`myFavoritedAt` everywhere · R-28 → **YES, the `@ N` badge, which means building the COUNT** (a server
projection, not a UI port) — so X18/V16 is decided the other way for the badge, and
`lastMessagePreview`'s own fate is still unanswered (ledger row 22) · R-48 → **drop the table** ·
R-08 → **(a)**, already executed in Wave 0.
🔴 **R-32 IS BIGGER THAN (a) OR (b), AND IT IS THIS WAVE'S ADDRESSING CONTRACT.** Containers get a
**first-class address**: personal = the reserved name **`home`**, resolved per caller · a home-channel
container = **its channel slug** · a workspace = **its slug**. **One `container=` parameter replaces
`workspace=`.** Container **KIND becomes a typed field on every MCP row and list**, and **`dopl_map`
shows "Home space" as its own top-level node**. An unaddressed call resolves to **home**. Samuel:
*home must be structurally distinct, never just a prompt line* — so this is a shape change across the
MCP surface, not a parameter rename, and it is now in this wave's scope alongside P30.
**Files touched:** ~30 across `src/features/{home,channels,workspaces}`, `packages/contracts`,
`packages/dopl-client` **and both committed `dist/` trees**.
**Gates:** `check-role-drift.ts` (the `GET /api/workspaces` row shape) · `check-message-kind-drift.ts` · the committed-`dist` check · `home/server/*.test.ts` (10) · `channels/client` cache suites.
**Risk — the highest in the roadmap, and it is a CACHE migration.** `/api/home/channels` is
IndexedDB-persisted with a 24h `gcTime` and **five documented per-field fallbacks**
(`?? EMPTY_PEERS`, `?? ""`, `?? false`, `?? 0`, `?? null`). A cut-over must keep the old path
answering for one release **or** bump the version gate, and every new cached field needs its
`?? EMPTY_X` plus a stale-cache test.
⚠ **/home structurally cannot be live on more than one container**: `main/ui-sync.js › watch` holds
exactly ONE realtime channel filtered on ONE `workspace_id` (F-222), so an account-scoped surface
spans N containers and can be live for at most one. **That is a substrate decision this wave cannot
paper over** — state it, do not hide it.
**Rollback:** keep `/api/home/channels` answering; the bridges stay deleted only after one green release.

---

### Wave 4 — The object column and the channel picker.
**Worktree `parity/w4-object-column`.**

**Goal:** "pick a thing" is one control on every page.

**Items — this wave SHRANK on the 2026-09-17 rulings.** What survives: split `RelationshipList` into
derivation + `ObjectColumn` (D8) · P13's **unread mention count** (the server projection R-28 requires)
and the `@ N` badge on the workspace row · **U28** presence rings (this line said "P28", which is the
account-palette skin and was Wave 6's — a typo, corrected 2026-09-17) · U58/U59 the empty-state
sentences.
🔴 **DROPPED: P11 (wells) and P12 (row card face + selected face).** **R-03 — the workspace picker
gets its OWN design later; do not port /home's.** Neither column is the answer, so nothing is ported
until that design exists. **R-40 — keep all three home items** (the label-less credit bar,
`HOME_CARD_FACE_SELECTED`, the Agents-page face); a home-only choice needs no recorded reason, and the
01-vs-06 disagreement about the selected-row face is moot because it is not being ported.
**Rulings: ALL RULED 2026-09-17.** R-03 → own design later · R-28 → build the count, port the badge ·
R-40 → keep the home items.
**Files touched:** ~14.
**Gates:** `collapse-wells.test.tsx` · `well-state` suite (keys are scoped by SURFACE, not by host — do not per-host them) · `home-channel-row` suites · `sidebar-rows` suites.
**Risk:** R-03(a) would delete the tree's nesting and its Favorites/DM sections — **real structure**.
Recommend (b). **Rollback:** the wells are a call site over a shared module; revert the call site.

#### ✅ Wave 4 — the PICKER MARKS half

🟢 **MERGED TO `master` 2026-09-17** (branch `wave4/picker-marks`, 4 build commits + 1 review
commit, rebased onto master and fast-forwarded, full gate set). What landed, one commit each:

1. **U28 / P12's stack — the roster rides the workspace channel row.** `sidebar-rows.tsx ›
   ChannelRow` takes `faces` and draws `@/shared/ui/avatar-stack` at /home's own `2xs` / `max=3`, in
   a trailing group that is ABSENT when it holds nothing. `channels/lib/channel-display.ts ›
   channelRowFaces` is the ONE peer→face derivation and `relationship-list.tsx` imports it instead of
   mapping inline — same output, so the `?? email ?? "Member"` chain cannot drift between hosts.
   ⚠ **A DM ROW IGNORES IT**: its leading slot already IS that person's face, which is
   `sidebar-rows.tsx`'s own rule since it was written. ⚠ **NO PRESENCE RING** — see the U28 row
   above; `AvatarStack` has an `online` key and the projection has no per-peer signal to fill it.
   `?? EMPTY_PEERS` at the call site (§8). `sidebar-row-signals.test.tsx` 11 → 15 (and → 19 with the chip suite and the review's layout pin).
2. **U22 — the dot and the "Link out" chip stop being cut twice.** The PRECEDENCE was already right
   on both rows (R-28, Wave 3); what was wrong is where the marks were DECLARED. The workspace row
   hand-cut its own 6px span (its own geometry, accessible name and colour) and the chip existed only
   as inline markup in `home-channel-row.tsx`. Both are `shared/ui/home-card-marks.tsx` now —
   `UnreadDot` gains `tone`, `LinkOutChip` is lifted out unchanged. ⚠ **TWO INKS IS NOT TWO
   IMPLEMENTATIONS**: `tone="link"` keeps the picker's blue (R-03 — its own design), `onDark`
   outranks both because the face the dot stands on decides before the surface's accent does. New
   `shared/ui/home-card-marks.test.tsx` (9) carries a SOURCE SCAN pinning one declaration of the dot;
   `sidebar-row-signals.test.tsx` 15 → 18 for the chip.
3. **D8's seam, taken on the WORKSPACE column.** `sidebar.tsx` carried two responsibilities — the
   list of SECTIONS, and a search surface with three pieces of private state no section, row or
   branch reads — so the strip is `sidebar-search.tsx › SidebarSearchHeader` (385 → 335 + 105, measured 2026-09-17 after the review's comment trim). Same
   seam `sidebar-rows.tsx` named at design time and `sidebar-branch.tsx` already took a third slice
   off. 🚫 **NO IMPORTER MOVED and NO BEHAVIOUR CHANGED**; pinned by the suites that were already
   green. `page-skeletons.test.tsx` reads the 52px strip's class expression from the new file — the
   same repair, for the same reason, as when the pane header left `message-pane.tsx` on 2026-09-01.
4. 🔴 **THE WELLS ARE CLOSED BY R-03, NOT DEFERRED (P11, P12's faces, U19, U20, U21, U24).** *The
   workspace picker gets its own design later; do not port /home's.* Nothing was added to the picker
   and nothing was taken off it. ⚠ **THE MARKS ABOVE ARE NOT A PARTIAL PORT OF THAT DESIGN** — a
   roster, an unread dot and a mention count are FACTS the projection carries for every row of both
   scopes, and each is drawn in the picker's own 36px layout with the picker's own ink. R-03 is about
   the CARD.

⚠ **U58 STAYS OPEN; U59 IS CLOSED BY DELETION (re-measured at the wave 4 review).** U59's second
sentence ("No matches") went from /home with the search narrowing and from the picker as
`SIDEBAR_NO_MATCHES`, both on 2026-09-17 — there is no two-sentence rule left to port. **U58 is not
the one-line copy alignment it reads as**: /home says ONE whole-column line, the picker says a line
PER SECTION and drops an empty Favorites section entirely, and a whole-column statement would
contradict the ruled "a section emptied by the move keeps its header and its 'none yet' line". That
is a design decision, and R-03 holds the picker's design for a later wave. The rows above carry the
measurement.

> ✅ **REVIEWED + MERGED 2026-09-17.** Review fixes: **`UnreadDotTone` was declared BETWEEN the dot's docblock and the dot**, so the two-inks decision and the `onDark`-outranks-`tone` precedence documented the TYPE and every `{@link UnreadDot}` pointed at an undocumented component — the type moved above the block · **`channels/components/sidebar.tsx` still argued for the Favorites guard as what "keeps the header standing (and saying \"No matches.\")" when a query empties a section**, three lines from its own docblock recording that the filter and `SIDEBAR_NO_MATCHES` are DELETED · **the diff carried no layout pin**, and the trailing group grew from one 6px dot to a chip + three faces + a mark inside a FIXED 260px column, so `sidebar-row-signals.test.tsx` now renders a 54-character channel name wearing all three and asserts the label keeps `truncate` (it is the only flexible item in the row) and the ONE trailing group keeps `shrink-0` · **the suite counts in this section were off by one** — master holds ELEVEN, so it is 11 → 15 → 18, now 19 · `sidebar-rows.tsx › ChannelRow`'s `hasStack`/`stack` pair collapsed to one array (`AvatarStack` already returns null at zero, so the inner guard was the group guard said twice) and `shared/ui/avatar-stack.tsx` takes `readonly` users, which drops a `[...stack]` copy per row per render · 38 net comment lines removed, each restating a docblock, INVARIANTS or this file within a screen of itself. Verified rather than assumed: `sidebar-branch.tsx › ChannelBranch` is the ONLY `ChannelRow` call site in the tree (`playground/components/panes/channels-pane.tsx`'s `ChannelRow` is a file-local function of its own name) · `reserveTrailing`'s `pr-8` clears the disclosure chevron's `right-1 h-6 w-6`, so the roster cannot collide with it · the picker's `(channel.linkOut ?? null) !== null` is byte-for-byte `pages/home/home-rows.ts › hasLinkOut`'s channel arm, i.e. the same claim-gate predicate `types-list.ts › ChannelRowExtras.linkOut` names.


---

### Wave 5 — The shell and the one header.
**Worktree `parity/w5-shell-header`.**

**Goal:** five header recipes become one; the shell assembly and the rail move into the shared tree.

**Items — re-scoped by the 2026-09-17 rulings.** What survives: P21 the ~20 hand-cut pill sweep ·
**P25 `Crossfade` — on PAGE SWITCHES TOO** (R-05 chose (a), not the recommended in-page-only (b)) ·
P39 `AccountRail` + `AppShellLayout` + `ShellChromeSkeleton` move down behind the `*Core` idiom ·
P40 `BarSeries` moves down · U56 one frame ghost · **R-01(a)** redirect any non-standard container's
segment to that container's CHANNEL RECORD (`/home` only as the fallback — see the MERGED row below,
where the destination is recorded as decided) · **R-13** remove the nav for EVERY member of such a
container, not only the guest.
🔴 **DROPPED: P19's title collapse.** **R-02 — KEEP the workspace sidebar and the page titles**: the
/home strip vs the workspace sidebar is an **intentional difference**, not drift. Header GEOMETRY may
still be unified, but no title is deleted and **the Knowledge hero band is not deleted on R-02's
authority** (ledger row 16).
🔴 **DROPPED: P20 per-page search.** **R-04 — answered by the search popup, one surface.**
🔒 **THE SETTINGS PAGE IS FROZEN** (R-10) pending Samuel's separate overhaul: H3's header, its
dialogs and its section language are out of scope in this wave and in Wave 6.
**R-06 — no page skeletons now** (later), so this wave adds none. **R-07 — keep both "Agents" names
as-is**; no rename.
**Rulings: ALL RULED 2026-09-17.** R-01 → (a) · R-02 → keep titles · R-04 → the search popup ·
R-05 → crossfade page switches too · R-06 → not now · R-07 → keep both · R-10 → (a) + FROZEN ·
R-13 → expired, and the guest nav goes.
✅ **THE SHELL HALF OF THIS WAVE IS MERGED** (R-01(a), R-13, R-05); P21, P39, P40, U56 and R-02's
header geometry are NOT started. The row below is the record.

#### ✅ Wave 5 — the SHELL half

🟢 **MERGED TO `master` 2026-09-17** (branch `wave5/shell`, 4 build commits + 1 review commit,
fast-forward, full gate set). **R-01(a), R-13 and R-05 are in the tree.** What landed, one commit
each:

1. **R-01(a) / X19 — the shell refuses every member of a home-channel container, not only the
   guest.** `apps/desktop-ui/src/components/app-shell/app-shell.tsx › AppShellLayout`: the redirect
   that was fenced on `role === "guest"` (ledger ASK-2, 2026-08-30) is now fenced on the container
   KIND, read through `isStandardWorkspace` — the POSITIVE predicate (INVARIANTS §4A, F-295), never
   a hand `!== "link"`. `personal` stays out of this arm because the effect above it already owns
   it; two arms firing would race two `replace`s over one history entry. **The destination is
   unchanged** — the container's own channel record, `/home` when the read answers no channel or
   fails. `app-shell-guest.test.tsx` 6 cases → 13; the gate narrowed back to `role === "guest"` is
   3 red.
   🔒 **THE DESTINATION IS THE CHANNEL RECORD, AND THAT IS DECIDED, NOT ASSUMED (2026-09-17
   review).** The brief said *"the container's channel record"*; Samuel's literal wording under R-01
   said *"redirects to /home"*. **The channel record stands** — it is the same ruling with a better
   landing, and the code shows it always resolves: the read is `GET /api/channels?scope=account`
   (it was `GET /api/home/channels` until Wave 3's R-26 repointed it), fenced by
   the caller's own membership rows, and EVERY member of the container (guest, member, admin, owner)
   is on those rows, so the match on `workspaceId` cannot come up empty for somebody the shell is
   refusing. `/home` remains the answer when it does come up empty or fails, which is Samuel's
   wording as the fallback rather than the rule.
2. **R-13 — the nav is DELETED, not ported.** `AppSidebarCore` is not rendered for a container
   member: eight rows, the switcher, the Team upsell and the settings gear all pointed at pages the
   redirect bounces. It reads the SAME `isContainerMember` the redirect reads — one derivation of
   the kind, not two. The card's missing left inset is `.panel[data-no-nav] .pageCard` in
   `app-shell.module.css`, an ATTRIBUTE hook, because the panel's and the card's class EXPRESSIONS
   are byte-shared with the shell ghost (`components/skeletons/frame-skeletons.test.tsx`).
   ⚠ **R-13's sentence points at the DESKTOP shell, not at `/c/{containerId}`.** The guest WEB lane
   renders no nav and never did (`channels/components/channel-single-column.tsx`: *"there is no
   other navigation on this page to offer them"*) — measured, not assumed.
3. **R-05 / P25 — the shell crossfades on page switches.** One call site around `<Outlet/>`, the
   shared `Crossfade`, the kit's one `.crossfade` recipe, its one `FADE_MS` and its one
   reduced-motion rule; **no new timing value**. The token is the PAGE SEGMENT — `knowledge/{slug}`
   and `channels/{id}` are one page picking a record, and those pages already fade that pick.
   ⚠ **AND IT IS NOT A CROSS-DISSOLVE, WHICH IS RECORDED RATHER THAN GLOSSED.** react-router has
   already swapped `<Outlet/>` by the time the token moves, so the render function cannot select
   the OUTGOING page the way /home's pane does: the token says WHEN to fade, not WHAT to hold, and
   the swap reads as a dip and return rather than one view dissolving into the next. Holding the
   outgoing route tree is not something a layout route can do from inside; **if Samuel wants a true
   cross-dissolve on routes, that is a different mechanism and his word.**

🐛 **THE REVIEW FIXED ONE REAL BUG, AND IT IS THE ONE R-01(a) CREATED MORE OF.** The navigate is an
EFFECT, so the render that computes the destination still renders `<Outlet/>` — measured with a
mount log: `/{segment}/members` MOUNTED, ran its own reads and 403'd them, for one tick, on every
cold load for every container member. That is the *"fully painted chrome around a stack of
`PageError` cards"* the original ASK-2 ruling exists to kill, and widening the gate from one guest
to every member multiplied it. The shell now holds `ShellChromeSkeleton` over the whole window, off
ONE derivation (`awaitingRedirect`) that the effect and the loading gate both read — a second
spelling of "is this member about to be moved" is exactly what would drift. ⚠ **A PATHNAME
ASSERTION CANNOT SEE IT** (the URL is already the channel by the time a test reads it), so the
witness is a mount log; dropping the ghost is 1 red.
⚠ **AND THE QUERY STRING IS PINNED, NOT INFERRED** — a page's filter state rides the search params,
the R-05 token is cut from `pathname`, and a token cut from the full URL is 1 red.
**COMMENT BUDGET:** the wave's five files lost a NET 24 comment lines in the review (598 → 574,
measured 2026-09-17, and the review added its own fix's comments inside that number) (the redirect
docblock's history moved to this row and to INVARIANTS §4A, where CLAUDE.md doc rule 3 says current
state belongs; the R-05 and R-13 rulings were each stated three times and are now stated once).

🔒 **R-06 — CONFIRMED, NOTHING ADDED.** This wave adds no page skeleton and touches none. Skills,
Chats and Ontology still resolve through `PageLoading`
(`components/skeletons/section-skeleton.tsx`), which renders a SHAPE, so **no PAGE in the workspace
shell shows a text loading line.** ⚠ **DEFERRED WITH SAMUEL'S "SKELETONS LATER":** eight text
`Loading…` lines survive inside sub-panels and menus, none of them page chrome — re-measure with
`grep -rn "Loading[….]" src apps --include="*.tsx" | grep -v "\.test\." | grep -v sr-only`
(**8 @ 2026-09-17**), e.g. `pages/home/ontology-share.tsx › Loading sharing…`,
`features/skills/components/skill-history-panel.tsx`, `features/revisions/components/changelog-list.tsx`.
They are left exactly as written.

🚧 **STILL OPEN IN WAVE 5** (not this branch's scope): P21 the hand-cut pill sweep · P39
`AccountRail` + `AppShellLayout` + `ShellChromeSkeleton` moving down behind the `*Core` idiom · P40
`BarSeries` moving down · U56 one frame ghost · the header GEOMETRY work R-02 left alive.
**Files touched:** ~35.
**Gates:** `frame-skeletons.test.tsx` (the shell ghost byte-shares five box expressions with `app-shell.tsx`; the rail ghost mounts `account-rail.module.css`'s own classes) · `demo-class-coverage.test.tsx` (the landing draws /home's chrome) · `deep-link-target.test.mjs`.
**Risk:** **do the shell LAST of the chrome work** — moving it while five headers are in flight is
the change that breaks everything at once. ⚠ Adding or removing a page is a **four-file** change
(the `NavSection` union, `NAV`, `WORKSPACE_PAGES`, and the hand copy in
`main/deep-link-target.js`). **Rollback:** per-page; each header migration is one file.

---

### ✅ Wave 6 — Section language, paint and dialogs.

🟢 **MERGED TO `master` 2026-09-17** (branch `wave6/palette-flat`, 3 build commits + 1 review commit,
fast-forward, full gate set). **R-38, R-39, R-40 and R-42 are in the tree; the row stays OPEN for
P29, P26 and U8/U9.**

**Goal:** one section language, one dialog kit, one decision about the account palette.

**Items:** P27 flat everywhere + X13 delete `SectionBox`'s consumers · P29 fold `.kbCards` into
`knowledge-v2` · P26 conform the remaining `Todo` input forms to `FormDialog` · P28 **promote the
account palette to the app and delete the six `:global()` fence rules** (R-38 → yes) · U8/U9 the two
type-scale and hardcoded-ink violations.
> ✅ **R-38, R-39, R-40 and R-42 EXECUTED 2026-09-17 on `wave6/palette-flat`** (P28, P27+X13, the two verifications). **P29 (`.kbCards` into `knowledge-v2`), P26 (the `Todo` input forms) and U8/U9 are NOT done** and stay open on this row. ⚠ **THE FIELD KIT WAS DELIBERATELY NOT SWEPT**: `.concave-field` / `.concave-track` still paint search wells, switches and meters on the desktop. R-39 is the SECTION-language question (P27/X13 are its work items), and flattening every input in the app is a redesign nobody ruled — **ask before widening it.**
> ✅ **REVIEWED + MERGED 2026-09-17.** Review fixes: the chats disclosure body kept its `border-t` (the wrapper's hairline sits ABOVE the header button, so dropping the inset's edge ran the body's gray straight into the header strip's) · one directory walker in `template-editor-surface.test.tsx` instead of two · the swapped grounds are asserted by RENDER — `members-v2/flat-sections.test.tsx` (three panes: ground, no concave part, no nested `px-3 py-2` gutter) and `billing-invoices.test.tsx › the invoice history's ground`. Verified rather than assumed: the skin block is byte-identical in both kit copies, `kit.css` declares exactly ONE `--*` so the drift script's concatenation cannot double-count, the FROZEN settings surfaces and the guest lane (`src/app/c/**`, which mounts `StandaloneChannelSurface`, not `ChannelsCore`) are untouched by `git diff master`.

**Rulings: ALL RULED 2026-09-17 — unblocked.** R-38 → **yes (a)**, the fence dissolves **on purpose** ·
**R-39 → flat; remove concave from the desktop app** — the web login page **may keep concave for now**,
so the sweep is desktop-tree-scoped, not repo-wide · R-40 → **keep all three home items** (nothing to
port here) · R-42 → **(a)**, keep the Knowledge audience picker.
🔒 **The settings page is FROZEN (R-10)** — its `SectionBox` consumers and its dialogs are **excluded**
from P27/X13 and P26 until Samuel's overhaul lands.
**Files touched:** ~25.
**Gates:** `template-editor.test.tsx` (the no-concave pin) · `frame-palette.test.ts` · `check-css-token-drift.ts` **plus the new class-set check from Wave 0**.
**Risk:** three of `home.module.css`'s six `:global()` rules select on **Tailwind utility class names
in files /home does not own** and admit they degrade silently. R-38(a) deletes them; R-38(b) keeps
the fence. Either is fine — **dissolving the fence by accident is not.**
**Rollback:** CSS-only; revert the module.

---

### ✅ Wave 7 — Reverse parity: what the home space is missing.

🟢 **MERGED TO `master` 2026-09-17** (branch `wave7/reverse-parity`, 5 build commits + 1 review
commit, rebased onto Wave 3's one-channel projection, fast-forward, full gate set). **R-09 (with
F-725's server half), R-12(a), R-33 and R-49 are in the tree; the row stays OPEN for V4 and V6.**

**Goal:** close the home-side gaps. ⚠ **This wave got much smaller on 2026-09-17, and the orphan
class stays open.**

**Items:** V4 `ConnectedAppsSection` on /home · V6 `MyAccessProvider` on /home (report PROVIDERLESS
distinctly from PENDING — **do not flip `canEdit` closed**) · ✅ V9 **remove + leave** on /home's roster
(R-09 → (b)) — **DONE 2026-09-17**, and **NOT UI-ONLY: F-725.** `removeMember` is `admin`+ and then
denies `isSelf` below owner, so no role a link container holds could leave one; the wave added
`membership-admin.ts › leaveWorkspace` beside it, sharing one `› completeRemoval` tail. The row action
is `person-roster-actions.tsx › PersonRosterRowAction` through the shared body's new
`ChannelInfoExtras.rosterRowAction`; the rule is INVARIANTS §4A · ✅ **R-12(a)** scrub `lastSeenAt` per caller **in the members DTO** — **DONE
2026-09-17**: `workspaces/server/dto.ts › scrubHiddenPresence`, applied by
`› service.ts › listWorkspaceMembers` (one consumer, so the wire is the payload); the
client rule stays as the LAST line. `docs/MEMBERS-AUTHORIZATION.md` §*Not yet enforced
server-side* loses its one row · ✅ 🔴 **DELETE the guidance layer** (R-49) — **DONE 2026-09-17**: `src/features/tour/**`, the
join-request notices core with `GET /api/me/join-requests` + `/ack` and their two service functions,
the connect-agent banner, the welcome popup with `buildBootstrapPrompt`, and every mount in the
desktop shell. The two ack COLUMNS survive as data with no reader; the rule is INVARIANTS §15 and the
absence is pinned in `app-shell.test.tsx`.
> ✅ **REVIEWED + MERGED 2026-09-17.** Review fixes: **Leave was gated at `member`-and-not-`admin`+, which is not the server's shape** — a bound link may grant `viewer` (`home/schema.ts › HomeLinkMintSchema`) and a legacy unbound claim seats its claimer at `admin`, and `leaveWorkspace` refuses neither, so both were trapped in somebody else's container; the gate is `viewer`+ and not the owner, pinned by a new case in `home-roster-membership.test.tsx` · `constants.ts`'s `MCP_SERVER_NAME` went with `buildBootstrapPrompt`, its last reader (INVARIANTS §15, dead code is deleted) · the one dangling comment reference to `connect-agent-banner` (`ontology/hooks/use-ontology.ts`) and the six spec rows that still named the deleted surfaces as live (03 §A12, 04 rows 4/19/21 + §7, 08 R7, this file's V5). Verified rather than assumed: `leaveWorkspace` and `removeMember` share ONE tail (`› completeRemoval`) and there is one confirm dialog, not two · `listWorkspaceMembers` really has one consumer, so the presence scrub IS the wire · `git grep` over src/apps/packages/docs/dopl-desktop-app finds no live reader of a tour / join-notice / connect-banner / welcome symbol, route, query key or storage key.
✅ 🔴 **DROPPED: V1/V3 Chats and Skills.** **R-33 — NO, Skills and Chats stay out of home.**
**CONFIRMED AND PINNED 2026-09-17**: nothing mounts either — `src/features/home/tabs.test.ts` holds
the five-face set AND scans both /home source trees for an import of `@/features/{skills,chats}`
(mutation-verified). It is an ABSENCE test; deleting it deletes the ruling.
⚠ **V2 therefore stays a live orphan class**: `dopl_chats(op="export")` with no container still files
chats nothing lists, and *what the export should do instead is still owed an answer.* Record it, do
not quietly close it.
🔴 **V5 IS A DELETION, NOT A MOUNT.** **R-49 — delete the guidance-banner code now, reimplement later.**
The Tour, the join-request notices, the connect-agent banner and the welcome popup are removed rather
than mounted on /home; a first-run experience is designed fresh when it is wanted. See ledger row 25.
**Rulings: ALL RULED 2026-09-17.** R-33 → no · R-09 → (b) (still needs F-343 from Wave 0) ·
R-49 → delete now · R-12 → (a), with the DTO.
**Files touched:** ~18.
**Gates — this is the wave most likely to break a workspace-only module, so name them (04 §F-3):**
Chats (10): `chats/server/{repository,retention,rls-redteam,service-folders,service-reads,service-reads-resolve,service-writes}.test.ts`, `chats/lib/optimistic-cache.test.ts`, `chats/hooks/use-chat-writes.test.tsx`, `chats/components/detail-pane.test.tsx`, `pages/chats/index.test.tsx`. ⚠ **No `src/app/api/chats/**` route tests exist.**
Skills (9): `skills/schema.test.ts`, `skills/server/{service,service-reads,service-reads-resolve,service-seed,rls-redteam}.test.ts`, `skills/components/{create-skill-dialog,skills-browser-core}.test.*`, `pages/skills/index.test.tsx`, `acknowledge-shared-skill.test.ts`.
MCP: `workspace-arg.test.ts` · `tools/{delete-block,parity,tool-scope-claims,tool-scope-footers}.test.ts` · `tool-budget.test.ts`.
Members/admission (04 §F-2): `activity-visibility.test.ts` · `members-v2/visibility.test.ts` · `write-configs.test.ts` · `optimistic-cache.test.ts` · `teams/server/repository-{resources,tables}.test.ts` (⚠ L225 asserts no `team_resource_access` reference survives) · `pages/members/index.test.tsx` · the guest-floor set (7 files) · `home/server/{service-claim-bound,service-writes-granted-role,guest-claim-f319-closure}.test.ts`.
⚠ **Coverage gap, stated so the wave does not mistake green for safe:** there is **no** `rls-redteam`
suite for `workspace_members`, `workspace_invitations`, `workspace_join_requests`, `teams`,
`team_members` or `workspace_activity_events`, and no route test under
`src/app/api/workspaces/[workspaceSlug]/members/**`.
**Risk — CHANGED BY THE RULINGS.** R-33(no) removes the marketing-hero risk entirely: no sixth /home
face, so `src/features/home/tabs.ts` and the landing's tab strip are untouched. The remaining risk is
R-49's deletion — the four guidance surfaces are **workspace-mounted today**, so deleting them removes
a live workspace affordance, not only an absent home one. **Rollback:** V4/V6/V9 are one mount each;
the R-49 deletion is its own commit.

---

### Wave 8 — Overview parity.
**Worktree `parity/w8-overview`.**

> ✅ **P33 and P34 EXECUTED 2026-09-17 on `wave8/overview-parity`** (branched from `d6030ab3`; the
> worktree name above is the plan’s, not the branch’s). One series vocabulary
> (`src/features/overview-series/windows.ts`), the workspace credits series with a range switcher,
> the three breakdown rails, the live agent board (R-25, peer rows read-only) and a per-member-own
> token-spend panel. **The fence decision R-29 left open is recorded in INVARIANTS §9:**
> `workspace_token_spend` stays per-member-own on every surface — a workspace-wide total is the
> operator fence removed by subtraction, so there is none. 🔒 **/home’s Overview is unchanged
> (R-40)**: the three shared components were EXTRACTED from it, not restyled, and the /home
> suites pass untouched.
> 🔴 **F-652 is NOT done and stays on this row** — the workspace "Needs you" card still reads the
> ACCOUNT-wide endpoint and discards most of it. It was listed as a same-wave item and was not in
> the executed slice.

**Goal:** give a workspace admin the thing they most obviously want and do not have — credits by
channel, person and tool.

**Items:** P33 the series first (one `metric` × `range` vocabulary, two fences) · P34 the rails,
fenced to one container · resolve **F-652** ("Needs you" reads the ACCOUNT endpoint and discards
most of it) in the same wave. ⚠ U6 (the overview-face shadow hook) LEFT THIS WAVE 2026-09-17 — it was resolved by deletion, not by adoption.
**Rulings: RULED 2026-09-17 — unblocked.** R-29 → **(b)**: one set of Overview sections,
host-selected, **the SERIES first** — and **not (c)** for the payload. The two privacy halves stand
as written: `workspace_token_spend` stays fenced per OPERATOR, `HomeAgentRow` still carries no
`model` / `toolLabel` / `tokensSpent`, and **the meters must not mix**.
**Files touched:** ~20.
**Gates (04 §F-4 — this wave touches credits):** all 30 `src/features/billing/**` tests, specifically `credits-service.test.ts` · `credits-link-reroute.test.ts` · `personal-wallet.test.ts` · `credits-channel-attribution.test.ts` (rule B's forgeable-header fence) · `credits-unmetered.test.ts` (the fail-open posture) · `seats.test.ts` · `webhook-plan.test.ts` · `api/mcp/credits/consume/route{,-guest-floor}.test.ts` · `pages/home/overview-credit-bar.test.tsx` + `overview-unmetered-caption.test.tsx`.
**Risk — two, both silent.** (1) **The meters must not mix**: a `seat` row is on no /home figure, and
summing across wallets was the exact 2026-09-12 bug. (2) `20260930120000_credit_wallets.sql` says
both failure modes of deploying the server ahead of it are **silent** — a missing `consume_*` makes
every tool call free and unmetered, and a swallowed `42703` empties the credit rails quietly.
**A parity wave must not be the thing that discovers this.** **Rollback:** the rails are additive panels.

---

### Deferred — each its own project
**R-03 the workspace picker's OWN design** (ruled 2026-09-17: do not port /home's) · **R-06 the three
page skeletons** ("later", not never) · **R-32's container addressing beyond Wave 3** (the typed KIND
field on every MCP row, `dopl_map`'s "Home space" node) · **R-33's open half — what
`dopl_chats(op="export")` should do with no container** (V2 is still an orphan class) · **R-49's
reimplementation** of a first-run experience · the workspace-wide search panel that now answers R-04
(`ui/search-panel` is a separate branch, not in this tree) · the notch bar (`ui/notch-bar`, likewise) ·
moving the five /home faces down (≈2,200 lines, only if the web ever renders /home again) · extending
`revisions` to skills and chats · **R-30(a)** — write the personal-shelf boundary into INVARIANTS §4A
as a rule (a ruling, not an edit).
🔴 **NO LONGER DEFERRED — R-47: leave the playground.** It does **not** retire with the site; ledger
row 21 is vetoed.
**Ruled here and owed a home outside the nine waves:** **R-14** (creator-only channel delete, blocked
while others are members; a rate limit on the public claim surface; no mint quota; a claim reveals
NAMES only) · **R-15** (the MCP container lock arms for any container with 2+ members) ·
**R-31** (the audience-change preview fires for any container with a second audience) ·
**R-34** (the home space is auto-created, permanent, and never created or deleted via MCP) ·
**R-37** (a folder-scoped knowledge attachment NARROWS an agent's reach) · **R-11** (keep the member
Activity tab) · **R-50** (leave the pre-2026-08-24 containers display-only).

---

## 6. Deletions ledger

Everything the roadmap proposes deleting, so any line can be vetoed.
**✅ Vetoes and additions recorded 2026-09-17** — one line vetoed (21), one narrowed (16), one
re-scoped (22), and three rows added (23, 24, 25). A row marked **RULED** is confirmed by Samuel, not
merely recommended.

| # | What | What makes it safe | Wave |
|---|---|---|---|
| 1 | `info-tab.tsx:229-244` "Linked threads" + `HARDCODED_LINKED_THREADS` | hardcoded at its render site since 2026-08-18, no `onClick`, no read behind it; INVARIANTS §5 dead-control rule. **R-45** <span style="color:#c00">**⚠ TOUCHES DO-NOT-TOUCH**</span> (`src/features/channels/**`, 04 §F-5) | 1 |
| 2 | The two inert `IconButton`s in the WS Members heading (`info-tab.tsx:271-272`) | Samuel 2026-08-25 deliberately did **not** copy them to /home: *"a port is not a transcription."* **R-46** <span style="color:#c00">**⚠ TOUCHES DO-NOT-TOUCH**</span> (`src/features/channels/**`, 04 §F-5) | 1 |
| 3 | `info-tab.tsx:224-226` Threads-count row | the tab row already badges Threads (`info-panel-tabs.ts:75`); minimal-copy ruling. **R-22** <span style="color:#c00">**⚠ TOUCHES DO-NOT-TOUCH**</span> (`src/features/channels/**`, 04 §F-5) | 1 |
| 4 | `person-info-tab.tsx` (395 lines) | absorbed by the one shared body; the fork is the bug INVARIANTS:151 names | 1 |
| 5 | `person-thread-activity.tsx` (63 lines) | F-316 closed the data gap 2026-09-05; this is composition residue over the same query key | 1 |
| 6 | `fixtures.ts › HARDCODED_THREAD_ACTIVITY` + 2 stale comments | no production reader, measured 2026-09-17. ⚠ **Re-derive before deleting — and the precedent is now a warning, not a licence:** `bits.tsx › agentAccent` (F-711) was called an orphan and **still has a live call site** at `attribution-pill.tsx:313` (V17b) <span style="color:#c00">**⚠ TOUCHES DO-NOT-TOUCH**</span> (`src/features/channels/**`, 04 §F-5) | 1 |
| 7 | `knowledge-tab.tsx`, `capabilities.knowledge`, the fifth-tab width branch, `channelPaneTabs`'s `knowledge` arm | **no host has passed it since 2026-09-04**; F-666 says re-adding needs Samuel's word. **R-18.** 04 §F-5 allows `capabilities` explicitly; the other three files are not covered by that carve-out <span style="color:#c00">**⚠ TOUCHES DO-NOT-TOUCH**</span> (`src/features/channels/**`, 04 §F-5) | 1 |
| 8 | `channels-skeleton.tsx`'s two-pane ghost | self-described *"a rough fit"*; replaced by the real shape; F-220 | 1 |
| 9 | `overlays.tsx`'s second `ChannelsAgentPanel` wiring (**12 props at the call site**; 9 of `ChannelsOverlays`'s own 19 go with it — recounted 2026-09-17, the doc said 14) | `SurfaceAgentView` exists exactly to prevent it, and the drift it predicted has already happened (the colour prop) <span style="color:#c00">**⚠ TOUCHES DO-NOT-TOUCH**</span> (`src/features/channels/**`, 04 §F-5) | 1 |
| 10 | `src/shared/layout/app-shell/app-panel.tsx` | zero call sites; delete-don't-disarm | 0 |
| 11 | `channels/components/bits.tsx › TAB_ACTION` as an independent declaration | the tree-boundary workaround it records no longer applies since the 2026-09-17 move (`ontology-view.tsx:9-15`); `TAB_ACTION` composes `PAGE_ACTION_BTN` rather than disappearing <span style="color:#c00">**⚠ TOUCHES DO-NOT-TOUCH**</span> (`src/features/channels/**`, 04 §F-5) | 0 |
| 12 | The duplicate full-screen error wrapper and the duplicate level-2 card declaration | byte-identical / same tokens, two spellings | 0 |
| 13 | ✅ ~~`use-home-channel-sync.ts` (113 lines) + `use-home-unread-refresh.ts`~~ — **DONE 2026-09-17 (Wave 3)**, with the second cache they bridged | 3 |
| 14 | `home.module.css › .kbCards` / `.kbCell` (50 lines) | a fourth rebind of `--kv-*`; the grid becomes a variant of the card's own | 6 |
| 15 | `SectionBox`'s remaining consumers **in the DESKTOP app** | Samuel 2026-09-13 on the extra border line; one section language. ✅ **RULED (R-39): flat; remove concave from the desktop app — the WEB LOGIN PAGE may keep concave for now**, so this is not a repo-wide sweep. 🔒 **The settings page's consumers are EXCLUDED — it is FROZEN (R-10)** | 6 |
| 16 | ~~Five page-header recipes~~; the Knowledge hero band + its marketing paragraph | 🔴 **NARROWED 2026-09-17. R-02 — KEEP the workspace sidebar and the page titles**: the /home strip vs the workspace sidebar is an **intentional difference**, so the five titles are **not** deleted and the header work is geometry only. ⚠ **The hero band was the one deletion that needed Samuel's word and R-02 did not grant it** — it is NOT deleted on this row's authority; raise it separately if it is still wanted | 5 |
| 17 | ✅ ~~`channel_personal_arming` table + its 3 live policies~~ — **DONE 2026-09-17 (Wave 3, R-48).** Migration `20261012120000_drop_channel_personal_arming.sql` is WRITTEN, NOT APPLIED; the last TS references are gone. ⚠ Deploy state is a MEASUREMENT (§12) — `supabase migration list`, joined on the NAME | 3 |
| 18 | `knowledge_bases.home_scoped` / `agent_templates.home_scoped` | nothing reads them; the shelf is a tenancy now. ⚠ **HELD**: the drop is in `migrations-held/` behind two `count(*) = 0` checks, its `DO $$` aborts a `db push` batch part-way, **and the column is the rollback path — once dropped the deploy is one-way** | after 3, on measurement |
| 19 | SDK `listKbBases(opts:{shelf?})` param; SDK `getHomeChannels` binding | no MCP call site passes / calls either. ⚠ `getHomeChannels` is **re-ask**, not a clear delete — an account-wide agent read may want it | 3 |
| 20 | `mcp_tokens.workspace_lock_kind` | superseded by the credential axes; retires in B13 | deferred |
| 21 | ~~`src/features/playground/**`~~ | 🔴 **VETOED 2026-09-17. R-47 — leave the playground.** It does not retire with the site. The 18 files, the unauthenticated provisioning route, the reaper cron and the 3 static mirror panes all stay; ⚠ the panes remain static mirrors of surfaces this refactor changes, so they will drift — that is now an accepted cost, not a plan | — |
| 22 | `HomeChannel.lastMessagePreview` | ⚠ **STILL OPEN after 2026-09-17.** R-28 ruled the **mention badge** in — *"mention badges YES on workspace rows (needs the count)"* — which commits Wave 3 to building the COUNT, and says nothing about the preview. **This row is not decided by R-28 and must not be read as decided**: either render it on the workspace row or delete the field | 3 or 4 |
| 23 | 🔴 **THE ARCHIVE FEATURE, ENTIRELY, ON BOTH SURFACES** — the archive control, the lifecycle write, the Archived filter, the Status row that was never built, and every reader of the archived flag | ✅ **RULED (R-21): "a user can delete a channel; no point in archives."** This REPLACES R-21's recommended (a) (add a Status row) and is larger than the info body — it reaches the channel service and the list filters. ⚠ **Scope it before opening Wave 1's worktree**; re-derive every reader of the flag rather than trusting this row <span style="color:#c00">**⚠ TOUCHES DO-NOT-TOUCH**</span> (`src/features/channels/**`, 04 §F-5) | 1 |
| 24 | ✅ ~~**Any code that mints a DEFAULT STANDARD WORKSPACE at signup**~~ — **MEASURED 2026-09-17: THE SET IS EMPTY.** Both signup-path sites call `ensurePersonalContainer`; `createWorkspaceForUser` is explicit-create only. The row is discharged by measurement, not by a deletion | ✅ **RULED (R-35): every user gets exactly a home space; no default standard workspace.** ⚠ **AND THE EXECUTION IS THE OTHER HALF OF THE RULING — PERMANENCE** (INVARIANTS §4A): the container cannot be deleted or left by its owner, at the service layer and in `20261009120000_personal_container_permanent.sql`. ⚠ `default_workspace_of` is a **marked-retired hold point** (see below) — retiring the minting path is not licence to drop the object in the same wave | 0 |
| 25 | 🔴 **The guidance layer: `TourProviderCore`, `JoinRequestNoticesCore`, `ConnectAgentBanner`, `WelcomePopup`** | ✅ **DONE 2026-09-17 (wave 7).** Ruled (R-49): delete the guidance-banner code NOW, reimplement later. This reverses the wave's direction — they were to be MOUNTED on /home; they are removed instead. ⚠ **All four are live on the WORKSPACE today**, so this deletes a shipped workspace affordance, not an absent home one. The Tour's steps are keyed to `NavSection`, which goes with it | 7 |

⚠ **On the red flags above.** 04 §F-5 lists `src/features/channels/**` (302 files) among the modules
to *"leave alone entirely in a parity wave"*, with one carve-out: *"touch only `capabilities`"*.
**Wave 1 is a channels-tree wave from end to end**, so **eight** ledger lines cross that fence on
purpose (row 23, the archive removal, joined them on 2026-09-17 — and it is the widest of the eight). That is a decision, not an oversight — but it is yours to make, and it was not stated
anywhere in the first draft. Either (a) you accept that the channels tree is the subject of this
uplift and 04 §F-5's entry is narrowed to *"do not touch it for any other reason"*, or (b) Wave 1
shrinks to the `capabilities` flag and the rest waits. **Recommend (a)**, said out loud.

**Not deleted, recorded so a wave does not "restore" them:** the settings members pane (ASK-1) ·
`variant="tab"` wells · the per-device `localStorage` pin · the `Agent · <id>` chip · the flat agent
row · `.selected-ring` · inbound consent · the session window · `channel_pings` · the LLM triage
tier · per-message desktop notifications · "Waiting on you" and "Recent threads" on /home Overview ·
the channel-scoped overview panel. And **do not delete an absence test** — several rulings are
enforced as *"this control does not exist"* assertions (04 §F-5a).
**Added to that list 2026-09-17:** the workspace **page titles** and the workspace **sidebar** (R-02 —
an intentional difference) · the **per-page search filter** that was never built (R-04 — the search
popup is the one surface) · **Skills and Chats on /home** (R-33 — they stay out) · the **pre-2026-08-24
display-only Info card** (R-50 — leave it) · the **three /home design asymmetries** (R-40 — keep all
three; a home-only choice needs no recorded reason).

**Not deleted because they are marked-retired hold points:** `workspace_credit_usage`,
`consume_workspace_credits`, `default_workspace_of`. Deleting a marked-retired object early is how a
wave acquires a migration it did not plan.

---

## 7. Open questions the research could not settle

**Measurement gaps.**
1. **Deploy state is unmeasured.** No database was contacted (correct, per INVARIANTS §12). Two team
   migrations say *"WRITTEN, NOT APPLIED"*; `drop_home_scoped` is in `migrations-held/`; whether
   `workspace_kind_personal`, the ontology home-shares pair and `credit_wallets` are applied is
   unknown. `npx supabase migration list --linked`, **joined on the NAME**, is the only answer —
   `20260823150000` applied as `20260823205007` (F-304).
2. **Nothing was run.** No build, no lint, no gate. F-688's "root lint is red" is read from the
   finding; R-41's "the class layer is ungated" is read from the script's source.
3. **Does a /home pop-out or agent window actually open?** The chain applies a `viewer` floor, so a
   **guest-role peer may fail**. This is a measurement (R-23), not a ruling, and it gates whether we
   keep the control.
4. **No test-pin inventory.** The 47 `*.test.tsx` files in the shared channels tree were not read,
   so which pins each wave breaks is unknown — and those pins are what a migration wave actually
   fights. Wave 1 in particular breaks `person-info-tab*.test.tsx` (6 files) and
   `surface-slot-fixtures.tsx`, and **nobody has counted the assertions that move**.
5. **No screenshots, by standing rule.** Every visual claim in §3 is a reading of classes and tokens.
   A live review could disagree with any CSS row.
6. **The two Overviews were compared structurally, not visually.** Whether they are "the same page
   twice" or two genuinely different reports is a product question (R-29), not a measurement.

**Unreachable sources.**
7. **Chat history.** Several rulings were made in a Dopl channel and never written into a doc, a
   commit body or the KB — `dopl_search` cannot reach the chat archive. **That is the most likely
   source of a missing row in List 4.**
8. **The KB base "Dopl MCP Improvement Spec"** was unreachable to the archive researcher; 07 is a
   verbatim snapshot of its "Tech Debt and Tabled Items" entry taken separately. A cross-scope search
   was truncated at the 6-scope cap with 8 scopes unsearched — there may be more.
9. **`docs/ENGINEERING.md` (~6,700 lines) was sampled by targeted grep**, never read whole (CLAUDE.md
   forbids loading it wholesale). §A of 06 is dense but not provably exhaustive.
10. **31 of the 36 drift-ledger ASKs are reported open because the document says so**, not because
    each was re-verified (R-43). And §C.4's live defects were captured against `v1.22.0`, **eighteen
    days and ~760 commits stale** — re-measure before scheduling any of them.

**Where two research docs disagree, and which reading this document takes.**
- **How many hosts?** 01 §0 counts four (WS, HOME, GUEST, POP) from a mount-chain census plus a grep
  over 18 non-test files; 02 §0 says "three hosts of the channel surface" and treats the pop-out as a
  satellite; 03 §0 counts three hosts of *product UI* and calls the landing demo the third.
  **This document takes 01's census** — it is the only one that enumerated mount chains — and adds
  DEMO as a fourth, read-only host because 03 §D.1 and 04 §D-6 both show it forcing code into `src/`.
- **Is the home↔workspace CSS difference really "CSS-only"?** 02 §D marks the pane and card
  differences CSS-only while its own gap 3 admits `home.module.css` was **not** read rule by rule;
  01 §D cites the module's line ranges and states the attribute-hook fence. **01's reading wins**,
  and it is why R-38 exists rather than a sweep.
- **What comes first, the Overview panels or the series?** 02 §R-6 recommends deferring the Overview
  entirely; 04 §E-5 recommends porting the rails; 05 §F R2 recommends **the series first, the panels
  after the privacy half is ruled.** **This document takes 05's** — it is the only one that read both
  payloads and both fences — and keeps 04's hard "do not restore the two cut cards".
- **Internal inconsistency in 01:** its §A heading says "64 rows" and its own count line and row
  numbering say **74**. The numbering wins.
- **The charter itself is contested (06 §D.1):** *"the workspace pages adopt /home's frame model and
  palette — the two surfaces must match"* (2026-08-30) is quoted as if it mandated every /home
  affordance, but at least six later rulings are deliberately one-surface and three of those carry
  **no recorded reason**. This document reads the charter as **frame + palette**, which did converge,
  and routes the three unreasoned asymmetries to R-40 rather than assuming them.

**Confidence.** The inventory rows, the host census, the capability/slot table, the duplicate list
and the cross-feature import graph are **high confidence** — each was read on both sides and most
were grepped to a definition. The **line counts** are `wc -l` at `03506fcd` with stated exclusions.
The **sizes in List 1 and the file counts in §5 are estimates**, not measurements. The
`ContainerCapabilities` shape in §4.1 is a **proposal derived from the questions the code asks
today**; a seventh field may surface when someone writes it. Nothing in this document is a decision:
where code and a ruling disagree the code wins, and the disagreement is recorded rather than settled
(CLAUDE.md § *Precedence*).

---

## Appendix — the seven research documents

| Doc | One line |
|---|---|
| `01-channel-surface.md` (513) | The channel record surface: 74 feature rows, 17 capability/slot knobs, 4 duplicated bodies, 23 UI rows, 10 rulings — and the finding that there is no web workspace channel page. |
| `02-threads-artifacts-agents.md` (517) | Threads, Artifacts, Agents, templates and the launch flow: 79 rows across 9 tables; almost everything is already one implementation, and the gap is one capability, four hand-wirings and two duplicated bodies. |
| `03-pages-and-ui.md` (510) | Page composition and the UI system: the page map, 26 recipe rows, the shared-tree readiness ledger (≈1,600 lines to move down), 12 rulings, and the six-wave chrome sequence. |
| `04-workspace-only-modules.md` (964) | The 28 workspace-only modules and the reverse map: three container kinds, the two auth shapes, what is obsolete, the dependency graph, 12 rulings, and the per-wave "do not break" test lists. |
| `05-server-api-data.md` (783) | The substrate: 50 fork rows across containers, routes, projections, caches, RLS, credits, MCP and realtime; the duplicate-cache inventory; the container-kind adapter; 8 rulings. |
| `06-rulings-archive.md` (709) | The decision archive: every ruling bearing on either surface, what is tabled and whether this uplift trips it, the open findings, twelve contradictions, 18 questions, and 25 distilled principles. |
| `07-kb-tech-debt-snapshot.md` (23) | A verbatim snapshot of the Dopl KB entry "Tech Debt and Tabled Items", copied because the archive researcher could not reach that base. |


---

## Appendix — Review log (2026-09-17)

A second pass over this document against its seven inputs and the worktree at `d86e916a`. Docs only;
no source file was changed. Every claim below was re-measured, not remembered.

**1. Coverage — 68 §E items and 20 `RULING` action rows checked; 1 was missing.**
01 §E (10) · 02 §E (8) · 03 §E (12) · 04 §E (12) · 05 §F (8) · 06 §E (18) = 68, each traced to a
List-4 ruling or a List-1/2/3 row. `RULING`-actioned inventory rows: 01 §A (8) · 02 (5) · 03 (3) ·
04 (4) = 20, all traced.
**Added: R-50** (06 §E12, the pre-2026-08-24 `is_direct = true` containers whose Info card is
display-only). Nothing else was missing.
Not promoted to an R-id, recorded here instead: 06 §D.11 (guest-web R4's blast radius was measured
against a cap retired the next day — it asks for a re-measurement, not a ruling) and 05 §F-note 3
(the third overview-series cache entry, already absorbed by P33).

**2. Dedup — 1 merge.** **R-44 → R-39.** R-44 asked you to confirm the /home Agents-face defaults
Q1–Q6; its only parity half was Q4, which is R-39 word for word. Lower id kept, merge noted in both
places, R-44's id left standing as a pointer. Net ids 50, net live rulings 49.

**3. Evidence — 31 citations opened; 6 rows corrected, 1 marked UNVERIFIED.**
Held on opening: P1, P3, P6, P8, P11, P19, P21, P22, P23, P24, P30, P32, P37, K1, K30, K31, X1, X2,
X3, X9, X10/X11, X21, X33, R-01, R-02, V6 (24).
Corrected: **P2** (the second agent-pane wiring forwards **12** props, not 14; 9 of
`ChannelsOverlays`'s 19 disappear) · **P13** (`sidebar-rows.tsx:27-31` is the re-export docblock; the
"no unread badge" rule is `:69-73`) · **P26** (**8** `Todo` input forms in DESIGN-SYSTEM, not 9 — the
row already listed 8 by name) · **P34 / R-29** (the workspace Overview is **not** spend-free:
`pages/overview/index.tsx:94` + `:131` render a "Credits used" period figure; 02 §A.8 C-2's
`grep … → 0` was wrong and is corrected in 02 as well) · **R-08** (the three kind-gated sites are
`factory.ts:186-191`, `confirm-token.ts:181-188` and `shared-publish.ts:123`; a fourth spelling,
`tool-profile-resolve.ts › isSharedChannel`, is **already kind-blind**) · **V17** (split into
V17/V17b/V17c).
Marked **UNVERIFIED**: **V17b** — F-711 says `bits.tsx › agentAccent` has no call site left; at HEAD
`attribution-pill.tsx:50` imports it and `:313` calls it. Code wins; do not delete it, and stop
using it as the "measure once, then delete" precedent. **V17c**: `.selected-ring` is already deleted
and its absence is pinned by three tests, so it is not an orphan to delete either.

**4. Safety — 7 deletion lines flagged.** 04 §F-5 lists `src/features/channels/**` among the modules
to leave alone in a parity wave, carve-out *"touch only `capabilities`"*. Ledger rows **1, 2, 3, 6,
7, 9, 11** are inside that tree and now carry **⚠ TOUCHES DO-NOT-TOUCH** in red, with one note under
the table asking you to narrow 04 §F-5 out loud rather than crossing it silently. No line was
removed: every one of the 22 still cites a ruling or a measurement.

**5. Sequencing — 5 fixes.** (a) **P33 removed from Wave 3** — it depends on R-29, which is Wave 8's
ruling, and Wave 8 already lists P33 first. (b) **R-08's ⛔ moved from Wave 1 to Wave 0** (see 7).
(c) **R-43's ASK-9 arm added to Wave 0's rulings** — ASK-9 owns the shared-skeleton promotion, which
is Wave 1's item 6. (d) **R-23's measurement added to Wave 0** as a row, since it is a one-run
measurement that decides whether Wave 2 keeps a control. (e) **R-48 added to Wave 3's rulings** — the
ledger already scheduled the `channel_personal_arming` drop there with no ruling listed.
Wave 0 still carries all five named blockers: F-688, F-343, F-513, F-712, the slot-replacing-host
audit.

**6. Readability — 28 rulings tightened, none rewritten.** 26 gained the missing *"Blocks:"* line;
9 gained explicit options (R-05, R-14, R-31, R-32, R-35, R-37, R-41, R-42, R-48). Every live ruling
now carries a one-line question, options, a recommendation and a *Blocks:* line. No prose was added
outside §0, §1, §2.4, §5, §6's flags and this appendix.

**7. The wave-1 blocker set — 8 became 7.** R-18, R-19, R-20, R-21, R-22, R-45 and R-46 each change
the one info body or the tab set Wave 1 builds, so each is a real blocker. **R-08 is not**: nothing
in Wave 1 asks whether a room is shared — it blocks **Wave 0**, where the predicate is executed, and
is still the first thing to rule on.

**Checked and left alone:** the 63 §3 UI rows, §4's target structure, the move-down ledger's line
counts, and §7's open questions. Two internal inconsistencies in the inputs are noted rather than
edited: 01 §A's heading says "64 rows" over 74 (§7 already records it), and 01 §A's action tally says
`RULING` 9 over 8 actual rows.
