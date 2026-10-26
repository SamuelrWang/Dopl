# Channel page + shell port, and channel tasks (plan, 2026-10-26)

Port the UI-staging channel page (`/playground/channels`) and the app background into the real
desktop app, and build channel tasks end to end (DB, server, SDK, MCP, desktop, UI). Desktop
scope: **the app background/shell and the channel page only.** Nothing else in the desktop app
changes.

Sources: two read-only inventories run 2026-10-26 (UI deltas + reverse gaps; backend/MCP slice).
Anchors are `path › symbol`.

## 1. Principles (every worker brief carries these)

1. **Staging is the visual spec, the product is the logic.** Port by restyling and restructuring
   the PRODUCT components (`src/features/channels/components/*`, `src/shared/ui/*`,
   `apps/desktop-ui/src/pages/home/*`). Never replace a product component with a staging copy:
   staging stubbed handlers, states and gates (see §4), and those must survive.
2. **One implementation.** A face used twice is one shared component. No forks per surface, no
   "v2" next to v1.
3. **Delete, don't layer.** Each slice deletes the faces, classes, tokens, tests and doc anchors it
   replaces in the same commit, plus comments that mention removed UI. No commented-out code, no
   tombstones.
4. **Comments only where the code cannot say it.** No narration, no history in comments (history
   goes in ENGINEERING.md), no restating the code.
5. Tokens/kit only (DESIGN-SYSTEM.md), the identity look (DESIGN-LANGUAGE.md), 500-line cap,
   kit recipes in both `globals.css` and `kit.css` (`check-css-token-drift`).
6. Targeted gates per slice; one full Definition of green before any push (CLAUDE.md).
7. Max 2 Opus workers at once, one worktree each, gates under `lockf /tmp/dopl-gate.lock`, commit
   by path, no push, no migration applied, no release without Samuel's word.

## 2. Rulings needed before code (recommendation first)

| # | Question | Recommendation |
|---|---|---|
| R1 | Storage name for tasks: `task` already means **thread** in storage (`channel_tasks`, `/tasks` routes, `task_*` kinds, INVARIANTS §5) | `channel_work_items` in storage; "Tasks" in UI and MCP |
| R2 | Blast radius: the restyled product components also render on the workspace channels page, thread/agent pop-outs, the web guest lane and the landing hero demo | Accept it: one channel UI everywhere. The landing demo then shows product faces directly and its DOM swaps (`banner-demo/demo-swap.ts` + swap faces) are deleted |
| R3 | Profile pill: staging white photo + first name vs the 2026-09-15 ruling (black pill reading "Profile") | Staging look (it is the newer design), unless you want the ruling kept |
| R4 | Settings tab: staging shows Add members + Delete channel; /home hides both today (`memberManagement: false`) | Keep product behaviour (hidden on /home) |
| R5 | MCP verb: "reopen" is a banned word on the MCP surface (`law-removed-vocabulary.ts`) | `action="set_status"` (open / in progress / resolved); UI button still says Reopen |
| R6 | Live updates for tasks | Publish the parent table only (INSERT/UPDATE doorbell; child writes bump `updated_at`) + a tasks-only `doorbellScope` arm |
| R7 | Assigning a task to an agent | Also posts an ordinary addressed channel message through `postMessage`, so the agent wakes |
| R8 | Guests (channel guests) and tasks | View + add notes; no create/assign/resolve |
| R9 | Peer agents have no runtime on `ChannelSessionState`, so the runtime badge cannot show for peers | Add `runtime` to the pushed session projection (small, additive) |
| R10 | Deletion of tasks | None over MCP (repo rule); app-only delete of a whole task later if wanted, not in this wave |
| R11 | Staging tree is untracked in git, so worktrees cannot see the spec | Commit it to local master first (with the menu-width fix), Phase 0 |

## 3. Phases

Two lanes run in parallel: **UI lane** (one Opus worker at a time) and **Backend lane** (one Opus
worker at a time). Each phase ends with my review of the diff, targeted gates and a patch you look
at on :3100 before the next phase starts.

### Phase 0: groundwork (me + one worker, small)

- Commit to local master: `fix/menu-fit-width`; the staging tree; `feat/channel-tasks-staging`'s
  feature commits.
- Playground: delete Overview Current and Version D (faces, files, toolbar options, tests, PORTING
  rows); Version E becomes the only overview face.
- Freeze `channels-staging` as the spec for this port (no more design edits there without a ruling).

