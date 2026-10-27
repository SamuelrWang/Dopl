# Popups staging — porting map

`/popups` (`src/app/popups/page.tsx` → `popups-catalog-page.tsx`) stages every global desktop popup
and pop-out window that no single /home face owns, on fake data, inside the shared UI-staging frame.
The catalog is a plain list of buttons; each opens the same instance the frame's own trigger opens
(`ui-staging/staging-popups-provider.tsx`).

Since 2026-10-26 the popups are the PRODUCT components (the playground is "bringing the playground up
to speed for today, like what the desktop looks like", Samuel). They read the playground bridge
(`ui-staging/staging-bridge.ts`), so a design change here is a change to the product file.

## Product, mounted directly

| Popup | Product file | Opens from |
|---|---|---|
| New channel | `src/features/home/components/channels/new-channel-dialog.tsx` | header "New channel", catalog |
| Settings (all seven rows) | `src/shared/layout/settings-modal/desktop-settings-modal.tsx` via `home/components/shell/home-settings-control.tsx` | header Profile pill, catalog (`openStagingSettings`), `/overview` |
| Request workspace access | `src/features/workspaces/components/request-workspace-access-dialog.tsx` | the account rail's "+" (`shared/layout/app-shell/account-rail-core.tsx`), catalog |
| Add person, Remove / Leave, Link out + Revoke | `home/components/channels/{add-person-dialog,person-roster-actions,link-out-panel}.tsx` | the catalog's People card, `/channels` |
| Runtime sign-in prompt | `src/features/channels/components/runtime-sign-in-prompt.tsx` | catalog (`raiseStagingSignInPrompt`) |
| Incoming toasts | `src/features/notifications/components/incoming-toasts.tsx` | catalog toast buttons |
| Search popup | `src/features/search/components/header-search.tsx` (in the product header) | header, catalog |

## Kept as copies, and why

| Staging file | Source | Why |
|---|---|---|
| `pages/thread-window/index.tsx` | `apps/desktop-ui/src/pages/thread-window/index.tsx` | a routed SPA page (`react-router`, `#/hooks/use-workspace-access`, the signed-out screen); the Next tree cannot import `apps/`. Synced verbatim apart from imports. |
| `pages/agent-window/index.tsx` | `apps/desktop-ui/src/pages/agent-window/index.tsx` | same; also the packaged `?inline` mark → `/favicons/android-chrome-512x512.png`. |
| `components/page-states.tsx` | `apps/desktop-ui/src/components/page-states.tsx` | imported by the two pages above; `react-router` → stub. Uses the shared `shared/ui/page-error.tsx`. |

Each copy starts with a `STAGING COPY of …` line. Re-sync from the source; never edit only the copy.

## Stand-ins (do NOT port)

| Staging file | Stands in for |
|---|---|
| `home-server.ts` | the `/home` write routes the dialogs call (create channel, mint / revoke a link, remove a member), plus `onStagingChannelCreated` / `onStagingLinkRevoked` for `/channels` |
| `toast-ops.ts` | main's `notifications` pair (`pushStagingToast`, `setStagingToastOpener`) |
| `stubs/desktop-shell.tsx` | `react-router` (`STAGING_WINDOW_ROUTE`), `#/hooks/use-workspace-access`, `signed-out-screen` for the window pages |
| `stubs/channel-windows.tsx` | the window bodies on the `/channels` staging store: the thread window is the record pane with `chrome="window"`; the agent window mounts the product body's parts (`AgentWorkingOn`, `PostureControls`, `AgentHeldGates`, `AgentStream`) with the composer's input row on an in-memory send (the product `AgentComposer` reaches main's `sessions.message`); `useDesktopSessions`, `agents-controls`, window-tab ops |
| `staging-popups.tsx` | the catalog's fixtures (toast faces, the People card's fake channel) and the window stand-ins |
| `popups-staging.css` | staging chrome (`.pps-*`) |
| `popups-catalog-page.tsx`, `src/app/popups/page.tsx` | the catalog route |
| `popups-catalog-page.test.tsx` | render smoke test (opens everything, no fetch) |

## Not staged

- **Signed-out screen**: it bundles the login journey and a dozen packaged desktop images.
