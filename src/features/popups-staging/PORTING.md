# Popups staging — porting map

`/popups` (`src/app/popups/page.tsx` → `popups-catalog-page.tsx`) stages every global desktop popup
and pop-out window that no single /home face owns, on fake data, inside the shared UI-staging frame.
The catalog is a plain list of buttons. `staging-popups.tsx` wraps each popup in the
`{ open, onClose }` contract, and the frame (`ui-staging/staging-popups-provider.tsx`) mounts them
on their real triggers on EVERY staging page: top bar "New channel", search and profile pills, the
rail's "+", toast clicks (table in `ui-staging/README.md`). The catalog's buttons open those same
instances through `useStagingPopups()`.

Every copied file starts with a `STAGING COPY of …` line. Only import paths differ from the source:
data hooks, desktop libs and the unstaged channel bodies point at `./stubs`. Copies are of the tree
as of 2026-10-22. The Settings modal lives in `src/features/settings-staging/` (its own
PORTING.md).

## Copied UI (port these back)

| Staging file | Source | Opens from `/popups` |
|---|---|---|
| `pages/home/new-channel-dialog.tsx` | `apps/desktop-ui/src/pages/home/new-channel-dialog.tsx` | "New channel" (= the frame's top-bar pill on every page) |
| `pages/home/home-search.tsx` | `apps/desktop-ui/src/pages/home/home-search.tsx` | "Search popup" (= the frame's search pill; type to see fixture results) |
| `pages/home/home-settings-control.tsx` | `apps/desktop-ui/src/pages/home/home-settings-control.tsx` | the black "Profile" pill; its `openHomeSettings` registry drives the seven Settings buttons |
| `pages/home/add-person-dialog.tsx` | `apps/desktop-ui/src/pages/home/add-person-dialog.tsx` | "Add person" inside the People card (also `/channels`' Info tab) |
| `pages/home/person-roster-actions.tsx` | `apps/desktop-ui/src/pages/home/person-roster-actions.tsx` | Remove / Leave confirms in the People card |
| `pages/home/link-out-panel.tsx` | `apps/desktop-ui/src/pages/home/link-out-panel.tsx` | the open invitation + Revoke in the People card (also `/channels`' link row, `PendingLinkCard`) |
| `pages/home/home-rows.ts` | `apps/desktop-ui/src/pages/home/home-rows.ts` (PARTIAL: `displayUrl`, `linkGrantLabel`, `linkUsesLabel` only) | — |
| `components/app-shell/account-rail.tsx` + `.module.css` | `apps/desktop-ui/src/components/app-shell/account-rail.tsx` + `.module.css` | the rail strip; its dashed "+" opens the gate (packaged `dopl-mark.png` → `/favicons/android-chrome-512x512.png`) |
| `features/workspaces/components/request-workspace-access-dialog.tsx` | `src/features/workspaces/components/request-workspace-access-dialog.tsx` | "New workspace (request access)" (= the frame rail's "+") |
| `components/runtime-sign-in-prompt.tsx` | `apps/desktop-ui/src/components/runtime-sign-in-prompt.tsx` | "Runtime sign-in prompt" (raises Grok's) |
| `features/notifications/components/incoming-toasts.tsx` | `src/features/notifications/components/incoming-toasts.tsx` | the four "Toast: …" buttons push through it as main would |
| `components/page-states.tsx` | `apps/desktop-ui/src/components/page-states.tsx` | the windows' Loading / Error states |
| `pages/thread-window/index.tsx` | `apps/desktop-ui/src/pages/thread-window/index.tsx` | "Thread window" (also a `thread:*` toast click) |
| `pages/agent-window/index.tsx` | `apps/desktop-ui/src/pages/agent-window/index.tsx` | "Agent window" (real tabs and rail; also a `consent:*` / `resume` toast action) |

The desktop dialogs `new-channel-dialog`, `add-person-dialog` and `link-out-panel` are the ONLY
staged copies of those files (2026-10-22 dedupe): `/channels` used to carry its own partial copies
(inlined helpers, props changed for its in-memory store); they are deleted and `/channels` imports
these. To let a page with its own rows see the writes without changing the copies, `stubs/home-writes.ts`
exposes `onStagingChannelCreated` / `onStagingLinkRevoked` listeners (`/channels` subscribes).

## Imported, not copied

`@/features/search/components/search-popup` (+ rows/sections, fed by `search-fixtures.ts`),
`@/features/channels/components/agent-window-shell` (+ chrome, rail, frame), `agents-model`,
`use-agent-launch`, `launch-agent-dialog` (the agent window's "+"), `view-model › indexMembers`,
`@/shared/ui/{form-dialog,standard-dialog,confirm-dialog,toast,select-menu,…}`,
`@/shared/layout/app-shell/app-shell.module.css`.

From `/channels` staging (imported, not copied; see `channels-staging/PORTING.md`): the window
bodies use `channels-staging/store/use-staging-channels.ts`, `home/channel-scene.tsx ›
StagingChannelScene` (the thread transcript) and `data/staging-query-seed.ts`. The agent window's
body is the landing demo's `marketing/components/banner-demo/demo-agent-view.tsx › DemoAgentView`
(`layout="fill"`), which mounts the product's agent view parts.

## Stubs and staging-only files (do NOT port)

| Staging file | Stands in for |
|---|---|
| `stubs/home-writes.ts` | `apps/desktop-ui/src/pages/home/home-writes.ts` (create channel, mint/revoke link, remove member; in-memory) + the page listeners above |
| `stubs/desktop-shell.tsx` | `search-client › apiSearchFetcher` (→ fixtures), `use-boot-state › BootPayload`, `#/components/settings-modal` (→ `StagingSettingsModal`), `#/hooks/use-workspace-access`, `react-router` (the window route = the demo's own agent in its open thread, `STAGING_WINDOW_ROUTE`), `signed-out-screen` |
| `stubs/channel-windows.tsx` | `use-desktop-sessions`, `agents-controls`, `spa-bridge-window` tab ops, and the window bodies `ChannelsThreadWindow`, `ChannelsAgentWindow`, `AgentWindowLaunch`, built from `/channels` staging (one in-memory store per open window) |
| `stubs/spa-bridge.ts` | `@/shared/lib/spa-bridge › getSpaBridge` (notifications pair) + `pushStagingToast` + `setStagingToastOpener` (the frame routes toast clicks to the windows) |
| `staging-popups.tsx` | the `{ open, onClose }` wrappers, `StagingSearchField` (the top bar's in-place search), fake channel/member/link, the window stand-in |
| `popups-staging.css` | staging chrome (`.pps-*`) |
| `popups-catalog-page.tsx`, `src/app/popups/page.tsx` | the catalog route |
| `popups-catalog-page.test.tsx` | render smoke test (opens everything, the windows' bodies + "+", the frame triggers, no fetch) |

## Not staged (or staged differently), and why

- **Thread and agent window bodies: staged by import (2026-10-22).** They are `/channels` staging's
  record pane and agent view, NOT copies of `channels/components/thread-window.tsx` /
  `agent-window.tsx`: the thread window shows the demo face's header (with a crumb that does
  nothing) instead of the product's `chrome="window"` pane, and the agent window body has no
  `AgentWorkingOn` line or held-gate strip. Port from the product files, not from here.
- **Signed-out screen**: it bundles the login journey and a dozen packaged desktop images.
- **The /home header strip** (`home-header.tsx`): the frame's top bar (`ui-staging/staging-top-bar.tsx`)
  owns that slot. Its two popups, search and Profile, are staged here and wired onto that top bar.
- **Workspace switcher / account menu**: the desktop's account rail has neither (tiles, then the gated
  "+"); there is nothing to stage.