### Phase 1: shared primitives (UI lane) ‖ contracts + migration (Backend lane)

UI, all in `src/shared/ui/` + kit:
- `IdentityFace`: move `onboarding/components/paired-avatar.tsx › PairedAvatar` to shared, make it
  span-safe (valid inside `<p>`), optional runtime badge, presence dot, keyed on
  `lib/agent-colors.ts › AgentColorKey`. Replaces five copies (`TaskFace`, `identities-staging`
  fork, `stagingIdentityFace`, `demo-identities › identityFace`, `demo-swap › colorSlot`).
- One status pill, one meter (extend `usage-meter`), one card + one well kit recipe, one pill-button
  family, avatar stack, empty state, breadcrumb. Collapses the ~6 card / 4 well / 5 pill /
  3 meter variants listed in the inventory.
- Missing type steps as tokens (13px etc.); no literals.

Backend S1:
- `packages/contracts/src/work-items.ts` (status, subtask state, actor
  `{kind:"person",userId} | {kind:"agent",userId,agentId}`, DTOs).
- Migration `channel_work_items`, `_steps`, `_notes`, `_assignees` modelled on
  `20260926120000_channel_artifacts.sql` (RLS on, service-role only, `DO $$` assertions, rollback
  header; parent published per R6). Written, NOT applied.
- Regenerated `src/shared/supabase/types.ts`; `schema-sql.test.ts` counts; CHECK-set pin.

### Phase 2: shell background (UI lane) ‖ server + SDK (Backend lane)

UI: `apps/desktop-ui/src/pages/home/{index.tsx, home-header.tsx, relationship-list.tsx,
home-search.tsx, home-settings-control.tsx, home-skeleton.tsx, home.module.css}`,
`shared/ui/{home-channel-row, home-card-marks, page-action-button, segmented-control}`,
`.page-float` + ACCOUNT PALETTE SKIN in `globals.css`/`kit.css`:
- Panel/pane surfaces and 1px lines, underline top tabs, New channel / Search / Profile pills (R3),
  channel rows as cards with ink selection, plain well headings.
- Needs a per-face seam: the record pane box hosts all five /home faces; the white-pane surface is
  channels-only.
- Keep: wells persistence, `LinkOutChip`, initials fallback, "No channels yet", real `<button>` rows.
- Update `frame-palette.test.ts`, `frame-skeletons`, `page-skeletons`, `panel-buttons` pins.

Backend S2 + S3: repository/service/DTO/errors/http-mapping, route
`src/app/api/channels/[channelId]/work-items/route.ts` (GET list/detail, POST action union),
author from `ctx` + `ctx.sessionId`, idempotency via `client_msg_id`, route floors, write-gate and
mapping pins; SDK `packages/dopl-client/src/channel-work-items.ts` + committed `dist/`.

### Phase 3: channel page restyle (UI lane, three serial slices)

Each slice restyles product components in place and deletes what it replaces (old faces, matching
demo swap faces + `marketing.css` rules, stale comments, doc anchors).

1. **Transcript + composer:** `thread-card-row` (keep fan-out addressee pills, markdown preview,
   bridge-gated Launch agent, correct "Opened by"), `display-card`/`display-choice`/
   `escalation-card-face` (keep every block type, Save-as-template, Replaced, rollback, legacy face
   handling), `attribution-pill` (keep outside-session / via provenance), composer + working-agent
   chips, avatar sizes at call sites (not CSS overrides).
2. **Info column:** `agents-tab-cards`, `thread-info-tab`, `thread-activity` empty cells, settings
   (`settings-tab`, `settings-agent*`, `settings-desktop-rows`, `settings-channel-agents`,
   `thread-settings-tab`, `select-menu` `bare` variant). Keep: rename/delete agent, diag line,
   catalog model labels, posture warning, folder picker, bridge gating, "Nothing to manage",
   R4 gating, real writes.
3. **Agent view:** `agent-panel` header, `agent-stats`, stream boxes, `agent-composer`. Keep:
   `AgentControls`, `AgentHeldGates`, consent `pendingPosts`, display answers, drafts/ended state,
   `var(--info-w)` width, `--home-card` ground.

Must stay intact throughout (the reverse-gap list): loading/error/empty states, `Crossfade`,
unread clear, home memory, search/activity jump, realtime + presence, info slide + resize handle,
older-history paging, pop-out, peer activity, web single column, **outbound consent review
(INVARIANTS §6)**, display answers, `useThreadWrites` + mutation gate + attachments/dictation,
header/info-card edit, launch from Agents tab, roster Remove/Leave + Link out.

