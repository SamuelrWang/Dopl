# Workspace parity — 01. THE CHANNEL RECORD SURFACE

**Measured 2026-09-17**, worktree `/Users/samuelwang/Downloads/sie-parity`, branch
`docs/workspace-parity` at `master 03506fcd`. **Read-only survey — no source file was
touched.**

⚠ **LINE NUMBERS ARE A MEASUREMENT AT THAT SHA, NOT A DOC-STANDARD REFERENCE.** The repo's
own rule (CLAUDE.md › "Standing rules for writing docs", rule 2) is `path › symbol`; this
document was commissioned with `file:line` on every row, so each cell carries **both** —
the anchor is authoritative, the number is the reader's shortcut and will rot.

---

## 0. THE HOSTS, AND THE ONE THE BRIEF ASSUMED THAT DOES NOT EXIST

| # | Host | Entry | Mount chain | Layout |
|---|---|---|---|---|
| **WS** | Desktop **workspace** channels page | `apps/desktop-ui/src/pages/channels/index.tsx:83 › ChannelsPage` | → `src/features/channels/components/channels-core.tsx:218 › ChannelsCore` → `ChannelSurface` | 3 columns: tree · transcript · info |
| **HOME** | Desktop **/home** record pane | `apps/desktop-ui/src/pages/home/home-panes.tsx:214 › HomePane` | → `pages/home/relationship-record.tsx:73 › RelationshipRecord` → `channel-surface-standalone.tsx:136 › StandaloneChannelSurface` → `ChannelSurface` | 2 columns inside a `.frame` card |
| **GUEST** | Web `/c/{containerId}` | `src/app/c/[workspaceId]/page.tsx:61 › GuestChannelPage` | → `src/app/c/[workspaceId]/guest-channel.tsx:140 › GuestChannel` → `StandaloneChannelSurface` **+ `webView`** | 1 column, faces behind a header dropdown |
| **POP** | Pop-out thread window (partial host) | `apps/desktop-ui/src/pages/thread-window/index.tsx:39 › ThreadWindowPage` | → `src/features/channels/components/thread-window.tsx` → `ChannelsMessagePane` `chrome="window"` | transcript + composer only; no info column |

🔒 **THERE IS NO WEB WORKSPACE CHANNEL PAGE, AND THIS IS THE FIRST THING THE PARITY PLAN HAS
TO ABSORB.** `find src/app -name page.tsx` returns 21 routes and **not one of them is
workspace-scoped**: `(auth)`, `admin`, `auth`, `billing/[segment]`, `c/[workspaceId]`,
`invite`, `join`, `link`, `oauth`, `playground`, `pricing`, `privacy`, `terms`, `page.tsx`
(marketing). `src/shared/layout/layout-shell.tsx:16 › NON_WORKSPACE_ROOTS` still carries the
workspace-detection branch (`:54`), but no `page.tsx` reaches it. **The "web workspace
channel page" named in the brief was retired with the website** (memory: *Dopl
desktop-only direction*). Re-derive rather than trusting this: `find src/app -name
'page.tsx' | sort`.

**Consequence for the whole parity wave:** the parity question in this area is
**WS (desktop workspace) vs HOME (desktop /home)**, with **GUEST** as a third, genuinely
different-in-kind lane (one column, no agent of its own, no self-management), and **POP** as
a deliberate subset. Any target contract must serve four hosts, but only three of them are
"a whole channel".

### Host shorthand used below
`WS` · `HOME` · `GUEST` · `POP`. "Both" without qualification means WS + HOME.

---

## A. FEATURE INVENTORY — 64 rows

Classification ∈ {`shared-already`, `shared-but-gated-off-for-workspace`,
`duplicated-should-collapse`, `host-specific-in-kind`, `workspace-only`, `home-only`}
Action ∈ {`port`, `keep`, `remove`, `change`, `RULING`}

### A1. Mount, data and the live loop (rows 1–11)

| # | Feature | HOME behaviour (file:line) | WS behaviour (file:line) | Class | Action | Notes |
|---|---|---|---|---|---|---|
| 1 | The ONE refetch coordinator + every read | `channel-surface-standalone.tsx:99 › useChannelSurfaceData` | `channels-core.tsx:170 › useChannelSurfaceData` | shared-already | keep | INVARIANTS §7 — "no third code path for the live loop" (`channel-surface-standalone.tsx:14`). GUEST rides HOME's host. |
| 2 | Selection state (thread, info, agent, scroll, nonces) | `channel-surface-standalone.tsx:95 › useChannelsSelection` | `channels-core.tsx:142 › useChannelsSelection` | shared-already | keep | WS additionally moves `selectedId`, `createOpen`, `directOpen`; HOME pins the channel (`:96`). |
| 3 | Surface body | `channel-surface.tsx:476-496` (fragment) | same file, same lines | shared-already | keep | `ChannelSurface` is a FRAGMENT, not a wrapper (`channel-surface.tsx:10`) — composing it changed no DOM. |
| 4 | Agent view mount + wiring | `channel-surface-standalone.tsx:152 › SurfaceAgentView` → `surface-agent-view.tsx:44 › ChannelsAgentPanel` | `channels-core.tsx:241 › ChannelsOverlays` → `overlays.tsx:73 › ChannelsAgentPanel` | duplicated-should-collapse | change | **TWO hand-wirings of one panel.** See §C1. |
| 5 | Agent pane **banner colour** | `surface-agent-view.tsx:54-58 › color={data.liveAgents.find(…)?.color}` | `overlays.tsx:73-86` — **`color` never passed**; falls to `agent-panel.tsx:179 › color = null` | shared-but-gated-off-for-workspace | port | Pure regression on WS: the pane and its stream (`agent-panel.tsx:354 › AgentStream color`) render uncoloured for a colour the server already assigned. Root cause is row 4. |
| 6 | Create channel / DM dialogs | absent — `relationship-record.tsx` mounts none | `channels-core.tsx:241-267 › ChannelsOverlays` → `channel-manage.tsx › ChannelsCreateDialogs` | workspace-only | keep | HOME's create is `pages/home/new-channel-dialog.tsx`, a different act (mints a link container). Different in kind. |
| 7 | First-run explainer | absent | `channels-core.tsx:233 › ChannelsOnboardingCore` | workspace-only | keep | The only consumer of the `Link` prop (`channels-core.tsx:29-32`). |
| 8 | Channel tree beside the surface | `pages/home/relationship-list.tsx:125 › WellsColumn` (Pinned/Recent/Earlier) | `channels-core.tsx:200 › ChannelsSidebar` (`sidebar.tsx`) | host-specific-in-kind | keep + see rows 62–64 | Two lists in kind (account rows vs workspace tree); the SIGNALS on them are not (rows 62–64). |
| 9 | Loading ghost for the pinned/selected channel | `relationship-record.tsx:56 › ChannelRecordSkeleton` — real two-column shape, tab count by import (`channel-record-skeleton.tsx:4,61`) | `pages/channels/index.tsx:79 › ChannelsSkeleton` — mirrors `.page-float` list+detail (`channels-skeleton.tsx:8-12`, self-described *"a rough fit"*) | host-specific-in-kind | change | **GUEST is the outlier**: `guest-channel.tsx:115-117` still renders the KIT's generic `DetailPaneSkeleton` + `TranscriptSkeleton` — exactly the defect Samuel ruled out on HOME 2026-09-13 (`relationship-record.tsx:49-55`). |
| 10 | "This channel is gone" ending | `relationship-record.tsx:63 › EmptyState "This channel is no longer available"` | `channels-core.tsx:152-157` — falls back to the first row; never an ending | host-specific-in-kind | keep | A pinned host has nowhere to fall back to (`channel-surface-standalone.tsx:74-79`). GUEST: `guest-channel.tsx:174 › ChannelGone`, deliberately navigation-free (`:169-173`). |
| 11 | Frame paint over the shared surface | `pages/home/index.tsx:284-285` — `border-2 border-home-panel-line bg-home-card` + `home.frame` | `channels-core.tsx:199` — `.page-float` | home-only | keep (CSS) | `home.module.css:33-54` states why it is a scoped module and not a kit recipe. Details in §D. |

