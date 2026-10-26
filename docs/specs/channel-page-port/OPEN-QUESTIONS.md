# Open questions (overnight run 2026-10-26)

Workers append a `## <slice>` section per question: the question, what was chosen, where.

## Phase 1 UI primitives (branch `ui/port-primitives`)

1. **Moving `PairedAvatar` whole would break the landing demo.** Its raised frame needs
   onboarding's `web-pieces.tsx › Profile`, and `banner-demo/*` (off limits this phase) calls
   `thinFrame`. Chose: the thin recipe moved to `src/shared/ui/identity-face.tsx › IdentityFace`;
   `onboarding/components/paired-avatar.tsx › PairedAvatar` keeps its props and renders
   `thinFrame` through `IdentityFace`, and keeps the raised onboarding frame. Onboarding importers
   needed no change. Retire `PairedAvatar thinFrame` with the banner-demo swaps (R2).
2. **`channels-staging/data/staging-agents.ts › stagingIdentityFace` builds face DATA (photo,
   colour, logo), not markup.** Kept as the staging data source; every renderer of it is now
   `IdentityFace`.
3. **Which badge shadow is the recipe?** Staging `TaskFace` used the bevel only; `PairedAvatar`
   and the identities fork used bevel + two drops. Chose the latter as the token
   `--raised-light-drop` (globals + tokens.css), read by `IdentityFace` and onboarding's `Face`.
   The tasks faces' badges gain that soft drop.
4. **Which status pill is THE pill?** Three faces exist: the tasks word pill, the demo agent card's
   `.lp-demo-ac-status` (2px pad, weight 500, dot) and identities-staging's white-on-hairline
   `StatusPill`. Chose the tasks geometry for `.status-pill` with an optional dot; the other two are
   not swapped (not a direct swap). Needs Samuel's pick before Phase 3 restyles agent cards.
