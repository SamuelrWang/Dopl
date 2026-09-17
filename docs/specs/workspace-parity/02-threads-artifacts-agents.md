# Workspace parity — 02: Threads, Artifacts, Agents

**Area:** the Threads tab and thread record/window · Artifacts (tab, card, service, the /home-only
toggle) · the Agents tab, agent panel, agent stream, agent window, held-gate, posture, wells ·
agent templates · the launch flow · the directions lane · the unaddressed-responder row · agent
naming/handles · session-state rows · credits in agent views.

**Measured:** 2026-09-17, worktree `/Users/samuelwang/Downloads/sie-parity`, branch
`docs/workspace-parity` at `03506fcd`. READ-ONLY survey; nothing in this area was edited.

**On line numbers.** `CLAUDE.md § Standing rules for writing docs` rule 2 forbids bare line
numbers. This document was commissioned with "file:line evidence for BOTH sides on every row", so
every citation is written `path:line › symbol` — the line is the evidence for *this* survey, the
symbol is what survives it. **Re-derive before acting**, never quote a line:

```
ls src/features/channels/components | wc -l                 # the shared tree's size
grep -rn "capabilities=" --include="*.tsx" src apps | grep -v '\.test\.'   # who passes what
grep -rn "ChannelSurface\b" --include="*.tsx" src apps | grep -v '\.test\.'
grep -rn "ChannelsAgentPanel" --include="*.tsx" src apps | grep -v '\.test\.'
```

---

## 0. The hosts, and what they already share

There are **three hosts** of the channel surface and **two** of the agent-template surface. Every
one of them mounts the same shared tree under `src/features/channels/components/` and
`src/features/agent-templates/`; none of them owns a forked copy of a tab.

| Host | Entry | Mounts | Notes |
|---|---|---|---|
| **HOME** (desktop `/home` → Channels face) | `apps/desktop-ui/src/pages/home/relationship-record.tsx:73` › `RelationshipRecord` | `channel-surface-standalone.tsx:43` › `StandaloneChannelSurface` | one pinned channel, no tree, inside the record pane (`pages/home/index.tsx:260`) |
| **WORKSPACE-DESKTOP** (`/:segment/channels`) | `apps/desktop-ui/src/pages/channels/index.tsx:64` › `ChannelsPage` → `channels-core.tsx:130` › `ChannelsCore` | `channels-core.tsx:218` › `ChannelSurface` + `channels-core.tsx:241` › `ChannelsOverlays` | three columns: tree · transcript · info |
| **WORKSPACE-WEB (guest lane)** (`/c/[workspaceId]`) | `src/app/c/[workspaceId]/page.tsx:48` › `GuestChannelPage` → `guest-channel.tsx:140` | `StandaloneChannelSurface` with `webView` | ⚠ **this is the only `src/app/**` channel surface.** There is no web workspace channels page; `channels-v2` the route and the folder are both gone (`pages/channels/index.tsx:12-25`) |
| **AGENT TEMPLATES — workspace** | `apps/desktop-ui/src/pages/agents/index.tsx:34` › `AgentsPage` | `agent-templates-core.tsx:88` › `AgentTemplatesCore` | shelf `"workspace"` (`agent-templates-core.tsx:86`) |
| **AGENT TEMPLATES — home** | `apps/desktop-ui/src/pages/home/agent-panels.tsx:73` › `HomeAgentPanels` | `template-section.tsx › TemplatePanel/TemplateGrid` + `template-editor.tsx › TemplateEditor` | container list + shelf `"home"` (`agent-panels.tsx:102,106,325`) |

Two **satellite windows**, both `/:workspaceSegment/...` top-level routes outside the app shell,
both reachable **identically from either channel host** because the opener lives in the shared tree:

- thread pop-out — `apps/desktop-ui/src/pages/thread-window/index.tsx:39`, opened by
  `pop-out.tsx:48` › `PopOutThreadButton`, mounted by `channel-surface.tsx:358-366` for **both**
  hosts; routes with whatever `workspaceSlug` the host passed
  (`relationship-record.tsx:75` passes `homeChannel.workspaceSegment`).
- agent window — `apps/desktop-ui/src/pages/agent-window/index.tsx:64`, opened by
  `agent-panel-controls.tsx:213` › `openAgentWindow(agent, workspaceSlug)`.

**The headline:** almost everything in this area is *already* one implementation. The parity gap is
**not** duplicated tabs. It is (a) **one capability switched off for workspaces** (Artifacts),
(b) **four hand-wirings of one component that have silently drifted**, and (c) **two duplicated
bodies** that the shared tree already has the seam for.

---

## A. Feature inventory

`H` = /home host, `WD` = workspace desktop host, `WW` = workspace web (guest lane).
Classification ∈ {shared-already, shared-but-gated-off-for-workspace, duplicated-should-collapse,
host-specific-in-kind, workspace-only, home-only}.

### A.1 Threads