### A2. Capability / slot plumbing (rows 12–19)

| # | Feature | HOME behaviour (file:line) | WS behaviour (file:line) | Class | Action | Notes |
|---|---|---|---|---|---|---|
| 12 | `capabilities.memberManagement` | `relationship-record.tsx:141 › false` | not passed → `channel-manage.tsx:117 › true` | host-specific-in-kind | keep | Kills **Add members** AND **Delete channel** (`settings-tab.tsx:138,152-153`). Reason is §4A `LINK_CONTAINER_CLOSED`, not headcount (`relationship-record.tsx:105-110`). |
| 13 | `capabilities.selfManagement` | not passed → `true` | not passed → `true` | host-specific-in-kind | keep | GUEST-only `false` (`guest-channel.tsx:160`); ruling R2/R3 2026-08-25 (`channel-surface.tsx:139-147`). |
| 14 | `capabilities.peerNamedHeader` | `relationship-record.tsx:142 › false` | not passed → `true` | home-only | keep | Samuel 2026-09-01. Pins the header to `channel.name` (`channel-surface.tsx:244-247`). |
| 15 | `capabilities.knowledge` | **not passed** (`relationship-record.tsx:111-124`, F-340) | **not passed** (`channel-surface.tsx:162-166`) | ⚠ **dead capability** | RULING | GUEST stopped passing it 2026-09-04 (`guest-channel.tsx:150-157`). **NO host passes it today** → `knowledge-tab.tsx`, the fifth-tab width branch (`info-panel.tsx:421-435`) and `channelPaneTabs`'s `knowledge` arm (`info-panel-tabs.ts:44-52`) are unreachable product. See §E-4. |
| 16 | `capabilities.artifacts` | `relationship-record.tsx:143 › true` | not passed → `false` | home-only | RULING | Samuel 2026-09-16 under the standing home-space ruling (`channel-surface.tsx:169-185`). **"home-first, workspace later" by its own wording** — see §B and §E-1. |
| 17 | `slots.infoTab` | `relationship-record.tsx:95 › PersonInfoTab` | not passed → `info-panel.tsx:319 › InfoTab` | duplicated-should-collapse | change | See §C2 — the single largest fork in this area. |
| 18 | `ChannelInfoTabContext` payload | receives `{gate, mentions, headerEdit}` (`channel-surface.tsx:55-95`) | n/a (default body reads the same three directly) | shared-already | keep | The context has grown twice by the same mechanism (2026-09-15 `mentions`, 2026-09-17 `headerEdit`) and is about to grow a third time (row 51). |
| 19 | `webView` (single column) | not passed | not passed | host-specific-in-kind | keep | GUEST only (`guest-channel.tsx:149`); "ABSENT IS EVERY DESKTOP MOUNT, byte for byte" (`channel-surface.tsx:212`). |

### A3. Pane header (rows 20–26)

| # | Feature | HOME (file:line) | WS (file:line) | Class | Action | Notes |
|---|---|---|---|---|---|---|
| 20 | Breadcrumb + channel name type | `message-pane-header.tsx:139` (`TEMPLATE_NAME_TEXT`) | same | shared-already | keep | Name STRING differs by row 14, the type does not. |
| 21 | Pin (favourite) toggle | `message-pane-header.tsx:211-220` | same | shared-already | keep | "THE SAME CONTROL ON BOTH SURFACES" (`:175-176`). Yellow = `--warning` token (`:196-204`). |
| 22 | Info-column toggle | `message-pane-header.tsx:238-246 › IconButton bare` | same | shared-already | keep | The /home 32px circle override was **deleted** (`home.module.css:251-262`) — one control, one face. |
| 23 | Transcript filter dropdown | `message-pane.tsx:385-398` | same | shared-already | keep | Multi-select set since 2026-09-16 (`transcript-filter.tsx:12-30`); suppressed when no agent posted (`message-pane.tsx:386-389`). |
| 24 | Pop-out button | `channel-surface.tsx:358-366` | same | shared-already | keep | Thread view only; hides itself outside the desktop shell. |
| 25 | `hideChannelCrumb` | not used | not used | host-specific-in-kind | keep | GUEST single-column Info face only (`message-pane-header.tsx:67-81`). |
| 26 | Hashtag glyph before the name | gone | gone | shared-already | keep | Samuel 2026-09-16, removed in BOTH chromes (`message-pane-header.tsx:122-125,135`) and off the Info card's Name row on both (`info-tab.tsx:124-126`, `person-info-tab.tsx:277-280`). |

### A4. Transcript (rows 27–37)

| # | Feature | HOME (file:line) | WS (file:line) | Class | Action | Notes |
|---|---|---|---|---|---|---|
| 27 | Row derivation (`channelRows` / `threadRows`) | `channel-surface-data.ts` → `derivations.ts` | same | shared-already | keep | |
| 28 | `authored-row.tsx` side/continuation rule | `authored-row.tsx:286-357` | same | shared-already | keep | |
| 29 | Agent accent frame + bar | `authored-row.tsx:403-440` | same | shared-already | keep | One rule, `agent-box-rule.ts › agentBoxOf`, asked by the filter too (`transcript-filter.tsx:183`). |
| 30 | Attribution pill (human + agent) | `attribution-pill.tsx:353-375` | same | shared-already | keep | Pill FACE differs by CSS only — row 11 / §D. |
| 31 | Citation pill `#NNNN` → jump | `channel-surface.tsx:309-311 › jumpToSeq` | same | shared-already | keep | POP passes no `onJumpToSeq` → plain text (`message-pane.tsx:224-231`). |
| 32 | Escalation card answer | `channel-surface.tsx:416-417` | same | shared-already | keep | |
| 33 | In-transcript thread cards + their launch button | `message-pane.tsx:449-455` | same | shared-already | keep | Rides `newAgent.canLaunch` (row 44). |
| 34 | Scroll-up paging | `message-pane.tsx:257-265 › useLoadOlder` | same | shared-already | keep | |
| 35 | Stick-to-bottom | `message-pane.tsx:243-253` | same | shared-already | keep | |
| 36 | Mention scroll target + "older than loaded history" notice | `message-pane.tsx:417-424` | same | shared-already | keep | |
| 37 | My-agents / peer-agent activity lanes | `channel-surface.tsx:370-393` | same | shared-already | keep | |

