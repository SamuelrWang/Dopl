# Channels staging → demo / desktop porting map

`/channels` (public alias `/playground/channels`) renders the **landing demo's channel face**
(`src/features/marketing/components/banner-demo/`), fully revealed (the timeline's `hold` beat:
every post, thread, session and 1:1 turn, no typing, no auto-play), inside the UI-staging window
(`src/features/ui-staging/staging-frame.tsx`), and makes it clickable on in-memory data.

The demo itself mounts the PRODUCT's channel components (`src/features/channels/components/*`)
and re-faces a few of them by portal (`banner-demo/demo-swap.ts`). Staging does the same, so
there are three layers to port to:

1. **Product components** (`src/features/channels/components/*`) — imported, not copied. A
   change there changes the web app AND the desktop (it imports them by `@/…`).
2. **Demo faces** (`banner-demo/*`) — the redesigns. Copied here where a handler had to change;
   port markup/class changes back to the demo file, and later to the product.
3. **Desktop /home** (`apps/desktop-ui/src/pages/home/*`) — the shell the demo mirrors.

## Files that are copies (port changes back)

| Staging file | Demo source | Desktop / product file it mirrors |
|---|---|---|
| `home/channel-scene.tsx` | `demo-scene.tsx › DemoScene` (record-pane half) | `pages/home/relationship-record.tsx` (record pane: message pane + info slide + agent view), mounting `channels/components/message-pane.tsx`, `info-panel.tsx` |
| `home/channel-switcher.tsx` → **moved 2026-10-22** to `ui-staging/staging-channel-rail.tsx` (this file is now a thin wrapper that passes this page's `onSelect`); port from there | `demo-home-faces.tsx › DemoChannelSwitcher` | `pages/home/channel-wells.ts` + `relationship-list.tsx` (wells + rows), `shared/ui/home-channel-row.tsx` |
| `home/thread-card.tsx` | `demo-thread-card.tsx` | `channels/components/thread-card-row.tsx › ThreadCardMessage` |
| `home/decision-card.tsx` **(new 2026-10-22, ask 6b)** | — (no demo face; this is the first) | `channels/components/display-card.tsx` + `display-choice.tsx` + `escalation-card-face.ts` (the face table) |
| `home/attribution-pill.tsx` **(new 2026-10-22, ask 6c)** | — | `channels/components/attribution-pill.tsx` (the badge face); `authored-row.tsx › ACCENT_FRAME` (the flag frame) STAYS as it is (2026-10-23 reversal) |
| `home/settings-tab.tsx` + `home/settings-dialogs.tsx` **(new 2026-10-24)** | — | `channels/components/settings-slot.tsx` → `settings-tab.tsx` (+ `settings-agent.tsx`, `settings-agent-launch-rows.tsx`, `settings-agent-rows.tsx`, `settings-desktop-rows.tsx`, `settings-channel-agents.tsx`) for channel view; `thread-settings-tab.tsx` for thread view; dialogs from `channel-manage.tsx` / `thread-manage.tsx` |
| `home/task-list.tsx` + `home/tasks-info-panel.tsx` + `home/tasks-popover.tsx` + (round 4) `home/task-panel.tsx`, `home/task-detail.tsx`, `home/task-subtasks.tsx`, `home/task-notes.tsx` **(new 2026-10-26, channel tasks)** | — (row recipe from the landing `marketing/components/ontology-windows.tsx › TasksWindow`) | NO product counterpart yet. BOTH ship together (round 2, 2026-10-26). Tasks tab (full view) → a `tasks` key in `channels/components/info-panel-tabs.ts › TABS` + `tabCount` + a body branch in `info-panel.tsx`, plus a nonce prop that switches to it. Quick view → a right-end slot on `channels/components/composer-recipients.tsx`'s row (the `working` line above the composer card) for the pill, and a pop-up anchored to `composer.tsx`'s wrapper, right edge on the card's. Both need a tasks read/write and an MCP tool for agents to open/assign/resolve tasks |
| `home/agent-card.tsx` | `demo-agent-card.tsx` | `channels/components/agents-tab-cards.tsx`, `thread-info-tab.tsx › AgentStateRow` |
| `home/agent-view-faces.tsx` | `demo-agent-view-faces.tsx` | `channels/components/agent-panel.tsx › AgentPanelHeader`, `agent-stats.tsx` |
| `home/agent-view.tsx` | `demo-agent-view.tsx` | `channels/components/agent-panel.tsx` (+ `agent-composer.tsx`) |

**Desktop dialogs live in `popups-staging/` (deduped 2026-10-22).** "Add person" (the Info tab),
"New channel" (the frame's top-bar pill, via `ui-staging/staging-popups-provider.tsx`) and the link
row's `PendingLinkCard` are `popups-staging/pages/home/{add-person-dialog,new-channel-dialog,link-out-panel}.tsx`,
the 1:1 copies (only import paths differ). This folder's earlier copies (helpers inlined, props
changed for the store) are deleted. The page sees their writes through
`popups-staging/stubs/home-writes.ts › onStagingChannelCreated / onStagingLinkRevoked`
(subscribed in `staging-channels-page.tsx`), so a new channel still lands in the column and a
revoked link row still leaves it. Port those dialogs from `popups-staging/PORTING.md`.

Imported from the demo as-is (no copy): `demo-swap.ts`, `demo-composer-chips.tsx`,
`demo-stream-boxes.tsx`, `demo-data.ts`, `demo-transcript.ts`, `demo-narration.ts`,
`demo-info-data.ts`, `demo-identities.ts`, `demo-home-rows.ts`, `demo-steps.ts`, and
`marketing.css` (via the staging frame).

Edits made in the copies (marked `STAGING` in comments):
- `thread-card.tsx`: "Open thread" opens that card's thread; "Launch agent" launches into it.
- `agent-card.tsx`: "Open" opens that card's agent (the demo had one agent to open).
- `agent-card.tsx`, `thread-card.tsx`, `agent-view-faces.tsx`: faces via `data/staging-agents.ts`.
- `agent-view.tsx`: the 1:1 composer sends (in memory, with a canned reply); `layout="fill"` (no
  slide, no header) is the body `/popups`' agent window imports.
- `thread-card.tsx` **(restructured 2026-10-22, ask 6)**: the header is the thread's NAME at the
  title's size (the literal "Agent thread" label is gone), the opening ask is the description, the
  body is the agents inside the thread (an own agent's row opens its agent view; a peer's row has
  no affordance), and both actions moved OUT of the agent rectangle into the card's footer, with
  "Launch agent" understated. CSS: `ui-staging/staging.css › .uis-tc*`.
- `thread-card.tsx` **(ask 6c)**: the box sizes to its content; the cap is on the AGENT LIST at
  three rows (`--uis-tc-row`), so the max IS the 3-agent height and an empty box is small. The
  list carries inner padding with a matching negative margin, which is what stops the scroll box
  clipping a hovered row's shadow and the first row's top edge.
- `attribution-pill.tsx` **(ask 6c, FINAL 2026-10-24: flag + photo + name + time)**: the agent's badge
  on a message. Path there: 2026-10-22 flattened the flag for a ringed `PairedAvatar`;
  2026-10-23 restored the flag ("I actually like the flag with the whole border line around the
  whole thing") and dropped the "agent" chip ("Remove the pill that says the word "agent".
  That's not needed."); 2026-10-24 dropped the small runtime icon and kept the photo ("no keep the user profile image
  only the small agent icon move"). Final: the product's `ACCENT_FRAME` flag untouched (3px,
  open on the bar side, joined to `ACCENT_BAR`), holding the operator's photo (32px, neutral
  `--raised-light-line` hairline, NO agent-colour ring, NO runtime icon), then name over time.
  Padding 5px left/top/bottom (every frame-edge → photo gap equal), 14px right; frame 48px;
  name/time centred on the photo. Port = in `AttributionPill`, for AGENT pills only: drop the
  `AgentChip`, keep the `Avatar` at 32px with the neutral hairline, padding `py-[5px] pl-[5px]
  pr-3.5`. Person pills unchanged. Keep `ACCENT_FRAME` as it is.