5. **`CARD_BUTTON` lives in `channels/components/bits.tsx`** (the channels tree is the rename
   worker's this phase). Not touched; DESIGN-SYSTEM's `PILL_BUTTON` row names the family and
   leaves `CARD_BUTTON` for the channel page restyle.
6. **`AvatarStack` vs the identity stack.** Product `AvatarStack` callers (relationship list etc.)
   must not change look this phase, so `IdentityStack` was added beside it in `avatar-stack.tsx`.
   Collapse them when the product callers are restyled.
7. **Visual deltas accepted (all small, all toward the shared recipe):** settings cards
   `#ffffff` + 6/16/.04 shadow → `.white-card` (`#fefefe`, `--shadow-bento`); Add members
   initial circle and "Member" pill → `IdentityFace` / `StatusPill` (raised hairline, `--bg-inset`,
   `text-micro`); the quick view's "All tasks resolved" gains the check icon its tab twin has;
   outlined pills `#ffffff` → `--bg-overlay`; an agent with no colour key rings `neutral` instead of
   `agent-01`; an identities run with no runtime keeps its agent-colour ring (was grey);
   `PairedAvatar thinFrame` without a logo draws no badge (was a grey block).
8. **13px was already a token** (`--text-lead`); the staging literals now read it. 15px was missing
   and is `--text-heading` (both token files, DESIGN-SYSTEM type table).
9. **Pre-existing red, not this slice:** `src/shared/ui/clickable-cursor.test.ts` flags
   `ontology-staging/ontology/components/kanban-column-header.tsx` (untouched here).
   `identities-staging/page/identity-activity-panel.test.ts › scopes every rule to .uis-window` was
   red on master (unscoped `.uis-tk-idface*` and `.uis-st-people*` rules); green now, since both
   rule sets were deleted for the shared primitives.
## Rename (task → thread), branch `refactor/thread-rename`

- **Migration stamp.** `20261121180000_rename_task_to_thread.sql`: after the newest applied file and
  before the held `20261122120000` (the house rule keeps that held file last). Chose this; the new
  tasks migration must sort after it.
- **The held per-channel-numbering file reads `metadata ->> 'threadId'` now.** Its body depends on the
  rename, which sorts before it, so no re-stamp. Edited in `supabase/migrations-held/`.
- **Legacy synthetic ids.** `task-<channel>-<seq>` became `thread-<channel>-<seq>` in code, and the
  migration rewrites stored ones (`metadata.threadId`, `metadata.cites[].thread`) plus the
  `task-open-<id>` opening keys. `mcp_events.arguments` (an audit log) is NOT rewritten.
- **Desktop electron-store.** Session records, the resume map and grant state written by an older
  build carry `taskId` / `allowForTask`; the new build reads `threadId` / `allowForThread` and has no
  shim, so a pre-upgrade session loses its thread binding once. Accepted under the no-alias ruling.
- **`src/shared/supabase/types.ts`** is generated from PRODUCTION, which is not migrated yet, so the
  rename was applied in place (and `channel_tasks_stale` removed) rather than regenerated from the
  local stack, whose unrelated columns differ. The renamed tables match a local `gen types` exactly.
  Regenerate with `--linked` after the orchestrator applies the migration.
- **Floor.** `DEFAULT_MIN_VERSION` and `DEFAULT_DECLARED_LATEST` are `1.43.0`;
  `dopl-desktop-app/package.json` is untouched (the release bumps it). The clamp keeps the floor
  inert until 1.43.0 is on the feed, except when the feed is unreachable on a cold start.
- **Dropped, not renamed:** `channel_tasks_stale` (no caller since 2026-08-18; F-207 resolved).
- **Kept as `task`:** English uses (an agent's job, harness background tasks, event-loop
  (micro)tasks, work-ticket numbers like "task 11"), the Claude CLI's `Task*` tool names, Cursor's
  `task` event type, the desktop prompt tests' guards against the removed `task=` argument, and
  applied migration filenames.
- **Live redteam locally.** Supabase CLI 2.75's GoTrue trusts only its ES256 key, so the HS256
  service-role key from `supabase status` is refused; the run used an ES256 service-role JWT minted
  from the local auth container's own key (100/100 passed). CI pins CLI 2.116 and is unaffected.

## Orchestrator: production migrations
- Applied `rename_task_to_thread` to production 2026-10-26 (history version 20261026103134, statements md5 c63d4e13fd0e302d23eca782d7c8b763 = file). Pre-check: every task-named prod object was covered by the migration.
- NOT applied, not part of this port: `20261121170000_workspace_billing_plan_max.sql` is absent from production history and prod `workspace_billing_plan_check` has no `max`. Left for you.
- `drop_channels_archived_at` has no recorded prod row; its file only carries the drop as a comment, prod still has `channels.archived_at`. Left as is.

## Phase 2 shell (branch `ui/port-shell`)

1. **The 1px line is kit-wide.** `.page-float` (both kit copies) and the account palette skin went
   to the 1px hairline, so the workspace shell's panel and the other `.page-float` mounts thin too
   (a /home change that bleeds, per R12). The workspace shell's routed card
   (`app-shell.module.css › .pageCard`) still says 2px: changing it is workspace-only work, so it
   was left and `frame-palette.test.ts` pins it as is. Needs Samuel's call on R-38 parity.
2. **Profile pill's accessible name** is the visible first name; `title="Profile"`. With no
   display name it reads "Profile" over an `IdentityFace` "?" fallback. The page now gates on
   `GET /api/user/profile` (failure falls back, never errors the page) so the pill paints whole.
3. **Row details taken from staging over older rulings:** a solo channel's description is no
   longer italic (2026-09-15 ruling; staging has none); a pending link's name dims by opacity 60%
   instead of `text-text-secondary`; the selected name is semibold.
4. **Heading-to-first-row gap is 8px (staging 6px)** because the `"heading"` well keeps the shared
   collapse's 8px top bleed (`collapse-wells.tsx › WELL_FACES`); rows are 6px apart as staged.
5. **New channel is its own flat ink face (`.raise-ink`), not `PAGE_ACTION_BTN`.** The 3D page
   pill is worn by the section create buttons on the other four faces and the channel page, which
   this slice does not restyle. Collapse the two when those faces move.
6. **The landing demo still draws its own header and column** (`demo-home-faces.tsx`,
   `.lp-demo-top*` / `.lp-demo-sw*`), now the same look as the product: two implementations until
   R2's demo swap cleanup (Phase 5). The dead product-faithful `DemoHomeHeader` / `DemoChannelList`
   were deleted here. `HomeChannelRow` has no renderer outside the SPA now; it stays in
   `src/shared/ui` because the demo authors its rows as `HomeChannelRowFacts`.
7. **`--channel-divider-w` has no declarer any more**: every divider is the kit hairline, so
   `split-resize-handle.tsx`'s strip always takes its 1px fallback. The variable and
   `info-resize-handle.tsx`'s re-export can retire with the info-column slice (channels tree).
8. **Stale pointer left in the channels tree:** `channels/components/use-info-resize.ts` names
   `frame-palette.test.ts` as the `--info-w` pin; those cases moved to
   `apps/desktop-ui/src/components/app-shell/info-column.test.ts` (the 500-line split). Not edited:
   the rename worker owns that tree today.
9. **Search stays an always-open input** (staging's pill is a button that swaps in a field): it
   lifts on hover and holds still while focused (`.raise-pill:focus-within`).
10. **Worktree environment:** the main checkout's `packages/contracts` carries another worker's
    in-flight edits, and a whole-directory `node_modules` symlink resolves `@dopl/contracts` there
    (the SPA typecheck then fails on `task_*` kinds in untouched files). This worktree's
    `node_modules` is per-entry links with `@dopl/*` pointing at its own packages.
11. **Pre-existing red, unchanged:** `src/shared/ui/clickable-cursor.test.ts` still flags
    `ontology-staging/ontology/components/kanban-column-header.tsx` (Phase 1 item 9).
## Tasks backend (S1–S3), branch `feat/tasks-backend`

1. **An agent credential assigning a PEER's agent.** The R7 wake goes through `postMessage`, whose `to=`
   carve lets an agent address only its own operator's agents, so the post would 400. Chose: refuse the
   assignment (`ChannelForbiddenError`, `server/service-tasks-assign.ts › assertAssignable`). A person may
   assign anyone's agent. Alternative if wanted: assign without the wake.
2. **Which agents can be named as assignee or subtask owner.** Chose: an agent with a `channel_sessions`
   row in this channel; its operator is read off that row (`service-tasks-shared.ts › resolveTaskActor`).
   Unassign matches the agent id alone, so an ended agent can still be taken off.
3. **The wake post.** Body `Task assigned to you: <title>`, main room even when the task is linked to a
   thread, idempotency key `task-<taskId>-assign-<assigneeRowId>` (a re-assign after an unassign wakes
   again). No post for a person, for an agent assigning itself, or for an existing assignment.
4. **Subtask states do not move the task status.** Chose: none of that automation; status moves only by
   `set_status`.
5. **A guest assignee cannot resolve its own task** (R8: guests read and add notes only). Kept as ruled.
6. **Publication ahead of its subscriber.** `channel_tasks` is published by the migration, so
   `dopl-desktop-app/test/ui-sync-tables.test.mjs › nothing is published that no consumer binds` is red
   on this branch until slice S5 adds it to `main/ui-sync-core.js › SYNC_TABLES` (and the UI slice adds it
   to `channels/constants.ts › CHANNEL_TABLES` with a `live.ts` arm; `guest-realtime-rls.test.ts` then
   checks its guest arm, which the migration already has). They must ship in one release (INVARIANTS §7).
7. **`channel_sessions.runtime` has no column GRANT** — peer-visible through the DTO only, the `color`
   precedent; PostgREST cannot read it. The desktop push that fills it is S5; the MCP render is S4.
8. **Contracts now hold DTOs** (`packages/contracts/src/tasks.ts`), because both trees would otherwise
   declare the same shapes. The index header says so.
9. **The census** (`src/shared/contracts/canonical-sets.test.ts`) leaves out `TaskStatus`,
   `SubtaskState`, `TaskActor` and `TaskLink` while `features/channels-staging` declares fakes of them.
   Add them when staging retires.
10. **`src/shared/supabase/types.ts`** was merged in place from a local `gen types` (production lacks both
    migrations). Regenerate with `--linked` after the orchestrator applies them.
11. **List order** is `updated_at` descending, unfiltered or by `?status=`; any grouping is the UI's.
12. **Local live redteam** needed the rename worker's ES256 service-role JWT (CLI 2.75); 8 files, 111
    tests green including the new `channels/server/rls-redteam-tasks.test.ts`.
- Applied `channel_tasks` (history 20261026111318, md5 9fa479ac472602ecc05360e47ab5a1e2) and `channel_sessions_runtime` (20261026111323, md5 ed33512e1bb161bb8ba3e9c40ab33bc9) to production; both match their files.
- ⚠ History now holds TWO rows named `channel_tasks`: 20260727150000 (the original thread table, now `channel_threads`) and 20261026111318 (the new tasks feature). Locally the files are `20260727150000_channel_tasks.sql` and `20261121190000_channel_tasks.sql`. Anything that joins history on NAME must also match the md5. Left as is (applied files are never renamed).
- `src/shared/supabase/types.ts` was merged in place by workers; regenerate from production (`--linked`) now that all three migrations are live.

## Phase 3.1 transcript + composer (branch `ui/port-transcript`)

1. **No status dot in the thread card's header.** Staging drew `thread.status` ("Open"), but
   `ThreadStatus` is legacy and unread (`@dopl/contracts › channels.ts`: "nothing may branch on
   it"; INVARIANTS §5, threads do not close). Chose: no header status; liveness lives on the agent
   rows and the "N running" count. `channels/components/thread-card-row.tsx`.
2. **No runtime badge on the thread card's agent rows.** There is no product runtime → logo map,
   the desktop SPA serves no `/img/onboarding/*` assets, and peers carry no runtime (R9). Chose:
   `IdentityFace` with the agent-colour ring (neutral without one) and no badge.
   `channels/components/thread-card-agents.ts`.
3. **Agents compartment when the own feed is unknown.** A plain browser has no own feed
   (`sessions: null`): with no peer on the thread the card draws no compartment (unknown is not
   empty, INVARIANTS §11); with known feeds and nobody on it, "No agents yet". The pop-out thread
   window passes no feeds (thread view has no cards).
4. **"Opened by" for an agent** reads "Opened by your agent" / "Opened by Diana's agent", off the
   opening message's `authorKind` (new `ThreadCardRow.agent`); it does not name the agent.
5. **One choice face.** The decision face (letter badges + strip) and the inline face (labelled
   buttons) are both replaced by option rows, so a bare choice and a legacy decision draw the same
   rows; `isDecisionFace` is deleted. A row button's accessible name is its label, its consequence
   is `aria-describedby`. Non-choice displays wear the same content-width tag, in the same paint,
   reading "Display". `display-choice.tsx`, `escalation-card-face.ts`.
6. **Pane avatar sizes, taken literally from staging's override:** a PERSON's message pill is now
   36px (`Avatar px36`) while an AGENT's badge photo is 32px (`IdentityFace`), and the agent's name
   is `text-lead` against a person's `text-body`. Staging rendered exactly this; flag if the two
   pills should match. Roster + thread parties `px36`, peer activity + the agent stream's viewer
   `px30`. Threads-tab and creator avatars carry their own size override and were left; Agents-tab
   card avatars are slice 2's face.
7. **The send button changed for both composers.** `SendButton` is one shared face, so the agent
   bar's send is round now too (the demo's agent-view send CSS that faked it is deleted). The
   workspace channels skeleton's send ghost (`apps/desktop-ui/src/pages/channels/
   channels-skeleton.tsx`) was re-rounded to keep its pin true: a bleed, not workspace work.
8. **Working chips** are full 18px pills in the agent colour; the cycling dots still sit right
   after the name with no gap (the 2026-10-10 ruling), not the demo chip's 5px gap.
9. **Composer card radius is 20px** (the demo's), on `.white-card` with the hairline inside
   `px-3 py-2.5`, so the content box and height are unchanged.
10. **The staged decision post stays** (`channels-staging/data/decision-fixture.ts`): it is the
    page's only decision example. The scene answers it with an in-memory `async () => true`, so a
    press shows the chosen row; "You chose" needs a stored answer and does not appear.
11. **`cn` did not know `text-heading`** (Phase 1 added the step, not the merge group), so
    `cn("text-heading", "text-text-primary")` would drop the size. Added to
    `shared/lib/utils.ts`.
12. **Not split:** `composer-recipients.test.tsx` and `composer-launch.test.tsx` (500 lines each)
    are untouched by this slice and not over the cap; splitting would duplicate their mock setup.
    `transcript.test.tsx` was split (fan-out → `thread-card-fanout.test.tsx`).
13. **Still swapped in the landing demo** (later slices): `DemoAgentCards`, `DemoAgentStateRows`,
    `DemoAgentViewFaces`, `DemoStreamBoxes`, and the demo agent-view composer's pill rule.
14. **Pre-existing, unchanged:** `src/shared/ui/clickable-cursor.test.ts` red on
    `ontology-staging/.../kanban-column-header.tsx`; `check-doc-refs` asks for
    `docs/ENGINEERING.md::task-panel.tsx` to leave its baseline (not this slice's file).
## Tasks MCP + desktop main (S4, S5), branch `feat/tasks-mcp`

1. **Legacy action names.** The legacy `dopl_channel` action vocabularies must stay disjoint
   (`channel-vocab.ts`), and `artifact` / `rooms` already own `create` / `update`. So the legacy
   actions are `create_task` / `update_task`; `dopl_manage_task`'s selector says `create` / `update`
   (`tool-manifest.ts`). Every other action keeps the brief's name.
2. **`description` is granular-only** (`GranularTool.carry`, typed at 4,000), the room tools'
   precedent. A legacy `op="task"` call cannot set it; the legacy schema keeps refusing the key.
3. **Subtask `detail` is not on MCP.** The brief's param list omits it; the route supports it.
4. **Reads live on `rooms.tasks`**, not under `op="task"`, because `WRITE_OPS` gates the bare `task`
   op (every action writes). Granular: `dopl_get_channel(action="tasks", task=?)`.
5. **`to=` for a member** resolves `@handle` (display-name slug, the mention rule), email or user id
   against the channel roster in `channel-task-actor.ts`; a bare 8-character id, or `@agent-<id>`, is
   an agent. An ambiguous handle is refused with "pass the user id".
6. **Desktop lane.** All eight `task.*` actions are on the own-channel OUTBOUND lane
   (`session-own-outbound.js › OWN_CHANNEL_TASK_OPS`, reason `auto-outbound-task`); `rooms.tasks` is on
   the inbound READ set. Resolving is reversible (`set_status` `open`) and there is no delete, so the
   lane's settle bar holds. NOT added to `session-outbound-tag.js › outboundConsentShape` (bodyless
   ops stay off it, the artifact precedent), so a gated task write under `ask` raises the dock's
   permission request, not the outbound consent card.
7. **No desktop prompt change.** The spawn prompt (`prompt-framing*.js`) lists no channel ops, so
   there was no list to add tasks to. Its header still says "no `task=` argument", which predates
   tasks; left for a prompt pass.
8. **`runtime` is null when the session record carries no runtime id** (old durable records), not
   defaulted to the registry's first id.
9. **`CHANNEL_TABLES` not touched.** `ui-sync-tables.test.mjs` passes with `SYNC_TABLES` alone.
10. **Two desktop tests were red on master** from the backend merge and are fixed here:
    `live-harness-loads › forged-key list` (`taskId` added to `test/live/checks-contract.js › FORGED`) and
    `session-pill-db-contract` (the state-CHECK scan now skips `channel_task_subtasks_state_check`).
11. **`channel-addressing-rule.test.ts`** banned a `status` param (the retired agent-status op). It
    now asserts `status` is only the task status enum.

## Phase 3.2 info column (branch `ui/port-info-column`)

1. **Runtime badge assets per host.** There was no product runtime → logo map, and the packaged SPA
   is a `file://` document with no `/img/` root. Chose: one table in `src/shared/ui/runtime-logo.tsx`
   (`claude`, `codex` → the ChatGPT mark, `grok`, `muse`; anything else, e.g. `cursor`, draws no
   badge) and a per-host resolver: the web default serves `public/img/onboarding/`, the SPA provides
   `apps/desktop-ui/src/lib/runtime-logos.ts › spaRuntimeLogo` (bundled `?inline` SVGs) at
   `app.tsx`. Own agents read `runtimeId`, falling back to their server row's `runtime`; `''` (the
   default adapter) names no runtime here, so it draws no badge until the push carries one (S5).
   The thread card's agent rows (slice 1, OQ 3.1 #2) now wear the badge too, through the same
   `channels/components/agent-face.tsx › AgentFace`.
2. **Grok's badge is the onboarding `grok-logo.svg` everywhere**, including the landing demo, whose
   own faces used `/img/logos/grok-bot.png`. The demo and staging face tables now read the shared
   table (`webRuntimeLogo`), so the demo's swapped boxes and the product cards cannot disagree.
3. **One status pill: `StatusPill` (Phase 1 geometry, regular weight).** The Agents-tab cards, the
   thread Info rows, the thread card rows and both agent-view face swaps wear it through
   `agent-bits.tsx › AgentStatusPill` (`working` → green dot, else neutral). Deltas vs the demo's
   `.lp-demo-ac-status` (deleted): weight 400 not 500, and `waiting` no longer has a darker dot than
   `idle`. The thread Info tab's "Opened by" / "Addressed to" side pill is the same pill, dotless.
4. **An ended own agent's card says "Ended" on that status pill**, not the black `AgentEndedPill`
   (staging draws it so). The slide-out header and the agent window keep the black pill (slice 3).
5. **Settings values are `bare` (caption, medium weight), against the 2026-09-10 "unbold the
   values" and 2026-09-13 "gray highlight on hover" rulings.** Staging (the newer spec) draws the
   value + muted chevron with an ink-only hover; names stay regular weight. `text` keeps the grey
   hover for its other callers (ontology editors, Usage filter). The face is pinned by
   `settings-agent-face.test.tsx` and `shared/ui/select-menu-face.test.tsx`.
6. **The bleed of the shared rows.** `AgentLaunchPostureRows` and `SettingRow` are also the profile
   popup's Configuration pane and the notifications panel: those rows now wear the `bare` values,
   the 40px row with its `px-2`, and the full-width `--border-default` hairline. Accepted under R12
   (one implementation); the Configuration pane's own "Launch agents" row moved to `bare` too so the
   pane reads as one face.
7. **`SettingRow`'s `continues` / `SettingDivider`'s `always` are deleted**: Responder is the last row
   of the Agent Settings card now, so its leading line shows by the ordinary rule.
8. **`hasActions` no longer counts `canManage` alone.** A manager of a DM with fixed membership had
   a "Channel" heading over no rows; now that card is absent and the empty state decides.
9. **The "where" line indent is 39px** (the 30px face plus its 9px gap, under the name); staging's
   33px was left from the 24px avatar it had before ask 6d.
10. **Staging settings mounts the product views, not `ChannelsSettingsSlot`.** The slot's hosts
    (`channel-manage.tsx`, `thread-manage.tsx`, the settings container) hold live writes and the
    bridge, so `channels-staging/home/settings-tab.tsx` is a stub HOST over local state with
    `settings-staging`'s launch-record stub and /home's `memberManagement: false`. Consequence:
    staging no longer shows Add members / Delete channel (R4), and its stand-in invite dialog is
    deleted. The thread delete confirm's copy is restated there (the product's lives inside
    `thread-manage.tsx`'s host).
11. **InviteDialog is not restyled.** It is unreachable on /home (`memberManagement: false`), so a
    restyle would be workspace-only work (R12). The channel/thread dialogs are already the product's
    `ConfirmDialog` / `GoPublicDialog`, which staging used verbatim.
12. **Info tab / roster unchanged.** Staging mounts the product `ChannelsInfoPanel` for it, so there
    was no visual delta to port; every listed keep (headerEdit, infoCardEdit, infoExtras, launch,
    mention marks, label swap, signal resets) is untouched.
13. **`ThreadInfoTab` takes the surface's `index` instead of `currentUserId`**, so its agent rows are
    the thread card's own list (`thread-card-agents.ts › threadCardAgents`: faces, colours, runtime,
    "Yours" / "Diana's agent"). Peers now print their display name, not the instance id.
