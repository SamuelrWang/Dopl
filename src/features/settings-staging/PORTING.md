# Settings staging — porting map

The desktop **Settings modal** is the PRODUCT modal (2026-10-26): the playground's header Profile pill
is `home/components/shell/home-settings-control.tsx`, which mounts
`src/shared/layout/settings-modal/desktop-settings-modal.tsx` (with `desktop-account-actions.tsx` and
`desktop-billing-pane.tsx`) and every pane's product core. There are no copies; a design change here is
a change to the product file. Open it on a section and a billing plan with
`ui-staging/staging-popups-provider.tsx › openStagingSettings(section, plan)` (`/popups`' buttons,
`/overview`'s "Get more credits").

## Stand-ins (do NOT port)

| Staging file | Stands in for |
|---|---|
| `settings-server.ts` | every route the modal's panes call (workspaces, profile, billing status / invoices / cancel / change-plan / portal, devices, agent apps, glasses, notification preferences, the workspace-access request), in memory; `setStagingBillingPlan` picks the billing plan |
| `desktop-ops.ts` | main's `runtimeAuth` (the sign-in bars and the app-level prompt; `raiseStagingSignInPrompt`) and `channels.{get,set}AgentDefaults` / `{get,set}LaunchPosture` (the Configuration pane and the channel Settings tab) |
| `settings-mock-data.ts` | every payload |

Both are registered by the frame's bridge layer (`ui-staging/staging-app-bridge.ts`).

## Not in the modal

"Use my tools" and the per-channel launch posture are the **channel Settings tab**
(`src/features/channels/components/settings-agent.tsx`, `settings-desktop-rows.tsx`), part of the
channels face. The modal's Configuration pane holds the defaults a new channel starts on.