- **Channel activity squares (Samuel, 2026-10-24)**: the grey measured-zero squares lose their
  outline ("for the squares that are gray bc they had no activity, can we remove the borderline
  around it"). Staging makes the border transparent (`ui-staging/staging.css`, channels page
  only), so the squares stay 14px. Port = drop `border border-border-subtle` from the empty
  (`level < 0`) branch of `channels/components/thread-activity.tsx › ActivityCells`; the cell is
  still 14px since Tailwind's border-box border was inside it.
- **Surfaces (Samuel, 2026-10-24, "perfect", keep)**: on the channels page the record pane is
  #ffffff and the panel under the top bar / channel column takes the pane's old `--home-card`
  (`ui-staging/staging.css › .uis-ch-pane`). Port target: desktop `pages/home` record pane +
  `.page-float` panel surfaces.
- **Agent view context well (Samuel, 2026-10-24)**: the grey well under the agent view header
  (context tokens + meter + meta) takes the outer panel's grey, the one under the channel
  list's "Recent" heading (`--home-card`, #fbfcfc), instead of `--bg-inset` (#f1f1f1). Staging
  overrides `.lp-demo-avs-well` only on the channels page; the token is untouched. Port: the
  desktop agent panel's stats box background → the home panel surface.
- **Settings tab (Samuel, 2026-10-24: "the settings tab is blank. We need to mirror it in there.
  Also, have the agent mirror it with the new UI design.")**: it was blank because the scene
  passed no `settings` to `ChannelsInfoPanel`; the product's `ChannelsSettingsSlot` needs live
  mutations, the desktop bridge and roster reads, so `home/settings-tab.tsx` is a face over local
  state in the same slot. Mirrored row for row: channel view = Agent Settings (Runtime,
  Permissions + Details, Messaging, Tool access + shared-channel caption, Use my tools on shared
  channels, Working folder + Use default, Launch agents, Direct agents, Responder) then Channel
  (Add members, Make public/private, Delete channel, Leave channel); thread view = Thread (Mode,
  Delete thread). The product gates are kept, so the staged viewer (owner of every staged
  channel) has no Leave row, as in the product. Options, labels and help copy are the product's
  own constants, imported; Details readings are the desktop adapters' real tables, copied.
  Interactions: dropdowns and Use default change local state; Make public confirms
  (`GoPublicDialog`) then flips local visibility; Delete channel / Leave / Delete thread open the
  product's `ConfirmDialog` copy and do nothing; Add members is a STAND-IN dialog (the product
  `InviteDialog` writes memberships over the API) listing members + two staged people.
  DESIGN DELTAS vs product (port as kit recipes, `ui-staging/staging.css › .uis-st*`):
  plain text section titles, flush with the cards (2026-10-24: Samuel removed the grey chip and
  asked for "Agent Settings", capital S, as the product already spells it); each
  section is ONE white card (hairline, 12px, soft shadow) with a hairline between rows, instead of
  bare rows on the panel; dropdowns are value + chevron (`identities-staging/page/select-menu.tsx
  › bare`) instead of `SelectMenu variant="text"`; the Details well is `--home-card` (the grey
  Samuel picked for the context well) instead of `bg-bg-inset` + border; "Use default" is the
  outlined pill button; "Working Folder" becomes sentence case. Responder sits
  as the last row of the Agent Settings card (in the product it is a separate slot with no
  heading, directly under that block). The product's per-row help eye is kept.