| # | Feature | Home behaviour (path:line) | Workspace behaviour (path:line) | Classification | Action | Notes |
|---|---|---|---|---|---|---|
| T1 | Threads tab exists in the info column | `relationship-record.tsx:73` → `channel-surface-standalone.tsx:136` → `channel-surface.tsx:424` → `surface-info-panel.tsx:136` → `info-panel.tsx:336` › `ThreadsTab` | WD: `channels-core.tsx:218` → same chain → `info-panel.tsx:336`. WW: `guest-channel.tsx:140` → `channel-surface.tsx:461` `infoPanel(webView.view)` → `info-panel.tsx:398` `fullTab` | shared-already | keep | one component, two geometries |
| T2 | Threads tab is hidden in thread view | `info-panel-tabs.ts:44` › `channelPaneTabs(threadView,…)` filters `threads` | identical — same function, same call `info-panel.tsx:254` | shared-already | keep | Samuel 2026-08-21, `info-panel-tabs.ts:32-43` |
| T3 | Thread cards in four recency wells | `threads-tab.tsx:245` › `RecencyWells storageKey=THREAD_WELLS_STORAGE_KEY` (`:49`) | identical, same module | shared-already | keep | Samuel 2026-09-13, quoted `threads-tab.tsx:19-33` |
| T4 | Bucketing stamp = `lastActivityAt`, not `updatedAt` | `threads-tab.tsx:71` › `threadActivityAt` | identical | shared-already | keep | `threads-tab.tsx:52-69` carries why |
| T5 | Empty wells still draw | `recency-wells.tsx:179` `showEmpty` (unconditional, both tabs) | identical | shared-already | keep | Samuel 2026-09-17 verbatim, `recency-wells.tsx:134-146` |
| T6 | "No threads in this channel yet." sits BESIDE the wells | `threads-tab.tsx:263-267` | identical | shared-already | keep | modelled on `relationship-list.tsx:125` |
| T7 | Clipped-list note above the rows | `threads-tab.tsx:89` › `THREADS_CLIPPED_NOTE`, rendered `:208-212` | identical | shared-already | keep | INVARIANTS §9 |
| T8 | "New thread" button | `threads-tab.tsx:162` `showNewThread`, needs `onNewThread` — passed by `surface-info-panel.tsx:152` on every host | identical | shared-already | keep | absent only on the artifacts face (`threads-tab.tsx:156-161`) |
| T9 | New-thread FORM (create_thread) | `new-thread-dialog.tsx:57` › `NewThreadDialog`, opened by the nonce `use-channels-selection.ts › requestNewThread` via `surface-info-panel.tsx:152` | identical | shared-already | keep | one form since 2026-09-08 (`new-thread-dialog.tsx:27-33`) |
| T10 | Thread mode (interactive/autonomous) | `thread-settings-tab.tsx:51-53` + `:91-107`, reached through `settings-slot.tsx:33` | identical | shared-already | keep | creator-only, mirrors the server |
| T11 | Thread delete | `thread-settings-tab.tsx:113-120` | identical | shared-already | keep | |
| T12 | Thread info tab (thread view) | `info-panel.tsx:309` › `ThreadInfoTab`; ⚠ **the `infoTab` slot is ignored in thread view** (`info-panel.tsx:308`, rule at `:207-214`) | identical | shared-already | keep | Samuel 2026-08-21 |
| T13 | Thread pop-out window | `channel-surface.tsx:358` mounts `PopOutThreadButton` on both hosts; /home supplies `homeChannel.workspaceSegment` (`relationship-record.tsx:75`) | `channels-core.tsx:218` supplies `access.workspaceSlug`; window at `pages/thread-window/index.tsx:39` | shared-already (behaviour) / **unverified on home** | RULING R-4 | the route resolves a **link-container** segment through `use-workspace-route.ts` → `resolveWorkspaceSegmentForUser` (`features/workspaces/server/segment.ts:144`), which does **not** filter `kind`. Nothing pins that a /home pop-out actually opens. |
| T14 | Thread card face (avatars, parties, Open/Viewing) | `threads-tab.tsx:284` › `ThreadCard`, `PANEL_CARD` + `CARD_BUTTON` from `bits.tsx` | identical | shared-already | keep | CSS-only differences come from `pages/home/home.module.css › .frame` (see D) |
| T15 | Milestones | no milestone surface anywhere; `op="milestone"` is a MESSAGE KIND rendered by the transcript lane (`view-model-rows.ts:51`, `escalation.ts:60`) | identical | shared-already | keep | **there is no milestone UI to bring to parity** — the word names a message lane, not a view |

### A.2 Artifacts

| # | Feature | Home behaviour (path:line) | Workspace behaviour (path:line) | Classification | Action | Notes |
|---|---|---|---|---|---|---|
| R1 | **Artifacts face exists at all** | `relationship-record.tsx:143` `artifacts: true` → `channel-surface.tsx:185` → `surface-info-panel.tsx:184` → `info-panel.tsx:263` `onArtifactsFace` | **WD passes nothing** (`channels-core.tsx:218-227` has no `capabilities` prop at all); **WW passes `{memberManagement:false, selfManagement:false}`** (`guest-channel.tsx:158-161`). Default is `false` (`info-panel.tsx:91`) | **shared-but-gated-off-for-workspace** | **RULING R-1** | Samuel 2026-09-16, the only ruling in this area that is a real *feature* gap |
| R2 | Threads↔Artifacts toggle button | `threads-tab.tsx:163-181`, drawn only when `onToggleFace` is passed (`info-panel.tsx:349`) | not drawn | shared-but-gated-off-for-workspace | port with R1 | one button, label = destination (`threads-tab.tsx:97-98`) |
| R3 | Tab-row heading flips Threads→Artifacts and drops the badge | `info-panel-tabs.ts:91` › `threadsFaceOption`, applied `info-panel.tsx:448-452` | never engages | shared-but-gated-off-for-workspace | port with R1 | the badge is dropped not repurposed (`info-panel-tabs.ts:80-90`) |
| R4 | Artifact list read | `artifacts-tab.tsx:74` › `useChannelArtifacts` (`hooks/use-channel-artifacts.ts:38`) — mounted WITH the face (`info-panel.tsx:352-362`) | never mounted | shared-but-gated-off-for-workspace | port with R1 | a host that does not pass the flag issues no request |
| R5 | Opened artifact (one run, read-only) | `artifacts-tab.tsx:181` › `OpenArtifact` → `useChannelArtifact` (`use-channel-artifacts.ts:70`) | never mounted | shared-but-gated-off-for-workspace | port with R1 | |
| R6 | **Artifact card in the transcript** | `transcript.tsx:187` › `ArtifactCard`, spliced by `derivations.ts:224` › `withArtifactCards` | **identical** — `transcript.tsx` is the shared transcript both hosts mount | shared-already | keep | ⚠ so a workspace reader **already sees artifacts inline**; only the *browse list* is gated off |
| R7 | `artifactSpanLabel` / `artifactPartialLabel` | `artifact-card.tsx:86,104` | same | shared-already | keep | |
| R8 | Artifacts flat column (NOT recency wells) | `artifacts-tab.tsx:111-123` | n/a | shared-but-gated-off | port with R1 | reasoned at `artifacts-tab.tsx:111-114`; do not "fix" by adding wells |
| R9 | fold / add / remove / dissolve (writes) | `POST /api/channels/[channelId]/artifacts` (`route.ts:80,118`, guest-floored) via MCP `op="artifact"`; `server/service-artifacts.ts:106` | **identical — the route is workspace-agnostic** | shared-already | keep | there is **no fold/dissolve UI on any host** (`artifacts-tab.tsx:15-20`) |
| R10 | Dissolved / member-less cards absent from the list | `server/service-artifacts-list.ts › listChannelArtifacts`, named at `artifacts-tab.tsx:56-61` | identical | shared-already | keep | server rule, not re-applied client-side |
| R11 | List clip + member-ceiling notes | `artifacts-tab.tsx:48` and `:222-227` | n/a | shared-but-gated-off | port with R1 | two different bounds, two sentences |
| R12 | Span numbers are computed off a PostgREST-capped page | affects /home today (the only host with the face) | would affect WD the moment R1 ships | shared-already (bug) | **fix before porting** | **F-712**, `docs/REFACTOR-FINDINGS.md:9445` — `repository-artifacts.ts › artifactSpans`, silent wrong `count`/`lastSeq` above ~20 members × 50 artifacts |

### A.3 Agents — the running-sessions tab

