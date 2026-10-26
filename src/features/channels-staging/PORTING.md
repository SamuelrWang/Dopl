# Channels staging → demo / desktop porting map

`/channels` (public alias `/playground/channels`) renders the **landing demo's channel face**
(`src/features/marketing/components/banner-demo/`), fully revealed (the timeline's `hold` beat:
every post, thread, session and 1:1 turn, no typing, no auto-play), inside the UI-staging window
(`src/features/ui-staging/staging-frame.tsx`), and makes it clickable on in-memory data.

The scene mounts the PRODUCT's channel components (`src/features/channels/components/*`) directly:
the thread card, decision card, message badge, composer and working chips, the Agents-tab cards,
the thread Info tab, both Settings faces, the agent view (`demo-agent-view.tsx › DemoAgentView`),
and the Tasks tab and quick view. A change there changes the web app and the desktop.

## Hosts (port handler changes back)

| Staging file | Demo source | Desktop / product file it mirrors |
|---|---|---|
| `home/channel-scene.tsx` | `demo-scene.tsx › DemoScene` (record-pane half) | `pages/home/relationship-record.tsx` (record pane: message pane + info slide + agent view) |
| `home/settings-tab.tsx` (stub host) | — | Mounts `channels/components/settings-tab.tsx › ChannelsSettingsTab`, `settings-agent.tsx › ChannelAgentSettingsView`, `settings-channel-agents.tsx` and `thread-settings-tab.tsx` over local state, standing in for the write hosts (`channel-manage.tsx`, `thread-manage.tsx`, `settings-agent-container.tsx`); the launch record is `settings-staging/stubs/use-launch-selection.ts` |

The channel column is the shared `ui-staging/staging-channel-rail.tsx › StagingChannelRail`
(rows select in place through this page's `onSelect`).

`channel-scene.tsx` wires every demo `NOOP`; the composer's Send/Enter and the New thread dialog's
Create are intercepted in the capture phase (the product hands both to `useThreadWrites`, a network
mutation); "Add person" is the desktop dialog.

On this page the record pane is white and the panel under the top bar takes `--home-card`
(`ui-staging/staging.css › .uis-ch-pane`). Port target: desktop `pages/home` record pane +
`.page-float` panel surfaces.

The desktop dialogs ("Add person", "New channel", the link row's `PendingLinkCard`) are
`popups-staging/pages/home/{add-person-dialog,new-channel-dialog,link-out-panel}.tsx`; this page sees
their writes through `popups-staging/stubs/home-writes.ts › onStagingChannelCreated /
onStagingLinkRevoked`. Port them from `popups-staging/PORTING.md`.

Imported from the demo as-is: `demo-agent-view.tsx`, `demo-data.ts`, `demo-transcript.ts`,
`demo-narration.ts`, `demo-info-data.ts`, `demo-identities.ts`, `demo-home-rows.ts`,
`demo-steps.ts`, and `marketing.css` (via the staging frame).

Also imported by `/popups` (its thread and agent windows' bodies,
`popups-staging/stubs/channel-windows.tsx`): `store/use-staging-channels.ts`,
`home/channel-scene.tsx`, `data/staging-agents.ts`, `data/staging-query-seed.ts`,
`data/staging-rows.ts`. A change here moves those windows too.

## Stand-ins (do NOT port — they replace network/Electron code)

| Staging file | Replaces |
|---|---|
| `store/use-staging-channels.ts` | the channels reads + `useThreadWrites`, the launch bridge (`use-launch-controls.ts`), the 1:1 bridge |
| `data/staging-query-seed.ts` | `GET /api/agent-identities`, `GET /api/channels/:id/artifacts`, `GET /api/devices`, `GET /api/glasses/devices` (seeded into a private QueryClient, `staleTime: Infinity`) |
| `data/tech-debt-fixture.ts` | the demo channel at its final beat (read off the demo's own selectors) |
| `data/decision-fixture.ts` | one "needs your decision" post in #tech-debt, as a real `metadata.display` v2 envelope with a `choice` block — the shape `dopl_request_decision` writes, answered in memory |
| `data/extra-fixtures.ts`, `data/staging-builders.ts`, `data/staging-agents.ts`, `data/staging-rows.ts`, `data/demo-imports.ts`, `data/staging-fixture-types.ts` | fake data (invented transcripts for the column's other channels, in the demo's voice) |
| `data/staging-tasks.ts` + `data/staging-task-details.ts` + `store/use-staging-tasks.ts` | `channels/hooks/use-channel-tasks.ts` + `use-task-writes.ts` (the tasks route); contract-shaped `ChannelTaskDetail`s seeded for #tech-debt only |
| `staging-channels-page.tsx` | page root |

## Shared frame (`src/features/ui-staging/`)

- `staging-frame.tsx`: the `channelColumn` prop (a face's own column in the 290px slot); the frame's
  provider opens the shared New channel dialog.
- `staging-top-bar.tsx`: `STAGING_ROUTES` has `channels`, and every tab points at its public
  `/playground/<face>` alias.