### Phase 4: tasks UI (UI lane) ‖ MCP + desktop lanes (Backend lane)

UI (needs S2):
- Hooks `use-channel-work-items` + writes on `useApiMutation`; query keys; `refetchAll` +
  `live.ts` arm; `channel-surface-contract` capability.
- Tabs: **Info, Threads, Agents, Tasks, Settings** (Tasks left of Settings) in `info-panel-tabs`,
  `info-panel`, `channel-record-skeleton`.
- Tasks tab list + detail (header, assignee stack with presence, From chip, Resolve/Reopen,
  subtasks, notes using `ComposerInputRow face="pill"`), and the quick-view pill + pop-up in a real
  right-end slot of `composer-recipients.tsx` (no `:has()` reach), right-aligned to the composer.
- Built from Phase 1 primitives only.

Backend S4 (MCP): `dopl_manage_task` (create, update, set_status, assign, unassign, add_subtask,
update_subtask, add_note) bound to legacy `dopl_channel:task.*`; reads as a `tasks` selector on
`dopl_get_channel`; `tools/channel-ops-task.ts`; `gating.ts` write op; budget ceilings with dated
reason; pulled doctrine `dopl://doctrine/tasks`; results hand the next handle. `tools/channel.ts`
(466 lines) splits.
Backend S5 (desktop main): regenerated `dopl-tool-table.json`, `session-own-outbound.js` +
`auto-outbound-task` reason, `ui-sync-core.js › SYNC_TABLES`, R9 runtime field, their `.mjs` tests.

### Phase 5: sweep, docs, green

- Dead-code sweep against the inventory list (product faces, `HOME_CARD_FACE`, `PANEL_WELL_ON_PANEL`
  uses, `SegmentedControl variant="plain"` if unused, demo swaps, `DemoHomeHeader/DemoChannelList`,
  playground `channels-pane.tsx`, staging-only CSS overrides), unused exports (`knip`), stale docs.
- Retire `channels-staging` copies that the product now covers (keep the route only if you want a
  playground of the real components).
- INVARIANTS §1A/§5/§6/§7/§10/§11/§12/§14, DESIGN-SYSTEM, DESIGN-LANGUAGE, ENGINEERING (why), the
  Dopl Development KB, REFACTOR-FINDINGS for anything deferred.
- One full Definition of green (`grep -n 'run:' .github/workflows/ci.yml`), then your call on
  migration apply, push, web deploy, desktop release (web before desktop; publication and
  subscriber ship together).

## 4. Known risks

- **Landing demo** re-faces product markup by DOM selectors; restyles break or double-face it, and
  `demo-class-coverage.test.tsx` needs new recipes in compiled `globals.css`. R2 resolves this by
  deleting the swaps.
- **Pinned files at the cap:** `frame-palette.test.ts` 500, `composer-recipients.test` 500,
  `composer-launch.test` 500, `transcript.test` 499, `channels/types.ts` 497, `agents-tab.test` 497,
  `agent-panel.tsx` 471. Expect splits.
- **Unguarded mirrors:** ACCOUNT PALETTE SKIN rules are hand-mirrored between `globals.css` and
  `kit.css` with no gate (F-074).
- **`check-bridge-caller-drift`** matches names across `src/`, so staging can mask a dropped product
  caller until staging is retired. Workers check callers explicitly.
- **`check-doc-refs`** fails on deleted symbols that docs anchor; docs update in the same commit.
- MCP budget ratchets (`tool-budget.test.ts`) need a dated raise for +1 tool.

## 5. Order and parallelism

```
P0 ─┬─ P1 UI primitives ── P2 shell ── P3.1 ── P3.2 ── P3.3 ── P4 tasks UI ─┬─ P5
    └─ P1 S1 contracts/DB ── P2 S2+S3 server/SDK ── P4 S4 MCP ── S5 desktop ─┘
```

UI lane owns `src/features/channels/{components,hooks,client}`, `src/shared/ui`, desktop
`pages/home`, CSS. Backend lane owns `channels/server`, `schema-*`, routes, `packages/*`,
`supabase/`, `dopl-desktop-app/main`. Shared files (`channels/types.ts`, `constants.ts`) belong to
the Backend lane; the UI lane only imports them.
