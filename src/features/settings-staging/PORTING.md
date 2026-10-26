# Settings staging — porting map

The desktop **Settings modal** (/home's black "Profile" pill, the credit bar's "Get more credits",
the workspace sidebar's gear) with all seven rows and every pane, on fake data. It is mounted by
`/popups` (one button per row, plus a free-plan Billing button) and by `/overview` ("Get more
credits"), and by the staging frame's profile pill on EVERY staging page
(`ui-staging/staging-popups-provider.tsx`). Entry point: `staging-settings-modal.tsx › StagingSettingsModal` (`open` / `onClose`,
optional `section`, `onSectionChange`, `plan`).

Every copied file starts with a `STAGING COPY of …` line. Only import paths differ from the source:
data hooks and desktop libs point at `./stubs`, and staged files point at each other. When porting
back, keep the source's imports and carry over only markup, class and copy changes. Copies are of
the tree as of 2026-10-22 (`master`, with uncommitted work present).

## Copied UI (port these back)

| Staging file | Source |
|---|---|
| `components/settings-modal/settings-modal.tsx` | `apps/desktop-ui/src/components/settings-modal/settings-modal.tsx` |
| `components/settings-modal/account-actions.tsx` | `apps/desktop-ui/src/components/settings-modal/account-actions.tsx` |
| `components/settings-modal/billing-pane.tsx` | `apps/desktop-ui/src/components/settings-modal/billing-pane.tsx` |
| `shared/layout/settings-modal/sections/workspaces-section-core.tsx` | `src/shared/layout/settings-modal/sections/workspaces-section-core.tsx` |
| `shared/layout/settings-modal/sections/agents-section-core.tsx` | `src/shared/layout/settings-modal/sections/agents-section-core.tsx` |
| `shared/layout/settings-modal/sections/devices-section-core.tsx` | `src/shared/layout/settings-modal/sections/devices-section-core.tsx` |
| `shared/layout/settings-modal/sections/notifications-section-core.tsx` | `src/shared/layout/settings-modal/sections/notifications-section-core.tsx` |
| `shared/layout/settings-modal/sections/account-section-core.tsx` | `src/shared/layout/settings-modal/sections/account-section-core.tsx` |
| `shared/layout/settings-modal/sections/account-subscription.tsx` | `src/shared/layout/settings-modal/sections/account-subscription.tsx` |
| `shared/layout/settings-modal/sections/account-billing-history.tsx` | `src/shared/layout/settings-modal/sections/account-billing-history.tsx` |
| `shared/layout/settings-modal/sections/plans-billing-core.tsx` | `src/shared/layout/settings-modal/sections/plans-billing-core.tsx` (its `apiRequest, ApiError` import is split in two, `ApiError` stays real) |
| `features/devices/components/agents-panel.tsx` | `src/features/devices/components/agents-panel.tsx` |
| `features/devices/components/devices-panel.tsx` | `src/features/devices/components/devices-panel.tsx` |
| `features/devices/components/computer-row.tsx` | `src/features/devices/components/computer-row.tsx` |
| `features/glasses/settings/glasses-device-row.tsx` | `src/features/glasses/settings/glasses-device-row.tsx` |
| `features/glasses/settings/pair-glasses.tsx` | `src/features/glasses/settings/pair-glasses.tsx` |
| `features/channels/components/runtime-credential-bars.tsx` | `src/features/channels/components/runtime-credential-bars.tsx` |
| `features/channels/components/agent-defaults-settings.tsx` | `src/features/channels/components/agent-defaults-settings.tsx` |

Why these were copied rather than imported: each one reads data (a query, the Electron bridge) or
fires a write. Importing the real file would have hit `/api/*` on the signed-in dev server, and a
click could have cancelled a real plan or removed a real computer.

## Imported, not copied (shared web code with no data of its own; edit in place, both apps get it)

`@/shared/layout/settings-modal/settings-modal-core` (the rail, `ModalShell`, the seven rows),
`…/modal-shell`, `…/settings-modal.module.css`, `…/sections/settings-panel`, `…/sections/section-shell`,
`…/sections/plan-cards`, `…/sections/use-confirmed-action`,
`@/features/notifications/components/notifications-panel`,
`@/features/channels/components/settings-agent-launch-rows` (Runtime / Permissions Ask·Auto·Full /
Messaging rows) and `settings-agent-rows`, `@/features/billing/components/upgrade-confirm-dialog`,
`@/features/mcp-connect/components/remote-connect`, `@/features/glasses/settings/assistant-key-dialog`,
`@/features/devices/components/{device-glyph,device-name-title}`, `@/features/devices/merge`, and
`@/shared/ui/*`.

## Stubs and staging-only files (do NOT port)

| Staging file | Stands in for |
|---|---|
| `stubs/api.ts` | `@/shared/hooks/use-api-query › useApiQuery`, `#/hooks/use-api-query`, `@/shared/api/api-client › apiRequest` |
| `stubs/use-workspace-entitlements.ts` | `@/features/billing/components/use-workspace-entitlements › useWorkspaceEntitlements` (same derived fields) |
| `stubs/use-billing.ts` | `use-billing-account › useWorkspaceInvoices, useCancelPlan`; `use-personal-plan-change › usePersonalPlanChange` |
| `stubs/use-devices.ts` | `@/features/devices/components/use-devices`; `glasses/settings/use-glasses › useInvalidateGlassesDevices` |
| `stubs/glasses-api.ts` | `@/features/glasses/settings/glasses-api` |
| `stubs/runtime-signin.ts` | `@/features/channels/components/runtime-signin` (main's `runtimeAuth`), plus `raiseStagingSignInPrompt` |
| `stubs/use-launch-selection.ts` | `@/features/channels/hooks/use-launch-selection › useLaunchSelection` (main's agent-defaults store) |
| `stubs/notifications-store.ts` | `notifications/stores/api-store › apiNotificationPrefsStore`, `stores/desktop-gate › refreshDesktopBannerGate` |
| `stubs/desktop-lib.ts` | `#/lib/dopl-bridge › getBridge`, `#/lib/open-in-browser`, `@/shared/lib/open-external › openExternalUrl`, `react-router › useNavigate` (each hand-off shows a toast) |
| `stubs/staging-settings-state.tsx` | nothing: the staging plan |
| `settings-mock-data.ts` | every payload (workspaces, profile, billing status per plan, invoices, agent apps, runtime sign-ins, computers, glasses, runtimes, level readings) |
| `staging-settings-modal.tsx` | `apps/desktop-ui/src/pages/home/home-settings-control.tsx`'s binding of the modal |
| `staging-settings-modal.test.tsx` | render smoke test (every pane, no fetch) |

## Not in the modal

"Use my tools" and the per-channel launch posture are the **channel Settings tab**
(`src/features/channels/components/settings-agent.tsx`, `settings-desktop-rows.tsx`), part of the
channels face, not this modal. The modal's Configuration pane holds the defaults a new channel
starts on (Runtime, Permissions Ask/Auto/Full, Messaging, Launch agents).