| # | Feature | Home behaviour (path:line) | Workspace behaviour (path:line) | Classification | Action | Notes |
|---|---|---|---|---|---|---|
| G1 | Agents tab | `info-panel.tsx:365` › `AgentsTab` (same chain as T1) | identical | shared-already | keep | |
| G2 | Own-agent cards from this machine's feed | `agents-tab.tsx:401` › `ownAgentsFor` | identical | shared-already | keep | operator surface, not a roster (`agents-tab.tsx:4-17`) |
| G3 | Peer cards from the server projection | `agents-tab.tsx:217` › `peerCardsFor` | identical | shared-already | keep | |
| G4 | Four recency wells over own-then-peer order | `agents-tab.tsx:417` › `AgentWells` (`agents-wells.tsx:123`, key `:108`) | identical | shared-already | keep | |
| G5 | Wells draw when the list is measured-empty | `agents-tab.tsx:417` unconditional + sentence sibling `:446-452` | identical | shared-already | keep | Samuel 2026-09-17 |
| G6 | Wells do NOT draw when `sessions === null` | `agents-tab.tsx:373-397` (peers only, then the browser sentence) | identical | shared-already | keep | §11 UNKNOWN≠EMPTY, argued `agents-tab.tsx:380-387` |
| G7 | Tab badge = `activeAgentCount` | `info-panel.tsx:292-301`, `undefined` on `null` sessions | identical | shared-already | keep | one derivation (`agents-model.ts`) |
| G8 | New agent split button (+ chevron) | `agents-tab.tsx:264-371` `launchRow`; gated by `canLaunch` and `workspaceId` | identical; `workspaceId` is `channel.workspaceId` on both (`info-panel.tsx:370`) — on /home that is the **link container** | shared-already | keep | so /home's picker lists the container's templates, which is the intended pairing with `agent-panels.tsx:102` |
| G9 | `canLaunch` | `use-agents-panel.ts:291` › `canLaunchAgents()` — pure bridge feature detection | identical | shared-already | keep | no host input at all |
| G10 | Launch allowed in channel view | `launch-view-gate.ts:10` › `launchAllowedInView`, applied `surface-info-panel.tsx:161` | identical | shared-already | keep | |
| G11 | Launch popup (`LaunchAgentDialog`) | `agents-tab.tsx:330-349` | identical | shared-already | keep | |
| G12 | Template picker in the chevron | `agents-tab.tsx:350-369` › `TemplateLaunchPicker` | identical | shared-already | keep | |
| G13 | Launch payload / rename / describe | `use-agent-launch-run.ts:50` `launchOverridesOf`, `:78` `launchWithIdentity` | identical | shared-already | keep | one lane (`use-agent-launch-run.ts:13-15`) |
| G14 | Colour dot on own cards | `agents-tab.tsx:242` `colorOf` off `peers` | identical | shared-already | keep | |
| G15 | Agent name / rename in place | `agents-tab-cards.tsx:25` › `AgentName` from `agent-rename.tsx` | identical | shared-already | keep | |
| G16 | Agent handle + "never a raw id" | `agents-model-identity.ts` (re-exported by `agents-model.ts`), `agent-id-visibility.test.ts` | identical | shared-already | keep | |
| G17 | `onNewThread` accepted and inert | `agents-tab.tsx:144-154` | identical | shared-already | keep | do not delete the prop |

### A.4 Agents — the agent view (slide-out panel)

| # | Feature | Home behaviour (path:line) | Workspace behaviour (path:line) | Classification | Action | Notes |
|---|---|---|---|---|---|---|
| P1 | Which component renders the pane | `channel-surface-standalone.tsx:152-160` › `SurfaceAgentView` (`surface-agent-view.tsx:21`) | WD: `overlays.tsx:73` › `ChannelsAgentPanel` **directly**. WW: `channel-surface.tsx:462-471` › `SurfaceAgentView full` | **duplicated-should-collapse** | **change** | two hand-wirings of one panel; see C1 |
| P2 | **Agent colour banner** | passed — `surface-agent-view.tsx:54-58` | **NOT passed** — `overlays.tsx:73-86` has no `color`; the prop defaults `null` (`agent-panel.tsx:179`) and reaches `AgentStream` at `:354` | **duplicated-should-collapse (live drift)** | **change** | ⚠ **the workspace channels page's agent pane draws no colour, and /home's does.** This is the drift C1 predicts, already realised. |
| P3 | Pause / End / Open window strip | `agent-panel.tsx:322` › `AgentControls` (`agent-panel-controls.tsx:99`) | identical (same component) | shared-already | keep | |
| P4 | **Held-gate Approve/Deny card** | `agent-panel-controls.tsx:258` › `AgentHeldGates` (`agent-held-gate.tsx:73`) | identical | shared-already | keep | ⚠ but see W3 — **absent from the agent window** |
| P5 | Context meter + tokens spent | `agent-panel.tsx:461` › `AgentStats` | identical | shared-already | keep | |
| P6 | Full narration stream | `agent-panel.tsx:335` › `AgentStream` | identical | shared-already | keep | |
| P7 | Directions lane (`directed` / `directed-reply`) | `agent-stream-lanes.ts:43` › `StreamLane`, faces in `agent-stream-directed.tsx` | identical | shared-already | keep | operator-fenced, host-independent (`agent-stream-directed.tsx:53-55`) |
| P8 | Held-draft outbound card in the stream | `agent-stream.tsx › SentToChannelBox`, fed `pendingPosts` by both wirings (`surface-agent-view.tsx:66`, `overlays.tsx:77`) | identical | shared-already | keep | |
| P9 | Escalation answer from the pane | `surface-agent-view.tsx:72`, `overlays.tsx:79` | identical | shared-already | keep | one mutation |
| P10 | 1:1 composer to my own agent | `agent-panel.tsx:373` › `AgentComposer` | identical | shared-already | keep | |
| P11 | Pane geometry: 380px overlay vs full main area | `full` absent (overlay) | WD overlay; WW `full` (`channel-surface.tsx:469`) | host-specific-in-kind | keep | one column is a real difference in kind |
| P12 | Pane divider colour / weight | `--home-panel-line` via `pages/home/home.module.css › .frame` | neutral hairline | host-specific-in-kind (CSS only) | keep | argued at `agent-panel.tsx:99-109` |

### A.5 Agents — the agent WINDOW (separate OS window)