### A5. Composer (rows 38–44)

| # | Feature | HOME (file:line) | WS (file:line) | Class | Action | Notes |
|---|---|---|---|---|---|---|
| 38 | Composer card + send | `message-pane.tsx:480-497 › ChannelsComposer` | same | shared-already | keep | |
| 39 | @-picker over `liveAgents` union | `channel-surface.tsx:352` | same | shared-already | keep | Poll ∪ own feed since 2026-09-13 (`:347-351`). |
| 40 | Recipient line / `recentAgentIds` | `channel-surface.tsx:322` | same | shared-already | keep | |
| 41 | New-agent icon (launch panel) | `channel-surface.tsx:355 › newAgent={agentsPanel}` | same | shared-already | keep | |
| 42 | New-thread panel + `newThreadSignal` | `channel-surface.tsx:339` | same | shared-already | keep | Cross-column ask, one selection hook (`:336-338`). |
| 43 | Dictation | `use-dictation.ts` via composer | same | shared-already | keep | |
| 44 | `newAgent.canLaunch` gate | `surface-info-panel.tsx:161 › launchAllowedInView` | same | shared-already | keep | `launch-view-gate.ts:10-18`; fixed 2026-09-08 for channel view. |

### A6. Info column — the row and its faces (rows 45–50)

| # | Feature | HOME (file:line) | WS (file:line) | Class | Action | Notes |
|---|---|---|---|---|---|---|
| 45 | Tab row (Info · Threads · Agents · Settings) | `info-panel.tsx:431-467` | same | shared-already | keep | `size="lg"`, `variant="underline"` (`:456-458`). |
| 46 | Thread-scoping of the column | `info-panel.tsx:308-315 › ThreadInfoTab`, `settings-slot.tsx:74-91` | same | shared-already | keep | Samuel 2026-08-21. THREAD VIEW IGNORES `infoTab` (`info-panel.tsx:210-213`). |
| 47 | `infoTabSignal` reset (2nd pill press) | `info-panel.tsx:279-285` | same | shared-already | keep | Samuel 2026-09-16. |
| 48 | Threads tab | `info-panel.tsx:335-363 › ThreadsTab` | same | shared-already | keep | |
| 49 | **Artifacts face** in the Threads slot | drawn — `info-panel.tsx:348-362`, capability on | **not drawn** (`artifacts = false`, `:91`) | shared-but-gated-off-for-workspace | RULING | Reads mount with the face (`:352-353`), so porting costs a workspace channel nothing until it is opened. §E-1. |
| 50 | Agents tab | `info-panel.tsx:364-383 › AgentsTab` | same | shared-already | keep | |

### A7. Info TAB BODY — WS `info-tab.tsx` vs HOME `person-info-tab.tsx` (rows 51–64)

| # | Feature | HOME (file:line) | WS (file:line) | Class | Action | Notes |
|---|---|---|---|---|---|---|
| 51 | Channel **activity strip** | `person-info-tab.tsx:343 › PersonThreadActivity` → `person-thread-activity.tsx:47 › useOverviewSeries` | `info-tab.tsx:259 › ThreadActivityStrip bins={activityBins}` fed by `channel-surface-data.ts:358` | duplicated-should-collapse | change | **Same query path → same TanStack key → ONE request** (`use-overview-series.ts:53-55`), so the cost is a duplicated BODY, not a duplicated read. The surface already holds `activityBins`/`activityLoading` (`channel-surface-data.ts:137-138`) and **drops them for an injected tab** — the exact shape of the two bugs `mentions` (2026-09-15) and `headerEdit` (2026-09-17) already fixed. §C3. |
| 52 | **Name** row, click-to-edit | `person-info-tab.tsx:281-296 › InlineEditText` | `info-tab.tsx:127-143 › InlineEditText` | duplicated-should-collapse | change | The WRITE is already shared (`headerEdit`, `surface-info-panel.tsx:96-101`); only the two ~16-line markup blocks are forked. Read face differs: HOME `channelTitle(homeChannel)` (`:284`) vs WS `channelName` (`:131`). |
| 53 | **Description** row | `person-info-tab.tsx:185-202` | `info-tab.tsx:159-173` | duplicated-should-collapse | change | Byte-for-byte equivalent (same schema bound, same `placeholder="None"`, same `emptyClassName`). |
| 54 | `headerEditable` derivation | `person-info-tab.tsx:144` | `info-tab.tsx:106` | duplicated-should-collapse | change | **Two spellings of one rule** (`headerEdit.canEdit && !channel.isDirect`), each with a long docblock explaining why it must match the other (`person-info-tab.tsx:129-143`). Move it to `ChannelInfoTabContext`. |
| 55 | **Creator** row | `person-info-tab.tsx:203-221` + its own `useChannelMembers` (`:166-169`) | `info-tab.tsx:175-192` off `members` prop (`:94`) | duplicated-should-collapse | change | Identical `Avatar` + `memberLabel` + "Not in this channel" fallback. HOME mounts a second `useChannelMembers` (same key, no extra request — `person-members.tsx:21-25`). |
| 56 | **Created** row | `person-info-tab.tsx:222-231` — label "Created", `formatDate`, `homeChannel.createdAt` | `info-tab.tsx:194-198` — label "Date of creation", `formatShortDate`, `channel.createdAt` | duplicated-should-collapse | RULING | **Three differences on one row**: label, formatter, source. Nothing records a ruling for either. §E-2. |
| 57 | **Status** row (Active / Archived) | absent | `info-tab.tsx:200-206 › StatusPill` | workspace-only | RULING | A home container's channel can be archived by the same lifecycle write (`channel-manage.tsx:231`), so HOME can reach a state it cannot display. §E-3. |
| 58 | **Threads** count row | absent | `info-tab.tsx:224-226` | workspace-only | keep | The tab row already badges Threads (`info-panel-tabs.ts:75`); the row is arguably the duplicate, not the gap. |
| 59 | **Linked threads** section | absent | `info-tab.tsx:229-244` — `HARDCODED_LINKED_THREADS`, buttons with no `onClick` | workspace-only | remove | Marked hardcoded at its render site since 2026-08-18 (`info-tab.tsx:18-19,231-232`). A dead section on the surface that is supposed to be the reference. |
| 60 | **Curated info card** (`channels.info_card` custom rows + hover ×) | `person-info-tab.tsx:305-314 › InfoCardCustomRow` | **never rendered** — `grep -c infoCard src/.../info-tab.tsx` = **0** | home-only | RULING | The column is real, validated and PATCH-writable (`channels/info-card.ts`, `server/service-writes-channel.ts:12`, `repository.ts:208`), and `info-card-rows.tsx` lives in the SHARED tree with exactly two consumers: /home and the marketing demo (`marketing/components/banner-demo/demo-info-tab.tsx:47`). **A workspace channel can carry curated rows that no workspace surface shows.** §E-5. |
| 61 | Add-a-custom-row affordance | commented out at Samuel's instruction (`person-info-tab.tsx:315-333`) | absent | home-only | keep | Parked sketch; reviving it is a restore of one import + one handler (`:322-325`). |
| 62 | **Mentions** inbox | top-level category, always OPEN, no badge (`person-info-tab.tsx:366-382`), `inset="flush"` | collapsed disclosure with unread badge (`info-tab.tsx:210-220 › MentionsDisclosure`, `mentions-disclosure.tsx:83-107`), `inset="nested"` | host-specific-in-kind | keep | The LIST is already one component (`mentions-list.tsx:82`); only the wrapper differs, and `mentions-disclosure.tsx:1-43` argues at length for exactly that seam. `inset` has **no default, on purpose** (`mentions-list.tsx:71-74`). |
| 63 | **Members** roster | `person-info-tab.tsx:384 › PersonMembers` → `person-members.tsx:74 › MemberRoster` (count only in the heading, `emptyLine` off) | `info-tab.tsx:265-285 › MemberRoster` with `emptyLine`, plus `Add member` + `Filter members` `IconButton`s that have **no `onClick`** (`:271-272`) | duplicated-should-collapse | change + remove | The ROW is already shared and pinned as such (`person-members.tsx:12-19`, *"Adapt data wiring here; never the row"*). Two dead WS buttons should go (§E-6). |
| 64 | **Add person / Link out** | `person-members.tsx:77-80 › LinkOutPanel` / `AddPersonDialog` | absent | home-only | keep | Different in kind: a link mint, not a member picker (`person-members.tsx:28-35`). |

