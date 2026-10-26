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
| `home/settings-tab.tsx` (stub HOST, not a copy) | — | Mounts the product's `channels/components/settings-tab.tsx › ChannelsSettingsTab`, `settings-agent.tsx › ChannelAgentSettingsView`, `settings-channel-agents.tsx` and `thread-settings-tab.tsx` over local state, standing in only for the write hosts (`channel-manage.tsx`, `thread-manage.tsx`, `settings-agent-container.tsx`); the launch record is `settings-staging/stubs/use-launch-selection.ts` |
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

Imported from the demo as-is (no copy): `demo-swap.ts`,
`demo-stream-boxes.tsx`, `demo-data.ts`, `demo-transcript.ts`, `demo-narration.ts`,
`demo-info-data.ts`, `demo-identities.ts`, `demo-home-rows.ts`, `demo-steps.ts`, and
`marketing.css` (via the staging frame).

**Ported to the product (2026-10-26, channel page slice 1)**: the thread card, the decision card,
the agent's message badge, the composer card + working chips, the pane's avatar sizes and the empty
activity squares are the product's own faces now (`channels/components/thread-card-row.tsx`,
`display-card.tsx` + `display-choice.tsx`, `attribution-pill.tsx`, `composer.tsx`,
`agent-activity.tsx`, `thread-activity.tsx`). The staged copies, their face swaps and their CSS are
deleted; the scene mounts the product components directly.

**Ported to the product (2026-10-26, channel page slice 2, the info column)**: the Agents-tab
cards, the thread Info tab's agent rows and both Settings faces are the product's own faces now
(`channels/components/agents-tab-cards.tsx`, `thread-info-tab.tsx`, `settings-agent-rows.tsx ›
SettingsSection`, `select-menu.tsx`'s `bare` face). `home/agent-card.tsx`, `home/settings-dialogs.tsx`,
the demo's `demo-agent-card.tsx` swap and their `.uis-st*` / `.lp-demo-ac*` / `.lp-demo-asr*` CSS
are deleted; the scene mounts the product cards and rows, and the settings tab mounts the product
views with /home's capabilities (no Add members, no Delete channel). Faces carry the runtime badge
off the sessions' own `runtimeId` / `runtime` (`data/staging-builders.ts`).

**Ported to the product (2026-10-26, channel tasks)**: the Tasks tab (list, detail, subtasks,
notes) and the composer's quick view are the product's own (`channels/components/tasks-panel.tsx`,
`task-list.tsx`, `task-detail.tsx`, `task-subtasks.tsx`, `task-notes.tsx`,
`tasks-quick-view.tsx`; the tab via `info-panel.tsx`'s `tasks` slot, the pill via
`composer-recipients.tsx`'s `trailing` slot). The staged copies and their `.uis-tk*` /
`.uis-tkd*` CSS are deleted; the scene mounts the product components over the in-memory store,
and holds the open task and the Tasks-tab ask that `use-channels-selection.ts` holds in the
product.

Edits made in the copies (marked `STAGING` in comments):
- `agent-view-faces.tsx`: faces via `data/staging-agents.ts`.
- `agent-view.tsx`: the 1:1 composer sends (in memory, with a canned reply); `layout="fill"` (no
  slide, no header) is the body `/popups`' agent window imports.
- **Surfaces (Samuel, 2026-10-24, "perfect", keep)**: on the channels page the record pane is
  #ffffff and the panel under the top bar / channel column takes the pane's old `--home-card`
  (`ui-staging/staging.css › .uis-ch-pane`). Port target: desktop `pages/home` record pane +
  `.page-float` panel surfaces.
- **Agent view context well (Samuel, 2026-10-24)**: the grey well under the agent view header
  (context tokens + meter + meta) takes the outer panel's grey, the one under the channel
  list's "Recent" heading (`--home-card`, #fbfcfc), instead of `--bg-inset` (#f1f1f1). Staging
  overrides `.lp-demo-avs-well` only on the channels page; the token is untouched. Port: the
  desktop agent panel's stats box background → the home panel surface.
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
| `data/decision-fixture.ts` | ONE hardcoded "needs your decision" post in #tech-debt (Samuel, ask 6b), as a real `metadata.display` v2 envelope with a `choice` block — the shape `dopl_request_decision` writes, drawn by the product card and answered in memory. |
| `data/extra-fixtures.ts`, `data/staging-builders.ts`, `data/staging-agents.ts`, `data/staging-rows.ts`, `data/demo-imports.ts`, `data/staging-fixture-types.ts` | fake data (invented transcripts for the column's other channels, in the demo's voice) |
| `data/staging-tasks.ts` + `data/staging-task-details.ts` + `store/use-staging-tasks.ts` | `channels/hooks/use-channel-tasks.ts` + `use-task-writes.ts` (the tasks route); contract-shaped `ChannelTaskDetail`s seeded for #tech-debt only, links read off the demo's own threads/messages |
| `staging-channels-page.tsx` | page root |

## Shared frame edits (`src/features/ui-staging/`)

- `staging-frame.tsx`: new `channelColumn` prop (a face's own column in the 290px slot). The page
  no longer passes `onNew`: the frame's provider opens the shared New channel dialog.
- `staging-top-bar.tsx`: `STAGING_ROUTES` has `channels`, and every tab points at its public
  `/playground/<face>` alias.