| # | Feature | Home behaviour (path:line) | Workspace behaviour (path:line) | Classification | Action | Notes |
|---|---|---|---|---|---|---|
| W1 | Opening one | `agent-panel-controls.tsx:213` with `workspaceSlug = homeChannel.workspaceSegment` | same call, `access.workspaceSlug` | shared-already | keep | but see R-4 |
| W2 | Tab strip / rail / "+" | `pages/agent-window/index.tsx:144` › `AgentWindowTabs` — one page, one implementation | identical | shared-already | keep | window is workspace-routed but host-agnostic |
| W3 | **Held-gate card in the window** | absent | absent | *neither surface has it* | **RULING R-5** | `agent-window.tsx:383-387` states the window has never mounted `AgentControls`; the Approve/Deny card shipped 2026-09-17 inside that strip (`agent-panel-controls.tsx:258`), so an operator working in the window cannot answer a held call |
| W4 | Posture + model selects | absent from the panel | absent from the panel; **present only in the window** (`agent-window.tsx:267` › `PostureControls`, `agent-posture.tsx:53` its only importer) | *surface-specific, both hosts* | RULING R-5 | the inverse asymmetry of W3 |
| W5 | Stats block | `agent-panel.tsx:461` › `AgentStats` | `agent-window.tsx:403` › `AgentWindowStats` | **duplicated-should-collapse** | change | see C2 |

### A.6 Agent templates

| # | Feature | Home behaviour (path:line) | Workspace behaviour (path:line) | Classification | Action | Notes |
|---|---|---|---|---|---|---|
| E1 | Which rows are listed | container (unfiltered) + `shelf:"home"` (`agent-panels.tsx:102,106,325`) | `shelf:"workspace"` (`agent-templates-core.tsx:86,103`) | **host-specific-in-kind** | keep | two PLACES over one table, exclusion runs both ways (`agent-templates-core.tsx:93-99`) |
| E2 | Section shapes | `agent-panel-cards.tsx:69,133` › `TemplatePanel`+`TemplateGrid` imported from `template-section.tsx` | `agent-templates-core.tsx:205` › `TemplateSection` (same primitives) | shared-already | keep | no forked recipe (`agent-panel-cards.tsx:24-30`) |
| E3 | Editor modal | `agent-editor.tsx:278` › `TemplateEditor` | `agent-templates-core.tsx:215` › `TemplateEditor` | shared-already | keep | |
| E4 | **save() / remove() write orchestration** | `agent-editor.tsx:222-275` | `agent-templates-core.tsx:141-176` | **duplicated-should-collapse** | change | see C3 |
| E5 | Create affordance placement | per section (`agent-panels.tsx:215-219, 267-274`) | page header (`agent-templates-core.tsx:186-194`) | host-specific-in-kind | keep | reasoned both ways; sections here pre-decide the scope on purpose |
| E6 | Launch control on the template face | **absent by ruling** (`agent-panels.tsx:49-52`, tested) | absent (`agent-templates-core.tsx:42`) | shared-already | keep | one launch lane |
| E7 | Author marker (`by <member>`) | `agent-panel-cards.tsx:191` › `useContainerAuthorMarker` | not shown (workspace page has no marker call) | home-only | keep | security signal specific to a shared container (`agent-panel-cards.tsx:168-190`) |
| E8 | Teams scope | none (`agent-editor.tsx:82` `NO_TEAMS`) | `agent-templates-core.tsx:105` › `useTeams` | host-specific-in-kind | keep | Samuel 2026-09-08 |
| E9 | Share-into-channel | `agent-share.tsx` (home only) | n/a | home-only | keep | a workspace template is already in its room |

### A.7 Settings rows touching agents