### A8. Settings tab (rows 65–70)

| # | Feature | HOME (file:line) | WS (file:line) | Class | Action | Notes |
|---|---|---|---|---|---|---|
| 65 | Settings slot + thread/channel branch | `settings-slot.tsx:74-107` | same | shared-already | keep | Hook-free by design (`settings-slot.tsx:12-18`). |
| 66 | Add members row + invite dialog | hidden (row 12) | `settings-tab.tsx:191-193`, `channel-manage.tsx:245-257` | host-specific-in-kind | keep | |
| 67 | Visibility / Archive rows | shown | shown | shared-already | keep | `settings-tab.tsx:194-207`. |
| 68 | Delete channel row | hidden (row 12, `settings-tab.tsx:147-153`) | shown | host-specific-in-kind | keep | |
| 69 | Leave channel + `ChannelAgentSettings` block | shown (`selfManagement` default true) | shown | shared-already | keep | GUEST hides both on ONE flag (`channel-manage.tsx:177-182`). |
| 70 | **Responder** setting (`unaddressed_responder`) | `channel-manage.tsx:216 › ChannelAgentsSettings` | same | shared-already | keep | Membership-gated, NOT manage-gated, and that is load-bearing (`settings-channel-agents.tsx:13-18`). |

### A9. Adjacent — the list beside the surface (rows 71–74, flagged out of strict scope)

| # | Feature | HOME (file:line) | WS (file:line) | Class | Action | Notes |
|---|---|---|---|---|---|---|
| 71 | Recency **wells** (Pinned / Recent / Earlier) | `relationship-list.tsx:125-128 › WellsColumn` over `home-channel-wells.ts:48-52` | none — flat tree (`sidebar.tsx`) | home-only | RULING | The well SET already moved into the shared tree for the marketing demo (`home-channel-wells.ts:17-23`), so WS could adopt it without a move. |
| 72 | Unread **mention count** on a row | `relationship-list.tsx:213 › channel.unreadMentions` (`features/home/types.ts:164`) | boolean dot only — `sidebar-rows.tsx:128-131`; "NO UNREAD BADGE … there is no such number in the read" (`:69-71`) | home-only | port (server) | The number exists server-side for home channels (`home/server/service-reads.ts:169-172`); the workspace channels read has no equivalent projection. |
| 73 | Last-message **preview** line | `relationship-list.tsx:198 › lastMessagePreview` | absent | home-only | RULING | |
| 74 | Selected-row face | `channel-row-marks.tsx › HOME_CARD_FACE_SELECTED` (`.auth-btn-3d`) | selection ring (`sidebar-rows.tsx`) | host-specific-in-kind | keep | Samuel 2026-09-15 (`home.module.css:17-31`). |

**Row counts — A:** 74 rows. `shared-already` 38 · `duplicated-should-collapse` 9 ·
`host-specific-in-kind` 12 · `home-only` 7 · `workspace-only` 5 ·
`shared-but-gated-off-for-workspace` 2 · dead-capability 1.
Actions: `keep` 52 · `change` 8 · `RULING` 9 · `port` 2 · `remove` 2 (+1 combined).

---

## B. EVERY CAPABILITY / SLOT / PROP ONE HOST PASSES AND THE OTHERS DO NOT