- **Avatar sizes (ask 6d)**: message badge photo `32px`, no runtime icon (2026-10-24, ask 6c final); agent card head `d=30`; thread
  box and thread-info agent rows `d=26`. The ring and white frame cost a fixed 4px at ANY size
  (`shared/ui/identity-face.tsx › IDENTITY_RING_PX`), so d=22 left a 14px photo and a ~7px runtime logo — that
  fixed cost is why small `d` values read as dots, and it is the thing to remember on port.
  The product's own `Avatar` instances still inside the pane (Info tab roster, thread Info tab,
  peer activity, agent stream) are lifted by a SCOPED CSS rule in `ui-staging/staging.css`
  (`xs` 24→30, `sm` 32→36), because both `shared/ui/avatar.tsx` and those call sites are out of
  bounds from staging. ⚠ PORT AS THE `size` PROP AT THE CALL SITES, or a new step in
  `Avatar`'s `SIZE` table — never as the CSS rule, which exists only to reach code staging
  may not edit.
- **Structure before font styling** (`KB orchestration-guidelines › Plans/UI Standing Rules › rule 5`, 2026-10-22): the thread box's agents region is a grey WELL
  (the demo card's own `.lp-demo-tc-well` recipe, reused), its empty state is an icon + one
  phrase inside that well, and the footer is fenced by a hairline. Before this the empty box
  was three stacked lines in three font stylings with no skeleton, which is the rule's first
  named instance. Port the structure, not just the copy.
- **The Blank Space Rule** (same doc, rule 1, 2026-10-22): the decision card's full-bleed "Needs your
  decision" bar is now a content-width tag, and the thread box's agent-count line carries
  "N running" on its trailing end. Port both: a band with three words at its left edge is the
  shape the rule forbids.
- `decision-card.tsx` **(new 2026-10-22, ask 6b)**: question → context → options that each carry
  their own consequence and are themselves the button. Replaces the product card's
  `[Option A] label: description` list + `Recommended: [Option X]` paragraph + letter button strip.
  The press is LOCAL STATE here; the product writes through `use-display-writes`. CSS:
  `ui-staging/staging.css › .uis-dc*`. Fed by the hardcoded post in `data/decision-fixture.ts`.
- **Channel tasks: tab + quick view, ONE state (Samuel, 2026-10-26; round 1 built two variants
  behind `?tasks=`, round 2: "I actually think it might make sense to have both ... just have
  one state with both of them")**. Both always render:
  - FULL VIEW: `channel-scene.tsx` mounts `tasks-info-panel.tsx › StagingInfoPanel` in place of
    `ChannelsInfoPanel`: its own five-tab row (product `SegmentedControl`, counts via the
    product's `tabCount` / `activeAgentCount`), the product panel with `fullTab` for the four
    product tabs, and `task-list.tsx` for Tasks (tick = Resolve/Reopen, title, opener face +
    time, thread or message chip that opens it, assignee faces, status pill; Resolved collapsed
    under a toggle). Known delta: the Threads tab keeps its label on the Artifacts face.
  - QUICK VIEW: `tasks-popover.tsx › StagingTasksBar` is the pane's `agentActivity` node, so it
    renders on the recipients line above the composer: the product's working pills (they elide,
    never wrap) then a "4 tasks" pill at the line's right end, right edge on the composer card's.
    It opens a concise pop-up upward (active tasks only: tick, title, assignee faces), right edge
    on the card's; Hide or the pill folds it. A row opens the Info column (if closed) on the
    Tasks tab, on that task's DETAIL; "See all" lands on the list (`tasksSignal` nonce switches
    the tab; the open task is the scene's `openTaskId`, like the open thread). Round 3: the pill
    face is round 1's again (working faces + "N tasks").
  - TASK DETAIL **(round 4, Samuel 2026-10-26: subtasks, a header with description / dates /
    who is on it, and notes)**: `task-panel.tsx` swaps the list for `task-detail.tsx` in place
    (no in-panel drill-in existed in the product panel to reuse; the back control is a
    DESIGN-LANGUAGE breadcrumb, "‹ Tasks › title"). Top to bottom: breadcrumb; header (title,
    status pill, description, subtask meter + "2/4", then (round 5, Samuel: "this part looks
    too jumbled") ONE muted meta line "opener face + name · Opened date · Due date · Updated
    3m ago" and ONE hairline-fenced row: assignee avatar stack with a green presence dot on
    whoever is active now (names on hover, "N assigned"), the From chip, Resolve/Reopen at the
    right; the round-4 grey facts well and its Assigned / Active now rows are gone; round 6:
    that row is one 22px caption line, the From chip is what elides, "N assigned" never does,
    and the meta line is a `<div>`; round 8, Samuel: "i think this can be removed": the whole
    meta line (opener, Opened, Due, Updated) is GONE from the header); `task-subtasks.tsx` (ordered checks,
    title, one-line detail, owner face, state pill); `task-notes.tsx` (notes feed + pill
    composer, in memory). The list row gained a "2/4" progress mark and its title opens the
    detail. Seed content: `data/staging-task-details.ts`. Port needs subtasks + notes in the
    tasks model and MCP tools for agents to write them.
  - **Round 6 (Samuel: "Also 2 console errors")**: every face in the tasks UI is
    `shared/ui/identity-face.tsx › IdentityFace`, which renders SPANS only, because the pill's
    faces sit inside the product's recipients `<p>`.
  - **Shared primitives (2026-10-26)**: the cards are the kit's `.white-card`, empty lists
    `EmptyState variant="well"`, status words `StatusPill`, stacks `IdentityStack`, the subtask
    meter `ThinMeter`, the back control `Breadcrumb`, Resolve and the settings pills
    `PILL_BUTTON` (all `src/shared/ui`; DESIGN-SYSTEM.md lists them). Port by importing them.
  CSS `ui-staging/staging.css › .uis-tk*` + `.uis-tkd*` (the bar's `:has()` reach into the
  product row is staging-only; port it as a real slot).
- `channel-switcher.tsx`: rows select, well headings toggle. The markup now lives once in
  `ui-staging/staging-channel-rail.tsx`, because the picker became frame-level on every face
  (see `ui-staging/PORTING.md`); this page is the only caller that passes `onSelect`.
- `channel-scene.tsx`: every demo `NOOP` is wired; the composer's Send/Enter and the New thread
  dialog's Create are intercepted in the capture phase (the product hands both to
  `useThreadWrites`, a network mutation); "Add person" is the desktop dialog (popups-staging's
  copy), not a span.

Also imported by `/popups` (its thread and agent windows' bodies, `popups-staging/stubs/channel-windows.tsx`):
`store/use-staging-channels.ts`, `home/channel-scene.tsx`, `home/agent-view.tsx`,
`data/staging-query-seed.ts`, `data/staging-rows.ts`. A change here moves those windows too.

## Stand-ins (do NOT port — they replace network/Electron code)

| Staging file | Replaces |
|---|---|
| `store/use-staging-channels.ts` | the channels reads + `useThreadWrites`, the launch bridge (`use-launch-controls.ts`), the 1:1 bridge |
| `data/staging-query-seed.ts` | `GET /api/agent-identities`, `GET /api/channels/:id/artifacts`, `GET /api/devices`, `GET /api/glasses/devices` (seeded into a private QueryClient, `staleTime: Infinity`) |
| `data/tech-debt-fixture.ts` | the demo channel at its final beat (read off the demo's own selectors) |
| `data/decision-fixture.ts` | ONE hardcoded "needs your decision" post in #tech-debt (Samuel, ask 6b), as a real `metadata.display` v2 envelope with a `choice` block — the shape `dopl_request_decision` writes. Staging-only: delete it when the restyle ports. |
| `data/extra-fixtures.ts`, `data/staging-builders.ts`, `data/staging-agents.ts`, `data/staging-rows.ts`, `data/demo-imports.ts`, `data/staging-fixture-types.ts` | fake data (invented transcripts for the column's other channels, in the demo's voice) |
| `data/staging-tasks.ts` + `data/staging-task-details.ts` (round 4) + `store/use-staging-tasks.ts` **(new 2026-10-26)** | the (not yet existing) channel tasks read + resolve/reopen writes; seeded for #tech-debt only, links read off the demo's own threads/messages |
| `staging-channels-page.tsx` | page root |

## Shared frame edits (`src/features/ui-staging/`)

- `staging-frame.tsx`: new `channelColumn` prop (a face's own column in the 290px slot). The page
  no longer passes `onNew`: the frame's provider opens the shared New channel dialog.
- `staging-top-bar.tsx`: `STAGING_ROUTES` has `channels`, and every tab points at its public
  `/playground/<face>` alias.