| # | Feature | Home behaviour (path:line) | Workspace behaviour (path:line) | Classification | Action | Notes |
|---|---|---|---|---|---|---|
| S1 | **Unaddressed-responder row** | `channel-manage.tsx:214-228` → `settings-channel-agents.tsx:32` › `ChannelAgentsSettings`; gate is `channel.isMember` only | identical | shared-already | keep | ⚠ **no capability touches it** — `selfManagement` gates the *other* block |
| S2 | `ChannelAgentSettings` (tool profile, folder, runtime, durable launch posture) | rendered (/home passes no `selfManagement`, default `true` — `channel-surface.tsx:147`) | WD rendered; **WW hidden** (`guest-channel.tsx:160`) | shared-already | keep | |
| S3 | Invite / delete rows | hidden (`relationship-record.tsx:141` `memberManagement:false`) | WD shown; WW hidden | shared-already | keep | |
| S4 | Session-state rows (peer cards' state words) | `agents-tab-cards.tsx › PeerCards` via `agents-tab.tsx:476` | identical | shared-already | keep | |

### A.8 Credits and telemetry in agent views

| # | Feature | Home behaviour (path:line) | Workspace behaviour (path:line) | Classification | Action | Notes |
|---|---|---|---|---|---|---|
| C-1 | Credits inside any agent view | **none** — the panel prints *tokens*, never credits (`agent-panel.tsx:461-483`) | none | shared-already | keep | |
| C-2 | Credit bar / credit-spend series | `/home` Overview only — `pages/home/overview-panels.tsx:334` › `CreditsBar`, `:345` `useWorkspaceEntitlements`, `:191` `TokenSpendPanel` | ⚠ **CORRECTED 2026-09-17 (00-MASTER review):** this row said *"no credits surface at all, `grep -n credit …/pages/overview/*.tsx` → 0"* and the grep does **not** return 0 — `pages/overview/index.tsx:94` reads `useWorkspaceEntitlements` and `:131` renders `<PeriodStats credits=…>` ("Credits used", this billing period). What the workspace Overview lacks is the **breakdown** (by channel / person / tool) and the token-spend panel | home-only (the BREAKDOWN, not the figure) | **RULING R-6** | out of this area's centre but it is the only place an operator sees spend |
| C-3 | Active-agent board | `pages/home/overview-agent-board.tsx:1` › `ActiveAgentBoard`, mounted `overview-panels.tsx:140` | workspace Overview has `needs-you.tsx`, `member-load.tsx` — **no agent board** | home-only | RULING R-6 | |

### A.9 Channel activity strip (sits inside the Info tab, feeds the Threads story)

| # | Feature | Home behaviour (path:line) | Workspace behaviour (path:line) | Classification | Action | Notes |
|---|---|---|---|---|---|---|
| V1 | "Channel activity" heading + strip | `pages/home/person-thread-activity.tsx:55,60` with its OWN `useOverviewSeries` at `:47` | `info-tab.tsx:248,259-263` with `activityBins` handed down from `channel-surface-data.ts:366` | **duplicated-should-collapse** | change | see C4 |
| V2 | The series read | mounted twice per /home channel (surface at `channel-surface-data.ts:358`, tab at `person-thread-activity.tsx:47`) — same query key, so one network read, two hook mounts | once | duplicated-should-collapse | change | |

**Row count — section A: 79 feature rows across 9 tables** — T:15 · R:12 · G:17 · P:12 · W:5 ·
E:9 · S:4 · C:3 · V:2. Re-derive:
`grep -c '^| [TRGPWESCV]' docs/specs/workspace-parity/02-threads-artifacts-agents.md`.

---

## B. Every capability / slot / prop difference, and its ruling

`ChannelSurfaceCapabilities` (`channel-surface.tsx:111-186`) is the whole contract. Five flags.

| Flag | Default | Who passes it | Effect in this area | Ruling (doc + date) | Tag |
|---|---|---|---|---|---|
| `memberManagement` | `true` (`channel-surface.tsx:118`) | H `false` (`relationship-record.tsx:141`); WW `false` (`guest-channel.tsx:159`) | none in this area (invite/delete rows only) | Samuel 2026-08-26 — a link container takes >2 people; every add arrives by link (`relationship-record.tsx:105-110`) | home-only on purpose |
| `peerNamedHeader` | `true` (`:134`) | H `false` (`relationship-record.tsx:142`) | none in this area (header name) | 🔒 Samuel 2026-09-01 (`relationship-record.tsx:125-132`) | home-only on purpose |
| `selfManagement` | `true` (`:147`) | WW `false` (`guest-channel.tsx:160`) | hides `ChannelAgentSettings` **and** Leave, one flag two controls | Samuel ruling R2/R3 2026-08-25 (`channel-surface.tsx:139-146`) | workspace-web-only on purpose |
| `knowledge` | `false` (`:168`) | **NOBODY** | adds a 5th tab | F-340 took /home's (2026-08-27); Samuel's web ruling took the guest lane's (2026-09-04) → **F-666**, `docs/REFACTOR-FINDINGS.md:8124` | ruled absence |
| `artifacts` | `false` (`:185`) | **H only** (`relationship-record.tsx:143`) | the whole Artifacts face | 🔒 Samuel 2026-09-16, standing home-space-first ruling (`channel-surface.tsx:174-184`) | **home-first, workspace later** |

⚠ **`channel-surface.tsx:152-160` is STALE and disagrees with the code.** It says of `knowledge`:
*"EXACTLY ONE HOST PASSES IT SINCE 2026-08-27 — THE GUEST LANE"*. `guest-channel.tsx:150-161`
removed it on 2026-09-04 and the removal is the subject of **F-666**. Per `CLAUDE.md § Precedence`
this is a DOC bug, not a code bug — **fix the docblock in the same change that next touches that
file**; the finding and `knowledge-tab.test.tsx › the capability, per host` already pin the truth.

### Slots

| Slot | Default | Who passes it | Effect | Ruling | Tag |
|---|---|---|---|---|---|
| `slots.infoTab` (`channel-surface.tsx:108`) | absent → `InfoTab` | **H only** (`relationship-record.tsx:95-103` → `PersonInfoTab`) | REPLACES the Info tab body in channel view; ignored in thread view | 2026-08-25, render-function so the gate rides down | home-only on purpose |
| `ChannelInfoTabContext.gate` (`:57`) | — | minted once (`channel-surface-data.ts`) | one `useRefetchGate` per surface | INVARIANTS §7/§8 | contract |
| `ChannelInfoTabContext.mentions` (`:78`) | — | added 2026-09-15 | the slot was DROPPING an already-paid read | `channel-surface.tsx:59-77` | **precedent for V1/V2** |
| `ChannelInfoTabContext.headerEdit` (`:94`) | — | added 2026-09-17 | same failure, same fix | `channel-surface.tsx:79-94`, `surface-info-panel.tsx:84-99` | **precedent for V1/V2** |
| `webView` (`channel-surface.tsx:214`) | absent | **WW only** (`guest-channel.tsx:149`) | one column, faces behind a header dropdown; moves the agent view inside the surface | Samuel 2026-09-04 | host-specific-in-kind |
| `Link` (`channels-core.tsx:32`) | — | **WD only** (`pages/channels/index.tsx:88`) | first-run explainer's step cards | router-free-by-construction rule | workspace-only on purpose |
| `initialChannelId` / `initialThreadId` (`channels-core.tsx:40,53`) | `null` | WD from the route (`pages/channels/index.tsx:89-90`); H from `initialThreadId` only (`relationship-record.tsx:78`) | initial selection, never a route dependency | wiring plan Phases 9/10 | host-specific-in-kind |
| `onRosterChanged` (`channel-surface.tsx:201`) | absent | **WD only** (`channels-core.tsx:226`) | invalidates the channel LIST a pinned host does not have | — | workspace-only by construction |
| `onDeselect` / `onDeleted` (`:204`, `standalone:80`) | absent | H (`relationship-record.tsx:79`), WW (`guest-channel.tsx:162`) | a pinned host must stop rendering a deleted channel | — | host-specific-in-kind |
| `loadingSkeleton` (`agent-templates-core.tsx:68`) | shared page ghost | **WD agents page only** (`pages/agents/index.tsx:47`) | one shape across two gates | `agent-templates-core.tsx:58-67` | workspace-only on purpose |
| `AgentsTab.workspaceId` (`agents-tab.tsx:95`) | `null` | both, as `channel.workspaceId` (`info-panel.tsx:370`) | gates the chevron + the picker's roster | feature-detection over a READ | shared |
| `ChannelsAgentPanel.color` (`agent-panel.tsx:187`) | `null` | **H + WW only** (`surface-agent-view.tsx:54`); **WD omits it** (`overlays.tsx:73-86`) | banner + stream accent | docs/specs/agent-colors.md item 5 | **unintended drift — fix** |
| `ChannelsAgentPanel.full` (`:221`) | `false` | **WW only** (`channel-surface.tsx:469`) | main-area geometry | Samuel 2026-09-04 | host-specific-in-kind |

**Row count — section B: 5 capabilities + 13 slot/prop rows = 18.**

---

## C. Duplicated bodies to collapse, feature by feature

### C1 — the agent view is wired twice (highest value)

| | `/home` + web | workspace desktop |
|---|---|---|
| wiring site | `surface-agent-view.tsx:44-80` › `SurfaceAgentView` | `overlays.tsx:73-86` inside `ChannelsOverlays` |
| `openAgent` | `:45` | `:74` |
| `color` | **`:54-58`** (resolved off `data.liveAgents`) | **missing** |
| `sessions` | `:59` `data.agentSessions` | `:75` prop-threaded |
| `messages` | `:60` | `:76` |
| `pendingPosts` / `onPostPending` / `postBusy` | `:66,67,74` | `:77,78,81` |
| `onAnswerEscalation` / `answerBusy` | `:72,73` | `:79,80` |
| `currentUserId` / `workspaceSlug` | `:75,76` | `:82,83` |
| `onClose` / `onRefreshSessions` | `:78,79` | `:84,85` |
| `full` | `:77` (passed by the web branch) | never |

Twelve props, eleven identical, one already drifted (`color`). `SurfaceAgentView` exists **exactly
to stop this** — its own docblock (`surface-agent-view.tsx:7-12`) says *"a second hand-copy of this
wiring is how the phone and the desktop come to show different things about one agent"*, and the
prediction has come true on the third host.

**Collapse:** `ChannelsOverlays` takes `data: ChannelSurfaceData` and renders `SurfaceAgentView`
instead of `ChannelsAgentPanel`. `channels-core.tsx:241-248` already holds `data`; nine of the
overlay's props disappear with it. The create dialogs (`overlays.tsx:88-97`) stay where they are —
they are genuinely workspace-only (`overlays.tsx:13-16`).

### C2 — two stats blocks

`agent-panel.tsx:461-483` › `AgentStats` and `agent-window.tsx:403-439` › `AgentWindowStats`.
Identical `metric()` reads, identical `UsageMeter` call (`label="Context tokens"`, `used ?? 0`,
`limit ?? 0`, `tone="ramp"`, `formatTokens`), identical `line.join(" · ")` footer. **Two
differences, both parameterisable:** the window drops the `Started …` clause
(`agent-panel.tsx:471-472` vs `agent-window.tsx:409-413`) and passes `className=""` to cancel the
meter's default `mt-3` (`agent-window.tsx:427`, argued `:421-425`). Both docblocks carry the *same*
corrected history of the same 2026-08-27 ruling, written twice
(`agent-panel.tsx:474-483` ≈ `agent-window.tsx:395-402`) — which is the tell.

**Collapse:** one `AgentStats({ agent, showStarted?, className? })` in `agent-panel.tsx`, imported
by the window.

### C3 — two template write orchestrations

`agent-templates-core.tsx:141-176` (`save`/`remove`) and `agent-editor.tsx:222-275`
(`TemplateEditorMount.save`/`remove`). Same shape line for line: `setError(null)` → branch on
`template` → `draftToCreateBody` / `draftToPatchBody` → `isEmptyPatch` guard → `optimisticTemplate`
→ close on success → `agentTemplateErrorMessage` on throw. Even the *comment* justifying the
`isEmptyPatch` guard is duplicated (`agent-templates-core.tsx:149-151` ≈ `agent-editor.tsx:245-246`)
and so is the "modal stays open until the write settles" argument
(`agent-templates-core.tsx:133-140` ≈ `agent-editor.tsx:181-185`).

**Differences that are real:** the home mount adds `homeScoped` and `acknowledgeShared`
(`agent-editor.tsx:229-240,253`), takes a `shelf` (`:214`), and is mounted-per-open so `session` is
the constant `1` (`:281`, argued `:73-78`). All three are arguments, not structure.

**Collapse:** `agent-templates/hooks/use-template-save.ts` taking
`{ workspaceId, shelf?, extraCreateBody?, extraPatchBody? }` and returning `{ save, remove, error,
saving, deleting }`. Both mounts keep their own JSX.

### C4 — the channel-activity block is written twice

`info-tab.tsx:246-263` and `pages/home/person-thread-activity.tsx:55-60` render the same two
elements (`PanelHeading title="Channel activity"`, `ThreadActivityStrip bins loading
metricLabel="Messages"`), and each mounts its own `useOverviewSeries` — the surface's at
`channel-surface-data.ts:358-368`, the tab's at `person-thread-activity.tsx:47`. Same query key, so
the cost is a second hook rather than a second request; the **bug** is that /home pays for
`data.activityBins` and drops it on the floor, which is **exactly** the `mentions` failure
(`channel-surface.tsx:61-67`) and the `headerEdit` failure (`:83-90`), both already fixed by adding
the value to `ChannelInfoTabContext`.

**Collapse:** add `activity: { bins, loading }` to `ChannelInfoTabContext`
(`channel-surface.tsx:55-95`), hand it down at `surface-info-panel.tsx:199-210`, and have
`PersonInfoTab` render the shared strip. `person-thread-activity.tsx` then deletes.

### C5 — stale docblocks that will re-create duplication

Not code duplication, but the same failure mode and cheap to fix in passing:

- `pages/home/person-thread-activity.tsx:10-13` and `thread-activity.tsx:9` both still say the
  channels page renders `fixtures.ts › HARDCODED_THREAD_ACTIVITY`. **F-316 closed 2026-09-05**
  (`docs/REFACTOR-FINDINGS.md:3247`); `info-tab.tsx:249-255` records the wiring.
  `grep -rn HARDCODED_THREAD_ACTIVITY src apps` → only its own declaration
  (`fixtures.ts:93`) and those two stale comments. The constant has **no production reader**.
- `channel-surface.tsx:152-160` — the `knowledge` host claim, above.

**Row count — section C: 5 collapse items, 4 of them code.**

---

## D. UI/UX map — home vs workspace

| Element | Home | Workspace (desktop) | Workspace (web) | CSS-only or behavioural |
|---|---|---|---|---|
| **Wells: the four spans** | Recent / Last 7 days / Last 30 days / Earlier — `recency-wells.tsx:55-72`, order IS the data | identical | identical | — one module |
| **Wells: defaults** | Recent open, three collapsed (`recency-wells.tsx:56-71`) | identical | identical | — |
| **Wells: the box** | `collapse-wells.tsx:164` › `Well`, `PANEL_WELL` from `shared/ui/panel-well.ts` | identical | identical | — |
| **Wells: fill** | Threads/Agents tabs use the default `PANEL_WELL`; **/home's channel COLUMN** uses `PANEL_WELL_ON_PANEL` (`relationship-list.tsx:125`) | default | default | CSS-only, and `recency-wells.tsx:130-131` forbids a `face` on the two tabs |
| **Wells: storage key** | `dopl.threads.wells` / `dopl.agents.wells` — per surface, shared across hosts (`threads-tab.tsx:49`, `agents-wells.tsx:108`) | same keys | same | behavioural: collapsing Earlier on /home's Threads tab collapses it on the workspace page too. **Deliberate** (`well-state.ts:44-47` scopes by SURFACE, not by host) |
| **Wells: empty** | box + header + empty body, no placeholder sentence (`recency-wells.tsx:179`, `collapse-wells.tsx:341`) | identical | identical | — |
| **Wells: /home's channel column** | THREE wells — Pinned / Recent / Earlier (`home-channel-wells.ts:48-52`) | n/a | n/a | home-only in kind: a different well SET, same box |
| **Thread card** | `threads-tab.tsx:284-338` — `PANEL_CARD`, avatar stack, `Updated …`, right-aligned `CARD_BUTTON` | identical | identical | CSS-only: `.frame` recolours borders to `--home-panel-line` (`agent-panel.tsx:99-109`) |
| **Artifact list card** | `artifacts-tab.tsx:139-167` — name, 2-line summary clamp, span label, right `Open` | **not drawn** | not drawn | behavioural (gated) |
| **Opened artifact** | Back button + `ArtifactCard` + member-ceiling note (`artifacts-tab.tsx:201-229`) | not drawn | not drawn | behavioural |
| **Threads↔Artifacts toggle** | one `h-9` pill, `bg-[var(--seg-fill)]`, left of a spacer, "New thread" right (`threads-tab.tsx:163-181,197-207`) | not drawn | not drawn | behavioural; the pill's face is taken by reference from the /home header selector (`threads-tab.tsx:167-177`) |
| **Tab row** | 4 options, `SegmentedControl size="lg" variant="underline"`, 56px bar (`info-panel.tsx:431-467`) | identical | **no tab row** — header dropdown (`info-panel.tsx:398-409`, `channel-single-column.tsx`) | behavioural in kind (web) |
| **Tab badges** | threads count + active-agent count (`info-panel-tabs.ts:70-78`) | identical | identical | — |
| **Agent card face** | `agents-tab-cards.tsx › AgentCard` — colour dot, owner avatar, Open/Viewing | identical | identical | — |
| **Peer card face** | `agents-tab-cards.tsx › PeerCards` — staleness dim, `data-stale`, no timestamp (Samuel 2026-09-04) | identical | identical | — |
| **Launch row** | split button, `TAB_ACTION_SHELL` + `TAB_ACTION_INK`, 32px chevron zone, `bg-white/25` hairline (`agents-tab.tsx:264-320`) | identical | identical | — |
| **Launch panel (popup)** | `LaunchAgentDialog` on `FormDialog` (`agents-tab.tsx:330`) | identical | identical | — |
| **Held-gate card** | inside the control strip, `.auth-btn-3d` Approve / `.btn-light` Deny (`agent-held-gate.tsx:31-34`), one card per held call | identical | identical | — |
| **Agent pane** | 380px overlay, `--home-card` ground, 2px `--home-panel-line` divider | 380px overlay, neutral hairline | **full main area** (`full`) | CSS-only for H↔WD; behavioural for WW |
| **Agent pane colour banner** | **drawn** (`surface-agent-view.tsx:54`) | **not drawn** (`overlays.tsx:73`) | drawn | **behavioural drift — fix (C1/P2)** |
| **Agent window chrome** | tab strip + rail + "+", no status badges (`pages/agent-window/index.tsx:256-261`) | identical | n/a (desktop only) | — |
| **Agent window body** | `AgentWorkingOn` → `PostureControls` → `AgentStream` → `AgentComposer` (`agent-window.tsx:265-300`) | identical | n/a | — **no Pause/End, no held-gate** (`agent-window.tsx:383-387`) |
| **Info tab activity strip** | `PersonThreadActivity` (own read) | `info-tab.tsx:248-263` (handed-down bins) | same as WD | **duplicated (C4)** — pixel-identical today |
| **Record-pane frame** | `border-2 border-home-panel-line` + `home.frame` (`pages/home/index.tsx:284-285`) | `page-float` white card | `h-[100dvh]` bare (`guest-channel.tsx:99`) | CSS-only |

**Row count — section D: 24.**

---

## E. Items needing Samuel's ruling

**R-1. Does the Artifacts face go to the workspace channels page?**
Today it is /home-only by his 2026-09-16 home-space-first ruling, and the *inline* artifact card
already renders in the workspace transcript (`transcript.tsx:187`) — so a workspace reader can see
an artifact but cannot browse the channel's artifacts.
 (a) Pass `artifacts: true` from `channels-core.tsx:218` — one line, zero new code, the face's reads
 mount with the face. (b) Keep /home-only until the face has had more use. (c) Also give it to the
 guest lane, where a guest has no other way to find a folded run.
**Recommendation: (a), after F-712 is fixed** — a browse list whose span numbers are silently wrong
above ~20 members per artifact is worse on a busy workspace room than on a two-person channel.

**R-2. Does the Threads tab's Artifacts toggle stay a toggle, or become the 5th tab, on a
workspace?** The four-option width budget (`info-panel.tsx:421-430`) is a real measurement for the
380px column, and the web host has a dropdown with no width budget at all.
 (a) Toggle everywhere (one rule, the /home shape). (b) Toggle on desktop, its own dropdown entry on
 the web. (c) Fifth tab on the web only.
**Recommendation: (a)** — a face that is one control on one host and a tab on another is two mental
models for one list.

**R-3. Should thread WINDOWS (the pop-out) exist on /home?** The button is already drawn there —
`channel-surface.tsx:358` mounts it for every host — and it routes into
`/{linkContainerSegment}/thread-window/...`. Nothing pins that this resolves.
 (a) Keep it and add a pin (`resolveWorkspaceSegmentForUser` does not filter `kind`, so it should
 work; the test is missing, not the behaviour). (b) Hide it on /home via a new capability. (c) Give
 /home its own windowless expand.
**Recommendation: (a)** — verify first (see R-4), then pin; a capability to hide a working control
is code added to remove a feature.

**R-4. Verify-then-rule: do the pop-out and the agent window actually open from a /home channel?**
This survey is read-only and could not run the app. The chain is
`pop-out.tsx:71` → main → `/:workspaceSegment/thread-window` → `use-workspace-route.ts` →
`GET /api/workspaces/resolve` → `segment.ts:144`, which applies a `minRole: "viewer"` floor. A home
container's OWNER passes; a **guest-role** peer may not.
 (a) Measure, then pin both windows for a link container. (b) Assume it works. (c) Fence both
windows to standard workspaces.
**Recommendation: (a)** — this is a measurement, not a ruling, but it gates R-3.

**R-5. Where do the Approve/Deny held-gate card and the posture selects live?** Right now the
**panel** has Pause/End/Open-window + the held gate and no posture; the **window** has posture +
model and neither Pause/End nor the held gate (`agent-window.tsx:383-387`, `agent-posture.tsx`'s
only importer is that file). An operator who works in the agent window cannot answer a held call
from it.
 (a) Both surfaces get both (one `AgentControls` that takes `posture?: boolean`). (b) The held gate
moves to the window too, Pause/End stays panel-only. (c) Leave it — the notification is the window's
answer path.
**Recommendation: (b)** — the held gate is the one control whose absence stops work; a destructive
verb appearing in a window that never had one is a new control, which that docblock already refuses.

**R-6. Do the workspace Overview's agent surfaces come to parity with /home's?** /home has an
Active-agent board and a credit bar; the workspace Overview has "Needs you" and member load and no
spend surface at all.
 (a) Port `ActiveAgentBoard` (it is already fed by an account-wide payload). (b) Port the credit bar
only. (c) Neither — Overview is a different area with its own owner.
**Recommendation: (c) for this wave**, flagged here because it is the only place an operator sees
agent spend; it belongs to the Overview parity doc, not this one.

**R-7. Multi-member agent visibility on a workspace vs the one-owner home.** The Agents tab is
explicitly an **operator** surface — own agents from this machine's feed, peers as state-only cards
(`agents-tab.tsx:4-17`, `:102-104`). On /home that is one owner plus their counterparty; on a
20-person workspace channel the peer list is every member's live agents, unfiltered by thread in
channel view.
 (a) Leave it — one rule, and `peerCardsFor` already thread-scopes. (b) Cap or group the peer
section on workspaces. (c) Make peers opt-in on channels above N members.
**Recommendation: (a)** — the agent cap is 15 per workspace (2026-09-01), so the list is bounded;
revisit only if Samuel reports it as noise.

**R-8. Does the workspace channel page get the agent COLOUR banner?** This is technically a bug
(P2/C1) rather than a ruling, but it is a visible difference he may have seen.
 (a) Fix by collapsing the wiring (C1) — colour appears on the workspace page. (b) Fix the wiring
and keep colour /home-only via a flag.
**Recommendation: (a)** — colour is assigned by the server per channel and the transcript already
paints the agent's boxes in it on both hosts; a pane that disagrees with the transcript beside it is
the defect.

**Row count — section E: 8 rulings.**

---

## F. Target structure (the host contract for this area)

Nothing moves out of `src/features/channels/components/`. The change is to **stop hosts from
hand-wiring the same component twice**, and to **finish the `ChannelInfoTabContext` pattern**.

```
src/features/channels/components/
  channel-surface-data.ts      ONE hook: every read, the refetch gate, the writes.       (host mounts it)
  channel-surface.tsx          renders; owns WHICH panes.                                (capabilities + slots)
    ├ surface-info-panel.tsx   wires the tab column; mints gate-bearing context.
    │   └ info-panel.tsx       the tab ROW + the four bodies.
    │       ├ threads-tab.tsx  ── artifacts-tab.tsx  (one slot, two faces)
    │       ├ agents-tab.tsx
    │       ├ info-tab.tsx     ── or slots.infoTab(ctx)
    │       └ settings-slot.tsx
    └ surface-agent-view.tsx   THE ONLY wiring of ChannelsAgentPanel.   ← C1 makes this true
```

**The contract, stated as five rules:**

1. **A host supplies capabilities, slots, data and an identity — never a wiring.** If a host names
   more than one prop of a leaf component, the wiring belongs in a `surface-*.tsx` seam.
   `SurfaceAgentView` and `SurfaceInfoPanel` are the two that exist; `ChannelsOverlays` is the one
   that violates it (C1).
2. **Anything the surface has already READ rides down the slot context.** `gate` (2026-08-25),
   `mentions` (2026-09-15), `headerEdit` (2026-09-17) — and next, `activity` (C4). The failure is
   always the same shape: the slot replaces the body, the host pays for a read, the body it is not
   rendering is where that read was consumed.
3. **An additive capability defaults `false`; a subtractive one defaults `true`** — i.e. a host that
   passes nothing gets the workspace channels page, byte for byte
   (`channel-surface.tsx:18-20, 148-155, 169-175`). `artifacts` and `knowledge` are the two additive
   ones.
4. **A capability's reads mount with its face.** `info-panel.tsx:352-362` (artifacts),
   `:384-390` (knowledge), `settings-slot.tsx:12-18` (settings). A host that never offers a face
   issues no request — which is what makes R-1 a one-line change.
5. **Host-specific-in-kind is exactly three things here:** the single-column web layout (`webView`),
   the router `Link`/initial-selection props, and the template SHELF. Everything else in this area
   is one implementation or a bug.

**The work, in order:**

| Step | Change | Files | Why first |
|---|---|---|---|
| 1 | Fix **F-712** (`artifactSpans` server-side aggregation) | `repository-artifacts.ts` + migration/RPC | blocks R-1 |
| 2 | Collapse **C1** — `ChannelsOverlays` renders `SurfaceAgentView` | `overlays.tsx`, `channels-core.tsx` | fixes P2 drift, removes 9 props |
| 3 | Collapse **C4** — `activity` onto `ChannelInfoTabContext` | `channel-surface.tsx`, `surface-info-panel.tsx`, `person-info-tab.tsx`; delete `person-thread-activity.tsx` | the pattern's fourth application |
| 4 | R-1 → pass `artifacts: true` from `channels-core.tsx` (and the guest lane if (c)) | one line each | |
| 5 | Collapse **C2** and **C3** | `agent-panel.tsx`/`agent-window.tsx`; new `use-template-save.ts` | pure de-dup |
| 6 | R-5 — held gate reachable from the agent window | `agent-window.tsx`, `agent-panel-controls.tsx` | |
| 7 | Doc repairs: `channel-surface.tsx:152-160`, `person-thread-activity.tsx:10-13`, `thread-activity.tsx:9`; decide `HARDCODED_THREAD_ACTIVITY`'s fate | | `CLAUDE.md § Precedence` — these are doc bugs found against the code |

---

## Confidence and gaps

**High confidence (read the source on both sides):** every row in A.1–A.8, every capability and slot
in B, and C1–C4. Each cites the mount site on both hosts and, where a flag decides, the line that
passes or omits it.

**Verified by grep across the whole tree, not by inference:**
`capabilities=` has exactly four occurrences (two definitions, two passers);
`ChannelsAgentPanel` has exactly two mount sites; `PostureControls` has exactly one importer;
`knowledge:` as a capability has zero passers; `RecencyWells` has exactly two callers.

**Gaps — things this survey could not settle:**

1. **R-4 is unmeasured.** Nothing was run. Whether a /home pop-out or agent window actually opens
   against a `kind='link'` segment is a reading of `segment.ts:144` + `use-workspace-route.ts`, not
   an observation. A guest-role peer in particular may fail the `viewer` floor.
2. **No test-file audit.** The 47 `*.test.tsx` files in the shared tree were not read, so where a
   parity claim is already pinned (and where porting would break a pin) is unknown.
   `knowledge-tab.test.tsx › the capability, per host` and `agents-tab-launch.test.tsx` are named in
   source comments and were taken on trust.
3. **CSS not diffed.** Section D's "CSS-only" verdicts rest on the docblocks in
   `agent-panel.tsx:86-109` and `pages/home/index.tsx:260-286`; `home.module.css` and
   `globals.css` were not read rule by rule, so a scoped `.frame` rule could be doing more than
   recolouring.
4. **Server side only sampled.** `service-artifacts.ts` and the artifacts route were read for
   fold/dissolve and the guest floor; `service-tasks*`, the launch-directive lane and
   `service-wake-verdict*` were not, so A.1/A.3 are **client-surface** parity, not end-to-end.
5. **The Overview area (C-2, C-3, R-6)** is outside this brief and is reported only where it is the
   sole surface for agent spend. Its own parity doc owns it.
6. **`HARDCODED_THREAD_ACTIVITY` (`fixtures.ts:93`)** appears to have no production reader. Measured
   once, on 2026-09-17, with `grep -rn`. Re-derive before deleting — `bits.tsx › agentAccent`
   (F-711) is the cautionary precedent for exactly this shape.