| Knob | Declared | WS | HOME | GUEST | POP | Ruling that created it | "home-only on purpose" vs "home-first, workspace later" |
|---|---|---|---|---|---|---|---|
| `capabilities.memberManagement` | `channel-surface.tsx:118` | — (`true`) | **`false`** (`relationship-record.tsx:141`) | **`false`** (`guest-channel.tsx:159`) | n/a | 2026-08-25 (R2/R3 family); §4A `LINK_CONTAINER_CLOSED` | **on purpose** — names an operation that cannot happen in a link container at any size (`relationship-record.tsx:105-110`) |
| `capabilities.selfManagement` | `channel-surface.tsx:147` | — (`true`) | — (`true`) | **`false`** (`guest-channel.tsx:160`) | n/a | Samuel, R2/R3, 2026-08-25 (`channel-surface.tsx:139-147`; `guest-channel.tsx:15-22`) | **guest-only on purpose** — one flag, two controls, one story |
| `capabilities.peerNamedHeader` | `channel-surface.tsx:134` | — (`true`) | **`false`** (`relationship-record.tsx:142`) | — (`true`) | n/a | Samuel, 2026-09-01 (`channel-surface.tsx:122-133`; `relationship-record.tsx:125-132`) | **on purpose** — real DMs on WS are the reason it is a flag and not an edit to `channel-display.ts` |
| `capabilities.knowledge` | `channel-surface.tsx:168` | — (`false`) | — (`false`, F-340) | — (`false` since 2026-09-04) | n/a | F-340 Samuel 2026-08-27 (HOME off); Samuel 2026-09-04 (GUEST off, `guest-channel.tsx:150-157`) | **⚠ NEITHER — it is now unreachable on every host.** See §E-4 |
| `capabilities.artifacts` | `channel-surface.tsx:185` | — (`false`) | **`true`** (`relationship-record.tsx:143`) | — (`false`) | n/a | Samuel, 2026-09-16, "standing home-space ruling for a new surface" (`channel-surface.tsx:176-178`) | **home-FIRST, workspace later** — the docblock says the other hosts are *"LEFT ALONE rather than forgotten"* and that the face is safe on any host (`:182-184`) |
| `slots.infoTab` | `channel-surface.tsx:108` | — | **`PersonInfoTab`** (`relationship-record.tsx:95`) | — | n/a | 2026-08-25 (render function, for the gate) | **on purpose in shape, accidental in size** — the slot is right; what it currently replaces is 10 rows that are the same rows (§C2) |
| `webView` | `channel-surface.tsx:214` | — | — | **`useChannelWebView()`** (`guest-channel.tsx:149`) | n/a | Samuel, 2026-09-04 | **guest-only on purpose** — "ABSENT IS EVERY DESKTOP MOUNT, byte for byte" |
| `role` | `channel-surface-standalone.tsx:72` | real role (`pages/channels/index.tsx:87`) | **not passed** → `"member"` | **not passed** → `"member"` (`guest-channel.tsx:24-39`) | real role | R4, rewritten 2026-08-26 | **on purpose** — "a host that does not know must not be the one to widen" |
| `onRosterChanged` | `channel-surface.tsx:201` | `refetchChannels` (`channels-core.tsx:226`) | not passed | not passed | n/a | — | incidental: WS owns a channel LIST the roster can invalidate |
| `onDeselect` / `onDeleted` | `channel-surface.tsx:204` | not passed (selection clears itself) | `onDeleted` (`relationship-record.tsx:79`) | `onDeleted` (`guest-channel.tsx:162`) | n/a | — | on purpose — a pinned host must be told |
| `onDoorbell` | `channel-surface-data.ts:148` | invalidate channel list (`channels-core.tsx:178-180`) | not passed | not passed | n/a | INVARIANTS §7/§8 | on purpose |
| `initialChannelId` | `channels-core.tsx:40` | route param (`pages/channels/index.tsx:89`) | n/a (pinned) | n/a | n/a | wiring plan Phase 9 | on purpose |
| `initialThreadId` | `channel-surface-standalone.tsx:73` | `?thread=` (`pages/channels/index.tsx:90`) | `jump.threadFor(row.id)` (`home-panes.tsx:221`) | not passed | route | Phase 10 / `use-activity-jump.ts` 2026-09-01 | on purpose |
| `Link` | `channels-core.tsx:32` | `RouterLink` | n/a | n/a | n/a | — | WS-only, one consumer |
| `color` on `ChannelsAgentPanel` | `agent-panel.tsx:187` | **NOT passed** (`overlays.tsx:73-86`) | passed (`surface-agent-view.tsx:54-58`) | passed | n/a | 2026-09-13, `docs/specs/agent-colors.md` item 5 | **home-first, workspace later — and undocumented as such.** This is a straight miss, not a ruling |
| `emptyLine` on `MemberRoster` | `info-tab.tsx:283` | on | off (`person-members.tsx:70-72`) | off | n/a | 2026-08-25 note in `person-members.tsx:70-72` | on purpose (a home channel always has the caller in it) |
| `inset` on `MentionsList` | `mentions-list.tsx:108` | `"nested"` (`mentions-disclosure.tsx:121`) | `"flush"` (`person-info-tab.tsx:381`) | `"nested"` | n/a | Samuel, 2026-09-17, verbatim (`mentions-list.tsx:55-74`) | on purpose — "NO DEFAULT, BECAUSE THE TWO HOSTS DISAGREE" |

**Row count — B:** 17 knobs. Of these: **on purpose** 12 · **home-first / workspace later**
2 (`artifacts`, `color`) · **dead** 1 (`knowledge`) · **incidental plumbing** 2.

---

## C. DUPLICATED BODIES — the places a host replaced a shared body

### C1. `ChannelsAgentPanel`, wired twice

| | WS | HOME + GUEST |
|---|---|---|
| Wiring site | `overlays.tsx:73-86` | `surface-agent-view.tsx:44-80` |
| `openAgent`, `sessions`, `messages` | ✔ | ✔ |
| `pendingPosts`, `onPostPending` | ✔ (`:77-78`) | ✔ (`:66-67`) |
| `onAnswerEscalation`, `answerBusy`, `postBusy` | ✔ | ✔ |
| `currentUserId`, `workspaceSlug`, `onClose`, `onRefreshSessions` | ✔ | ✔ |
| **`color`** | ✘ **missing** | ✔ (`:54-58`) |
| **`full`** | ✘ (no single-column layout on WS) | ✔ (`:77`) |
| Mount position | page-level overlay, outside the channel branch (`overlays.tsx:13-16`) | positioned against the surface (`channel-surface-standalone.tsx:113-115`) |

**Recommendation.** Keep the two MOUNT POSITIONS (they differ in kind — WS must mount
outside the channel branch so a workspace with no channel can still create one); collapse
the WIRING into `SurfaceAgentView`, which already takes `data: ChannelSurfaceData` and
derives every prop from it. WS would render `<SurfaceAgentView data={data} openAgent={…}
onClose={…} currentUserId={…} workspaceSlug={…} />` from inside `ChannelsOverlays`, next to
`ChannelsCreateDialogs`. That deletes 14 forwarded props from `ChannelsOverlays`'s signature
(`overlays.tsx:25-67`) and closes row 5 as a side effect rather than as a patch.

### C2. `InfoTab` (WS, shared tree) vs `PersonInfoTab` (HOME, SPA tree) — feature by feature