14. **Not done here (left for their slices):** `--channel-divider-w` and `info-resize-handle.tsx ›
    DIVIDER_WIDTH_VAR` (OQ Phase 2 #7) still have no declarer; retiring them reaches
    `split-resize-handle.tsx`, its suites and an INVARIANTS paragraph. `PANEL_CARD` / `CARD_BUTTON`
    remain for the Threads and Artifacts tabs. The stale pointer in `use-info-resize.ts` (OQ Phase 2
    #8) is fixed.
15. **Pre-existing, unchanged:** `src/shared/ui/clickable-cursor.test.ts` red on
    `ontology-staging/.../kanban-column-header.tsx`; `check-doc-refs` asks for
    `docs/ENGINEERING.md::task-panel.tsx` to leave its baseline.
## Phase 3.3 agent view (branch `ui/port-agent-view`)

1. **Runtime badge through slice 2's map.** `AgentPanelHeader` takes `face: IdentityFacts`; the panel
   and `DemoAgentView` build it with `agent-face.tsx › useAgentIdentity` (owner photo, colour ring,
   `useRuntimeLogo()(agent.runtimeId)`), the hook `AgentFace` now renders through, so the header and
   the posted cards wear the badge on both hosts. A session with no `runtimeId` (the `''` default
   adapter, an older main) draws none. Only the open agent's own sessions are read, not the peer
   projection's `runtime` (`ownAgentRuntime` needs the peer list, which the panel is not handed).
2. **Whose photo.** The open agent is always the viewer's own, so its face is the viewer's photo
   (`viewerPerson`) in the agent's colour ring. The stream cards: a posted box wears that same face;
   an arriving one wears the operator's photo only when `fromOperator` (their words, or their own
   agent in its ring), otherwise initials off the resolved name (an agent ringed in `senderColor`,
   neutral without one), and none for an unknown kind. The inbound frame carries no sender id, so a
   peer's photo cannot be known. `agent-stream-inbound-box.tsx › inboundFace`. Delta: the demo's
   received card for a peer agent showed its owner's photo; it now shows initials.
3. **Label wording follows the spec.** "Message received from X" → "Received from X" and "Received
   from you" (DESIGN-LANGUAGE §4, the demo face). The nameless sentence stays "Message received"
   (a bare "Received" says nothing). `inboundLabel`.
4. **Edges.** Inbound: person black (`--surface-cta`), agent its colour, unknown or uncoloured
   `--border-strong`. Posted: the agent's colour once settled; Pending / Not sent / no colour are
   `--border-strong` (the old dark CTA banner on a pending draft is gone with the banner). The
   addressee pills are `StatusPill dot={false}` in ink, not the old translucent banner pill.
   `agent-stream-card.tsx › StreamCard`.
5. **Stats well on the same ground.** `AgentStats` is `.card-well` (`--home-card`) on the panel's
   `--home-card` ground, exactly as staged (#fbfcfc on #fbfcfd there), so the well reads by its
   padding and radius, not by contrast. The meter is `ThinMeter` in the agent's colour (slice 2's
   `color` prop; ink in the window, which threads no colour). The agent view and window no longer draw
   `UsageMeter` (the ramp fill is gone there); the window's `meterClassName=""` prop is deleted.
6. **The window shares every face.** The agent window's stats, stream cards and composer pill are
   the new faces (one implementation); its own chrome, posture row and held-gate card are untouched.
7. **The demo/staging agent view is ONE component.** The staging copy (`channels-staging/home/
   agent-view.tsx`) was the demo's plus a send and `layout="fill"`; both became props on
   `banner-demo/demo-agent-view.tsx › DemoAgentView`, which /channels and /popups now mount. It
   stays because the product panel reads narration over the bridge. It mounts the real
   `AgentControls` (no bridge: the box holds only the stats) instead of restating its box.
8. **Merge with slice 2**: one `AgentStatusPill` (both slices added the same one), one `ThinMeter`
   colour prop (slice 2's `color`; this slice's `fill` dropped), one face helper (`agent-face.tsx`).
9. **The demo has no face swaps left**, so `banner-demo/demo-swap.ts` (`useDemoSwap`, `colorSlot`),
   the `.lp-demo-record [data-lp-swapped]` rule and every `data-lp-swapped` filter are deleted.
10. **Pre-existing red, unchanged:** `src/shared/ui/clickable-cursor.test.ts` on
    `ontology-staging/.../kanban-column-header.tsx`.

## Phase 4 tasks UI (branch `ui/port-tasks`)

1. **Which hosts draw tasks.** Chose: a `tasks` capability that ADDS (default `false`,
   `channel-surface-contract.ts`), passed by /home only (`relationship-record.tsx`). The workspace
   channels page does not pass it (R12: no workspace-only work; it is a one-line opt-in), and the
   guest web lane does not, because its one column (`channel-single-column.tsx`) has no Tasks face.
   A host without it reads nothing. A guest member on /home is gated by the workspace role
   (`surface-info-panel.tsx`, `role !== "guest"`): list, detail and notes, no tick / Resolve / check.
2. **Five tabs in 380px.** No tighter-layout branch was written (INVARIANTS had asked for one): the
   row is the staging row Samuel approved, at the `underline` 22px gap, with `overflow-x-auto`.
   Measure on :3100 / the desktop; if it scrolls at 380px with three badges, the deleted `gap-1`
   tightening is the fix.
3. **The tab ask when the column is closed.** The panel mounts with the column, so a nonce it seeds
   itself misses the ask that opened it. Chose: `tasksTabSignal` counts asks since the column last
   closed (`use-channels-selection.ts › setInfoOpen` zeroes it) and the panel seeds 0 and switches
   on a RISE (`info-panel.tsx`). `openTask` also closes an open agent view, which covers the column.
4. **A message From chip in thread view.** The link carries a main-room `seq`; chose to leave the
   thread and land with the `seq:<n>` sentinel (`citationScrollTargetId([], seq)`), so the page-back
   hunt finds it if it is not loaded. In channel view it is `jumpToSeq`'s own resolution.
5. **The pill's seat.** `ComposerRecipients` now wraps its status `<p>` in a row `<div>` with a
   `trailing` slot after it (the `pb-1` moved to the row), so the pop-up is valid markup and its right
   edge is the card's with no negative margin. The slot hides when the quick view renders nothing.
6. **What a row shows for its author.** Kept staging's: the opener (or, once resolved, the resolver)
   face + "<name> opened|resolved <time>". A person is named `displayName ?? email ?? "Member"` (no
   "You"); an agent `agentFaceName` off the author index, so an agent outside the feeds reads "New
   Agent", never its id.
7. **No create / assign / due-date UI.** Agents open and assign tasks (MCP); the UI exposes only
   Resolve / Reopen, the subtask check and notes. `dueAt` is not drawn (the meta line was removed).
8. **Notes are not optimistic.** The note composer keeps the draft until the write lands
   (`mutateAsync`) and the answer's task carries the note; a refusal toasts and leaves the words.
9. **Staging is not a full API fake.** The product container (`tasks-tab.tsx`) writes over
   `useApiMutation`, so staging renders the product's presentational `TasksPanel` / `TasksQuickView`
   over its in-memory store, whose writes reuse the product's `statusExpectation` /
   `subtaskExpectation`. Staging's fake `TaskStatus` / `SubtaskState` / `TaskActor` / `TaskLink` are
   gone (it uses the contracts), so OQ tasks-backend #9's census can now list them; not done here
   (backend lane's file).
10. **Pre-existing, unchanged:** `src/shared/ui/clickable-cursor.test.ts` red on
    `ontology-staging/.../kanban-column-header.tsx`; `apps/desktop-ui/src/components/skeletons/
    page-skeletons.test.tsx › the channels ghost byte-shares …` red since slice 1 restyled the composer
    card (it still expects `raised-tab … rounded-[14px]` in `composer.tsx`; outside this slice's gates).

## Port review fixes, backend (branch `fix/port-review-backend`)

1. **Floor and shipped version agree.** `dopl-desktop-app/package.json` (and its lockfile) is now
   1.43.0, matching `desktop-floor.ts › DEFAULT_MIN_VERSION` / `DEFAULT_DECLARED_LATEST`. Nothing was
   built, notarized or published. Until 1.43.0 is on the release feed, the feed-derived `latest`
   (1.42.1) clamps the floor off; only a cold start with the feed unreachable serves it, and then a
   1.42.1 client is told to upgrade to the build this release publishes.
2. **Pre-rename session records** (supersedes the "loses its thread binding once" line above):
   `session-store.js › recordThreadId` takes the thread from the key's middle segment (between the
   record's channel and agent ids) when the record has no `threadId`; `taskId` is ignored. Not
   handled: a key whose middle segment is a legacy synthetic `task-<channel>-<seq>` id is not mapped
   to `thread-…` (that would be an alias); such a session resumes on an id the server no longer
   knows. Rare (legacy-id threads on a parked record across the upgrade); left.
3. **`metadata.assignedTaskId`.** No reader exists in the UI tree (grep of `components`, `hooks`,
   `client`, `lib`, `src/shared`, `apps/desktop-ui/src`: none). Assignment posts written before this
   branch carry `metadata.taskId`; with no reader, no migration rewrites them.
4. **`lib/task-model.ts`** (UI lane's file, unedited): its `subtaskFacts` docblock says it restates
   "the server's two derivations (`dto-tasks.ts`)"; `dto-tasks.ts` now imports it, so the docblock
   could say it is the one derivation.
5. **Wording beyond the listed sites:** `channel-framing.ts` (both untrusted headers) and
   `chats-render.ts › UNTRUSTED_ARCHIVE_HEADER` also said "changes your task"; now "changes your
   job", so every security header says the same thing. Doctrine "agents you task" became "agents you
   brief" (keeps the doctrine budget unchanged); legacy-surface snapshot re-recorded.
6. **Doc ritual:** the "Dopl Development" KB sync was not available to this worker; not done.

## Port review fixes, UI (branch `fix/port-review-ui`)

1. **Tasks pill while the first read is in flight.** The brief says the pill is hidden only when the
   channel is known to have no tasks. Chosen: shown on a failed read ("Tasks", the pop-up says it
   could not load), hidden while the first read is in flight, so an empty channel does not flash a
   pill on every open (`tasks-quick-view.tsx`).
2. **One ink pill family.** `PAGE_ACTION_BTN` and `SMALL_PRIMARY_PILL` moved from `.auth-btn-3d` to
   the staging look (`small-action-button.ts › INK_PILL_FACE`, flat `bg-surface-cta` on `.raise-ink`),
   so every page action (New channel, the /home section `CreateButton`s, Get more credits, the tab
   actions) and the profile popup's black pills changed face together. `SMALL_PRIMARY_BUTTON` (the
   popup FORMS' 8px-radius verb) and `PAGE_ACTION_BTN_LIGHT` were not in the brief and kept
   `.auth-btn-3d` / `.auth-btn-3d-light`.
3. **Staging copies of `apps/` pages are not mountable from `src/`.** The Next tree cannot import
   `apps/` (its files resolve `#/`), so `popups-staging/pages/agent-window/index.tsx`,
   `home-search.tsx` and `home-settings-control.tsx` stay copies: the agent window was already
   in sync (only `agentTabKey`'s unused export removed, in both), the other two were re-synced from
   the product.
4. **`EmptyState.children` is NOT unused** (`src/app/c/[workspaceId]/guest-channel.tsx` and both
   `knowledge-v2/detail/entry-view.tsx` pass a retry button): kept.
5. **`playground/components/panes/channels-pane.tsx` is mounted** (`playground-shell.tsx › PANES`,
   the public `/playground` page's Channels section): kept.
6. **`AvatarStack` stays** for the presence surfaces (knowledge/skill editors, teams, search rows,
   the workspace channel sidebar), justified in its docblock; /home's channel row moved to
   `IdentityStack`. Its initials are now one letter (`avatar.tsx › initialFor`).
7. **Other workers' files touched (import lines / anchors only):** `src/features/channels/server/*`
   and `schema-*.ts` (the `agent-colors` move to `src/shared/lib`), and two anchors in
   `docs/REFACTOR-FINDINGS.md` (`use-writes-shared.ts`, `page-action-button.tsx`). Not touched:
   comments naming `channels/lib/agent-colors.ts` in `dopl-desktop-app/main/*` and
   `scripts/check-css-token-drift.ts`'s header line naming the deleted landing rules.

## Landing demo tasks

1. **The end frame is the Tasks tab, not Info.** The brief asks the reduced-motion end frame to show
   the resolved task, so `hold` lands the info column on Tasks (list, Resolved group expanded).
   Chose: `demo-tasks.ts › tasksTabSignalAt` rises at `click-task`; `demo-home-chrome.test.tsx`
   now reads the Info tab's sections at `concurrent-4`.
2. **One product seam: `task-list.tsx › TaskList`'s `defaultResolvedOpen`.** A frame with no
   clicks cannot open the Resolved group otherwise. The demo passes `true`; the staging page keeps
   the product default through the same host (`banner-demo/scene-tasks.tsx`).
3. **The task copy is not on Samuel's approved script** (`demo-tasks.ts`: three task titles, six
   subtasks, two notes). No transcript line changed, so `demo-approved-copy.test.ts` is untouched.
## Staging threads + artifacts (feat/staging-threads-artifacts)

1. **The brief asked for artifacts "across the kinds the product supports (documents, code, links,
   images)". The product has no artifact kinds.** An artifact is a named, folded run of channel
   messages (`channels/types-artifacts.ts › ChannelArtifact`: name, summary, author, span), and the
   Artifacts face draws only name, summary, span and the opened run. Chose: seed 6 to 7 folded runs
   per channel whose member posts carry the variety (markdown, inline code, numbers), authored by
   people and agents from each channel's story. Where: `channels-staging/data/staging-artifacts.ts`.
2. **The Threads tab card shows title, parties (opener and target) and last activity only**; it has
   no opener preview, agent faces or activity squares. Data only was in scope, so nothing was added
   to the product card; the older threads' agents show as post authors inside each thread.
3. **#tech-debt's scripted posts are renumbered** (`seq` lifted by the count of older posts), so its
   older threads can sit below the script in seq order. Mentions are lifted with them. Where:
   `channels-staging/data/tech-debt-fixture.ts`.
## Profile popup restyle (branch `ui/profile-popup`)

1. **The New channel button's ground differs per face.** /home's panel is `--bg-overlay` on every
   face but Channels, where it is `--home-card` (`pages/home/home.module.css`). The rail took
   `--bg-overlay`: the page opens on Overview (`home-tabs.ts › HOME_DEFAULT_TAB`) and four of five
   faces wear it. The popup's pane stays `--bg-elevated`, so rail and pane are near-equal whites
   split by the `--home-panel-line` hairline. Where: `settings-modal.module.css › .nav`.
2. **"Just the words" read as no glyph too.** The rail's lucide icons are dropped with the chip
   face, matching the /home top tabs. Easy to restore if Samuel meant the face only.
3. **Left as they were (not named in the brief):** the raised glyph tiles (`DeviceGlyph`, the
   Workspaces pane's Home glyph, both `.raised-tab`), the plan badges (Current plan / Popular /
   % off and the summary's plan label), the success and past-due banners, the members `RolePill`
   on workspace rows, and `workspace-icon-uploader.tsx`'s `.btn-light` (the frozen `/settings`
   page, not the popup).
4. **`RuntimeCredentialBars`' `bars` variant is deleted, not restyled.** Onboarding stopped
   mounting it on 2026-10-14; the popup's rows were its only face.
5. **Shared beyond the popup:** `SettingsPanel` / `SettingsCard` / `SettingsRows` and
   `delete-account.tsx` also render on the web billing page (`billing-plans-pane.tsx › DeleteAccount`),
   which now wears the same flat section and white card.
6. **Rail spacing (branch `ui/profile-rail-spacing`):** items `text-lead` 13px on 28px rows → `text-title` 14px on 32px rows; `.nav` padding 12px → 28px top, 24px sides, 20px bottom; width stays 192px (words fit). Where: `segmented-control.tsx` vertical form, `settings-modal.module.css › .nav`.
## Ontology staging overhaul (branch `ui/ontology-overhaul`)

1. **Selection on a white card.** /home's channel row selects by filling ink; an ontology card is
   too large for that. Chosen: the Rows record's existing inset ink bar on the leading edge, made a
   kit state (`.select-card`) and worn by canvas cards, lane headers and Rows records alike.
2. **Canvas lanes lost their grey fill** (the Rows ruling against a grey ground holding white
   cards), and canvas cards lost their fixed 216px height: a card now previews its first three
   fields (`field-list.tsx`) above the counts footer, so heights follow content. The dotted ground
   stays as the canvas's identity.
3. **The attribute's kind stays visible**, as a muted `bare` menu after the value, rather than
   hidden until hover: hiding it would have cost the at-a-glance type and kept its width anyway.
   The ⋯ / ✕ are revealed on hover or focus.
4. **Pickers after chips read `+ Add`** (accessible names "Add knowledge" / "Add skill", so they do
   not collide with the section's "Add"); the relationship and object pickers keep `+ Link`.
5. **The Rows display moved onto kit and tokens.** The brief named `ontology-rows.css` for deletion;
   its literal neutral palette (DESIGN-LANGUAGE §2) is now the product tokens (`--text-primary`
   etc.), so Rows reads slightly cooler than it did. No shared token was retuned.
6. **Ontology white background: trial per Samuel.** Record pane `--bg-overlay` on `/playground/ontology` only (`ui-staging/staging.css › .uis-onto-pane`); grid and cards unchanged.
## Threads + Artifacts overhaul (branch `ui/threads-artifacts-overhaul`)

1. **The Threads wells lost their gray box.** Samuel ruled the gray boxes onto the Threads tab on
   2026-09-13 and "same as the channel picker" on 2026-09-17; the picker has since moved to the
   plain uppercase heading, and the brief asked for that heading. Chosen: Threads and Artifacts
   pass the plain `heading` variant (one card per item since round 2, item 8); the Agents tab
   keeps the gray `well`. Open: should the Agents tab follow? Where: `recency-wells.tsx ›
   RecencyWells`.
2. **The Threads ↔ Artifacts switch stays one button**, the white page pill beside New thread,
   labelled with where it goes. It was never a segmented control, and Samuel ruled the flip
   wording on 2026-09-16, so it was not turned into an underline pair. Where: `threads-tab.tsx`.
3. **Copy got shorter (minimal-copy ruling).** Clip notes are now one muted caption under the
   list ("Showing the most recently active threads" / "Showing the most recent artifacts"); empty
   and failed reads are `EmptyState` wells ("No threads yet", "No artifacts yet", "Could not load
   artifacts"). The empty artifacts note no longer explains that an artifact is made by folding
   messages in the transcript. Restore it as an `EmptyState` description if Samuel wants the how.
4. **No Launch agent on a thread row.** The Threads tab never had one (the transcript's thread
   card does); a row shows the thread's agents in its face stack and a live "N running" pill only.
   No per-thread activity squares exist (the strip is channel-level), so none are drawn.
5. **The in-transcript fold card is untouched.** `artifact-card.tsx › ArtifactCard` (black header
   strip, gray run box, Show more) is a separate face from the opened artifact; per the granular
   rule it was not reskinned here. Its member rows could adopt `artifact-detail.tsx`'s message row
   next, which would need face facts on `view-model-artifacts.ts › ArtifactMember`.
6. **The jump is the message's number.** Each opened-artifact message prints its `#n`; with a
   host jump wired it is a quiet button ("Show #n in the transcript") that lands through the same
   `sel.jumpToMessage` the Mentions inbox uses, opening the message's thread when it has one. The
   staging page wires its local equivalent; the landing demo passes none, so numbers are text.
7. **The artifact list's face is the folder** (`createdBy` / `createdByAgent`), not every author:
   the list payload carries no member authors. The opened artifact's meta line stacks every author
   from the members read.
8. **Round 2 (Samuel: "each item should be a separate box").** Threads and artifacts are now one
   `.white-card` each (`item-card.tsx › ItemCard`), title over one meta line with a 20px face stack,
   actions centred right; the wells are the plain `heading` variant and the `card` well variant is
   deleted. Tasks keeps its one-card list (`ROW_CARD`): it is still the Tasks design, and the Tasks
   quick view's rows sit inside one pop-up card rather than being per-item cards, so neither moved.
   An artifact card keeps its one-line summary between title and meta, so artifacts with a summary
   are one line taller than threads and than artifacts without one.