| Section | `info-tab.tsx` | `person-info-tab.tsx` | Same? |
|---|---|---|---|
| Heading "Channel info" | `:112` | `:265` | ✔ identical string, two `PanelHeading` calls |
| Name row (icon `Type`, `InlineEditText`, 120 cap, empty = cancel) | `:127-143` | `:281-296` | ✔ semantically; **forked markup**; read face differs (`channelName` vs `channelTitle`) |
| Description row (icon `AlignLeft`, 2000 cap, `"None"`, `text-text-muted`) | `:159-173` | `:185-202` | ✔ semantically; **forked markup** |
| `headerEditable` | `:106` | `:144` | ✔ same expression, **two declarations** |
| Creator row | `:175-192` | `:203-221` | ✔ same markup; different member source |
| Created row | `:194-198` "Date of creation", `formatShortDate`, `channel.createdAt` | `:222-231` "Created", `formatDate`, `homeChannel.createdAt` | ✘ **three-way divergence** |
| Status row | `:200-206` | — | ✘ WS only |
| Mentions | `:210-220` disclosure, collapsed, badge | `:366-382` top-level, open, no badge | ✘ in kind (ruled) |
| Threads count row | `:224-226` | — | ✘ WS only |
| Linked threads (hardcoded) | `:229-244` | — | ✘ WS only, dead |
| Activity strip | `:248-263` from props | `:343-346` from its own hook wrapper | ✘ **duplicated body, one request** |
| Members heading | `:265-275` count + 2 dead icon buttons | `person-members.tsx:64-69` count only | ✘ |
| `MemberRoster` | `:281-285` `emptyLine` | `person-members.tsx:74` no `emptyLine` | ✔ same component |
| Curated `info_card` rows | — | `:269-314` | ✘ HOME only |
| Add person / Link out | — | `person-members.tsx:77+` | ✘ HOME only |

**Recommendation — ONE body, three host facts.** Make `info-tab.tsx` the single body and
give it three inputs instead of a slot that replaces it:

1. `activityBins` / `activityLoading` — already on `ChannelSurfaceData`, just add them to
   `ChannelInfoTabContext` (row 51).
2. `mentionsLayout: "disclosure" | "category"` — the one genuinely ruled difference (row 62),
   already expressible because `MentionsList` takes `inset`.
3. `extras?: { belowCard?, belowRoster? }` — two named slots for the two genuinely
   home-only blocks: the curated `info_card` section and Add person / Link out.

Then delete `person-info-tab.tsx` (395 lines) and keep `person-members.tsx` /
`link-out-panel.tsx` as the `belowRoster` slot's content. Rows 52–56 and 60 become one
declaration each; rows 57–59 become explicit host facts (or die, per §E-3 and the `remove`
on row 59). **The evidence that this is the right direction is already in the tree:** the
context has been widened twice for exactly this reason (`channel-surface.tsx:59-94`), and
both files' docblocks assert the tabs "are MEANT TO MATCH" (`info-tab.tsx:7-10`,
`person-info-tab.tsx:253-259`).

### C3. `ThreadActivityStrip`, wrapped twice

`person-thread-activity.tsx` (63 lines) exists only to call `useOverviewSeries` and render
`ThreadActivityStrip` under a `PanelHeading` — which `info-tab.tsx:248-263` does from props
the surface already holds. `channel-surface-data.ts:358-363` and
`person-thread-activity.tsx:47-51` produce the **same path**
(`use-overview-series.ts:53-55`), so this is one request rendered by two components.
Collapse into the context (§C2 input 1) and delete the wrapper. Note this closes the last
residue of **F-316** (`docs/REFACTOR-FINDINGS.md:3247`, resolved 2026-09-05), which closed
the DATA gap and left the composition gap open.

### C4. Loading ghosts, three spellings

`ChannelRecordSkeleton` (HOME, `channel-record-skeleton.tsx`, geometry by reference and
tab count by import — `:3-4,61`) · `ChannelsSkeleton` (WS, self-described *"a rough fit"* —
`channels-skeleton.tsx:8-12`) · the KIT generics (GUEST, `guest-channel.tsx:115-117`).
**Recommendation:** promote `ChannelRecordSkeleton` into the shared tree beside
`channel-surface-standalone.tsx` (it imports only from `@/features/channels` + `@/shared`
plus one SPA `SkeletonSurface`, `:5`), have GUEST render it, and let WS compose it beside
its tree ghost.

**Row count — C:** 4 duplicated bodies, 15 diffed sub-features in C2.

---

## D. UI / UX MAP — what a user actually sees differently

| # | Difference | HOME (file:line) | WS (file:line) | CSS/recipe swap or behaviour? |
|---|---|---|---|---|
| D1 | Pane frame: 2px account-palette border + `bg-home-card` card vs `.page-float` | `pages/home/index.tsx:284-285` + `home.module.css:56-59` | `channels-core.tsx:199` | **pure CSS** (scoped module, unlayered — `home.module.css:43-47`) |
| D2 | Structural dividers 2px vs hairline | `home.module.css:65-81` | kit `border-border-default` | **pure CSS** |
| D3 | Resize pill sits on a 2px line | `home.module.css:76-78 › --channel-divider-w: 2px` read by `info-resize-handle.tsx › DIVIDER_WIDTH_VAR` | falls back to the kit hairline | **pure CSS**, but the *variable* is the contract |
| D4 | Attribution pills wear the raised-light face | `home.module.css:102-106` on `[data-attribution-pill]` (`attribution-pill.tsx:362,375`) | flat `.bento` (`attribution-pill.tsx:312`) | **pure CSS** — explicitly "NOT A FORKED RECIPE" (`home.module.css:87-90`) |
| D5 | Composer panels (new-thread, new-agent) filled with `--home-panel` | `home.module.css:128-130` on `[data-composer-panel]` (`composer-panel-fields.tsx:15-17,122`) | neutral `bg-bg-inset` | **pure CSS** |
| D6 | Section panels flat gray | `home.module.css:165-168` on `[data-section-panel]` | neutral flat card | **pure CSS** |
| D7 | Header hashtag glyph | gone | gone | — (was a difference; unified 2026-09-16, `message-pane-header.tsx:122-125`) |
| D8 | Info-toggle circle | gone | gone | — (was /home-only; deleted `home.module.css:251-262`) |
| D9 | Click-to-edit Name/Description | live (`person-info-tab.tsx:281,189`) | live (`info-tab.tsx:128,160`) | — (was HOME display-only until 2026-09-17; **now behaviour-equal, markup-forked**) |
| D10 | Mentions: open category with flush rows vs collapsed row with a badge and 28px hang | `person-info-tab.tsx:366-382`, `inset="flush"` (`mentions-list.tsx:79`) | `info-tab.tsx:210-220`, `inset="nested"` (`:78`) | **behaviour** (open state, badge) + CSS (inset) — both ruled |
| D11 | Members heading: count only vs count + two inert icon buttons | `person-members.tsx:64-69` | `info-tab.tsx:265-275` | **behaviour** — WS's two buttons have no handler |
| D12 | Info card carries removable custom rows with a hover × | `person-info-tab.tsx:305-314` | not rendered at all | **behaviour** (a whole feature) |
| D13 | "Created" vs "Date of creation"; `formatDate` vs `formatShortDate` | `person-info-tab.tsx:222-231` | `info-tab.tsx:194-198` | **behaviour** (copy + format) |
| D14 | Status pill (Active/Archived) | absent | `info-tab.tsx:200-206` | **behaviour** |
| D15 | "Linked threads" list of 3 inert hash rows | absent | `info-tab.tsx:229-244` | **behaviour** (dead control) |
| D16 | Artifacts toggle inside the Threads heading | present (`info-panel.tsx:348-351`) | absent | **behaviour** (capability) |
| D17 | Channel list: three collapsible wells vs flat tree | `relationship-list.tsx:125-128` | `sidebar.tsx` | **behaviour** |
| D18 | Channel list row: `@ N` mention count + message preview vs a dot | `relationship-list.tsx:198,213` | `sidebar-rows.tsx:128-131` | **behaviour** (needs a server projection on the workspace read) |
| D19 | Selected row: black 3D button face vs selection ring | `channel-row-marks.tsx › HOME_CARD_FACE_SELECTED` | `sidebar-rows.tsx` | **pure CSS**, ruled 2026-09-15 |
| D20 | Loading: exact two-column ghost vs generic bubbles | `channel-record-skeleton.tsx` | `channels-skeleton.tsx`; **GUEST** `guest-channel.tsx:115-117` | **behaviour** (layout jump on GUEST) |
| D21 | Agent pane banner/stream colour | coloured (`surface-agent-view.tsx:54-58`) | uncoloured (`overlays.tsx:73`) | **behaviour** (missing prop) |
| D22 | Info column open at mount | yes (`use-channels-selection.ts:111`) | yes (same) | — shared |
| D23 | Info column width persists per device | shared `--info-w` (`info-panel.tsx:414-419`, `use-info-resize.ts`) | same | — shared |

**Row count — D:** 23 rows. **Pure CSS/recipe swap:** 8 (D1–D6, D19, and D3's variable) ·
**behaviour:** 13 · **already unified:** 2 (D7, D8) + D22/D23 noted as shared.

⚠ **The CSS half is already correct architecture and should not be "fixed".**
`home.module.css:33-54` states the fence: the shared surface keeps neutral hairlines, and
only the copy mounted inside `.frame` wears the account palette, hooked on ATTRIBUTES
(`data-attribution-pill`, `data-composer-panel`, `data-section-panel`) rather than utility
classes. That is the pattern a fourth host should reuse, not replace.

---

## E. ITEMS NEEDING SAMUEL'S RULING

1. **Artifacts face on the workspace channels page.** Today /home only
   (`relationship-record.tsx:143`). (a) Port it — same toggle, reads mount with the face so
   an unopened workspace channel pays nothing; (b) leave it home-only and say so in the
   capability docblock; (c) port it and make `artifacts` the default `true`, deleting the
   flag. **Recommend (a)** — the capability's own note already says the other hosts were
   "LEFT ALONE rather than forgotten" (`channel-surface.tsx:179-181`), i.e. it was filed as
   home-first, not home-only.

2. **"Created" vs "Date of creation", `formatDate` vs `formatShortDate`.** (a) Both become
   "Created" + `formatDate`; (b) both become "Date of creation" + `formatShortDate`;
   (c) keep the divergence. **Recommend (a)** — shorter label, and `formatDate` is the one
   /home ships today so the change lands on the surface being brought UP to parity.

3. **Status row on /home.** A home container's channel CAN be archived
   (`channel-manage.tsx:231`) but /home's Info tab cannot show it. (a) Add the Status row to
   the one shared body; (b) declare archive meaningless for a link container and hide the
   archive control there too; (c) leave it. **Recommend (a)** — (b) is a second, larger
   ruling about link-container lifecycle.

4. **The `knowledge` capability has no host.** WS never passed it, HOME stopped 2026-08-27
   (F-340), GUEST stopped 2026-09-04. (a) Delete the capability, `knowledge-tab.tsx`, the
   fifth-tab width branch (`info-panel.tsx:421-435`) and the `knowledge` arm of
   `channelPaneTabs`; (b) restore it on GUEST, where it was once the only way to read a
   granted base; (c) leave it parked. **Recommend (a)** — the ruling that took it off GUEST
   was explicit ("Re-adding it needs Samuel's word", `guest-channel.tsx:155-157`), and
   unreachable UI with a width budget attached is exactly what this parity wave is for.
   ⚠ (a) also deletes `channel-record-skeleton.tsx`'s reason for calling
   `channelPaneTabs(false, false)` dynamically — harmless, but touch both.

5. **The curated `info_card` on workspace channels.** Stored, validated, writable, and
   rendered on exactly one surface (row 60). (a) Render it on the one shared body, so every
   channel shows its curated rows; (b) declare it a home-space feature and gate it with an
   `infoCard` capability; (c) leave the divergence. **Recommend (a)** — the column is on
   `channels`, not on a home type, and a stored row nothing displays is a data trap.

6. **The two inert `IconButton`s in the WS Members heading** (`info-tab.tsx:271-272`).
   (a) Delete them (INVARIANTS §5's dead-control rule; `person-members.tsx:28-35` already
   argues this); (b) wire "Add member" to the existing invite dialog and delete only the
   filter; (c) leave. **Recommend (a)**, with (b) as a follow-up ticket.

7. **"Linked threads"** (`info-tab.tsx:229-244`) — hardcoded since 2026-08-18 with no
   relation to read. (a) Delete section + `HARDCODED_LINKED_THREADS`; (b) keep as a
   placeholder. **Recommend (a)**.

8. **Threads count row** (`info-tab.tsx:224-226`) duplicates the tab-row badge
   (`info-panel-tabs.ts:75`). (a) Delete the row; (b) keep and add it to /home for symmetry.
   **Recommend (a)**.

9. **Channel-list signals: mention counts, previews and wells on the workspace tree**
   (rows 71–73). (a) Port all three — needs an `unreadMentions` + `lastMessagePreview`
   projection on the workspace channels read, mirroring
   `home/server/service-reads.ts:169-172`; (b) port the wells only (client-side, free);
   (c) none. **Recommend (b) now, (a) as its own slice** — (a) is a server change and
   belongs in a reads/projection document, not this one.

10. **GUEST's generic loading ghost** (`guest-channel.tsx:115-117`). Not really a ruling,
    but it needs an owner: the same defect Samuel ruled on for /home 2026-09-13 is still
    live on the one surface an outsider sees first. **Recommend: fix with §C4, no ruling
    needed** — flagged here so it is not lost.

**Row count — E:** 10 items.

---

## F. TARGET STRUCTURE — one surface, four hosts, zero forks

```
src/features/channels/components/
  channel-surface.tsx              ← the FRAGMENT (unchanged in shape)
  channel-surface-data.ts          ← the ONE live loop (unchanged)
  channel-surface-standalone.tsx   ← pinned-channel HOST wrapper (unchanged)
  surface-info-panel.tsx           ← mints the context, wires the panel
  info-panel.tsx / info-panel-tabs.ts
  info-tab.tsx                     ← *** THE ONE INFO BODY *** (absorbs person-info-tab)
  surface-agent-view.tsx           ← *** THE ONE AGENT WIRING *** (absorbs overlays' copy)
  channel-record-skeleton.tsx      ← *** MOVED HERE from pages/home ***
  home-channel-wells.ts            ← already here (precedent for moving SPA sets in)
apps/desktop-ui/src/pages/home/
  relationship-record.tsx          ← host: capabilities + two extras slots
  person-members.tsx, link-out-panel.tsx, add-person-dialog.tsx   ← extras CONTENT
  home.module.css                  ← the paint fence (unchanged)
```

### F1. The host contract (three kinds of input, and nothing else)

```ts
// CAPABILITIES — booleans that ADD or REMOVE a control. Default = the workspace
// page's behaviour, except where the flag ADDS (then default false).
interface ChannelSurfaceCapabilities {
  memberManagement?: boolean;   // container roster is changeable          (default true)
  selfManagement?: boolean;     // viewer's own row + agent are theirs here (default true)
  peerNamedHeader?: boolean;    // header may name the counterpart         (default true)
  artifacts?: boolean;          // → RULING E-1; candidate for deletion (always on)
  // knowledge?: boolean;       // → RULING E-4: delete, no host passes it
  infoCard?: boolean;           // → RULING E-5: only if (b) wins; otherwise delete
}

// SLOTS — named, ADDITIVE regions. A slot may never REPLACE a shared body again;
// that is what produced person-info-tab.tsx.
interface ChannelSurfaceSlots {
  infoExtras?: (ctx: ChannelInfoTabContext) => {
    belowCard?: ReactNode;    // /home: the curated info_card section (or E-5(a) kills it)
    belowRoster?: ReactNode;  // /home: Add person / Link out
  };
}

// CONTEXT — everything the surface has ALREADY read or minted, handed down once.
// It grows by the same mechanism it grew twice already; nothing below may be
// re-fetched or re-minted by a slot (INVARIANTS §7/§8: one refetch gate per surface).
interface ChannelInfoTabContext {
  gate: MutationGate;                       // 2026-08-25
  mentions: MentionsBundle;                 // 2026-09-15
  headerEdit: ChannelHeaderEdit;            // 2026-09-17
  headerEditable: boolean;                  // ← MOVE HERE (kills the two spellings, row 54)
  activity: { bins: readonly ActivityBin[]; loading: boolean };  // ← ADD (row 51)
  members: ChannelMember[];                 // ← ADD (kills HOME's second useChannelMembers)
  mentionsLayout: "disclosure" | "category";// ← the ONE ruled presentational fact (row 62)
}

// ADAPTERS — what only the host can answer, as plain props (already true today).
//   workspaceId · workspaceSlug · channel (resolved row) · currentUserId · role
//   onRosterChanged · onDeselect · webView · initialThreadId
```

### F2. Rules the contract has to carry, in the shape the tree already argues for

- **R-F1 — A slot may ADD, never REPLACE.** Every parity bug in this area
  (`mentions` 2026-09-15, `headerEdit` 2026-09-17, `activity` today) has the same cause:
  a body-replacing slot threw away something the surface had already paid for
  (`surface-info-panel.tsx:190-198`). Additive slots make that class of bug unexpressible.
- **R-F2 — Facts the surface already holds travel in the context, never re-read by a tab.**
  Stated three times in the tree already (`channel-surface.tsx:68-71`,
  `mentions-disclosure.tsx:54-61`, `person-info-tab.tsx:106-118`).
- **R-F3 — A presentational difference that survives a ruling becomes an ENUM on the
  context, not a second component.** `mentionsLayout` is the model; `MentionsList`'s
  `inset` already works this way and deliberately has no default
  (`mentions-list.tsx:71-74`).
- **R-F4 — Paint stays a scoped, attribute-hooked CSS module owned by the host.** Never a
  `tone="home"` prop on a shared primitive — `home.module.css:148-155` records why.
- **R-F5 — Geometry in a skeleton is by reference/import, never restated** (INVARIANTS §1A;
  `channel-record-skeleton.tsx:23-30`). Moving the ghost into the shared tree makes that
  automatic for GUEST too.
- **R-F6 — Only one `useChannelSurfaceData` per live surface, and hosts mount it above any
  branch that can render a non-channel** (INVARIANTS §7; `channels-core.tsx:121-128`).

### F3. Migration order (smallest blast radius first)

1. **C1** — route WS's agent panel through `SurfaceAgentView`; closes row 5 for free.
2. **C3 + context `activity`** — delete `person-thread-activity.tsx`.
3. **Context `members` + `headerEditable`** — kills rows 54–55 and HOME's second roster hook.
4. **C2** — one `info-tab.tsx` with `mentionsLayout` + `infoExtras`; delete
   `person-info-tab.tsx`. Land rulings E-2, E-3, E-5, E-6, E-7, E-8 in this step.
5. **C4** — move `ChannelRecordSkeleton` into the shared tree; GUEST adopts it.
6. **E-1** (`artifacts`) and **E-4** (`knowledge`) — one flag on, one flag deleted.
7. **E-9(b)** — wells on the workspace tree; leave the server projection to its own slice.

---

## Confidence and gaps

**High confidence.** Every row above was read in full or grepped to its definition in this
worktree. The host census (§0) is exhaustive for `ChannelSurface` / `StandaloneChannelSurface`
/ `ChannelsCore` (`grep -rn 'ChannelSurface|StandaloneChannelSurface|ChannelsCore' src apps`,
non-test hits: 18 files, all accounted for). The "no web workspace page" claim is a
directory census, not an inference.

**Gaps I did not close.**
1. **Tests were read only where they were named as pins** (`knowledge-tab.test.tsx › the
   capability, per host`, `channel-record-skeleton.test.tsx`, `transcript-filter.test.tsx`).
   A collapse of `person-info-tab.tsx` will break `person-info-tab*.test.tsx` (6 files) and
   `surface-slot-fixtures.tsx` — I have not counted the assertions that move.
2. **`threads-tab.tsx`, `agents-tab.tsx`, `knowledge-tab.tsx`, `thread-info-tab.tsx` and
   `thread-settings-tab.tsx` were read only at their call sites.** I found no host-specific
   props on any of them, but I did not diff their bodies.
3. **`transcript.tsx` (453 lines) and `composer.tsx` (343 lines) were read at their
   interfaces and their host-facing props only** — I assert they are host-neutral on the
   evidence that no host passes them anything, not on a full read.
4. **The agent WINDOW (`pages/agent-window`) is out of scope here** and may be a fifth host
   of some of these components.
5. **INVARIANTS.md §5/§7 were grepped, not read whole** (the grep returned 78KB). If a
   §-numbered claim above is wrong, it is a paraphrase error in this document, not a code
   claim — the code citations stand on their own.
6. **No ruling date is invented.** Where a docblock carries "Samuel, YYYY-MM-DD" I cite it;
   where a divergence carries none (rows 5, 56, 57, 60), §E says so explicitly.
