# /knowledge staging → desktop porting map

`/knowledge` stages **desktop /home → Knowledge**: the face the shipping desktop shows (it boots to
`/home`, `apps/desktop-ui/src/pages/boot/index.tsx` → `HOME_PATH`), rendered inside the landing
demo's window (`src/features/ui-staging/staging-frame.tsx`).

The other surface, the workspace route `/:workspaceSegment/knowledge`
(`apps/desktop-ui/src/pages/knowledge/index.tsx`), is NOT staged as its own page. It mounts the
same shared core (`KnowledgeV2PreviewCore`) as the Home pane's opened base, so the two-pane base
view staged here covers it. Its card-grid "home" mode (the hero banner) is not reachable from /home.

## How to port a change back

1. Edit the staging file. Reload (HMR).
2. Apply the same diff to the source file in the right column. Everything below `home/` and
   `knowledge/components/` is a **verbatim copy** apart from import paths and a one-line header, so
   a diff applies cleanly.
3. Never port `data.ts`, `fake-store.ts`, `stubs/*`, `knowledge/client/api.ts`,
   `knowledge/client/realtime.ts` or `knowledge-staging-page.tsx` (the "States" pill moved to `ui-staging/staging-scenario-switch.tsx`) —
   those are the staging data layer.

## Desktop-local files (`apps/desktop-ui/src/`)

| Staging file | Desktop source | Notes |
|---|---|---|
| `home/knowledge-panels.tsx` | `pages/home/knowledge-panels.tsx` | Only change: `Channel` → `StagingChannel` (`data.ts`). |
| `home/knowledge-panel-cards.tsx` | `pages/home/knowledge-panel-cards.tsx` | Verbatim. |
| `home/knowledge-base-view.tsx` | `pages/home/knowledge-base-view.tsx` | Verbatim. |
| `home/panel-buttons.tsx` | `pages/home/panel-buttons.tsx` | Verbatim. |
| `home/home.module.css` | `pages/home/home.module.css` | Verbatim (CSS module, scoped). |
| `home/home-skeleton.tsx` | `pages/home/home-skeleton.tsx` | Trimmed to the two face skeletons. |
| `desktop/components/page-states.tsx` | `components/page-states.tsx` | Trimmed to `PageError`. |
| `desktop/components/skeletons/*.tsx` | `components/skeletons/*.tsx` | Verbatim. |

## Shared feature files (`src/features/knowledge/`, which the desktop bundles)

| Staging file | Source |
|---|---|
| `knowledge/components/**` (every file) | `src/features/knowledge/components/**` (same relative path) |
| `knowledge/client/hooks.ts` | `src/features/knowledge/client/hooks.ts` (verbatim) |
| `knowledge/client/hooks-channel-grants.ts` | `src/features/knowledge/client/hooks-channel-grants.ts` (verbatim) |
| `knowledge/types.ts`, `scope.ts`, `url.ts` | re-export shims of the real modules |

⚠ These are shared with the web app. Porting a change into `src/features/knowledge/components/`
changes both the desktop and any web surface that mounts them.

## Staging data layer (never ported)

| Staging file | Stands in for |
|---|---|
| `knowledge/client/api.ts` | `src/features/knowledge/client/api.ts`: same exports and signatures, bodies hit `fake-store.ts` |
| `knowledge/client/realtime.ts` | `src/features/knowledge/client/realtime.ts` (no-op) |
| `stubs/revisions-api.ts`, `stubs/revisions-hooks.ts` | `src/features/revisions/client/{api,hooks}.ts` (knowledge scopes only) |
| `stubs/use-teams.ts` | `src/features/members/hooks/use-teams.ts` |
| `stubs/use-my-access.tsx` | `src/features/members/hooks/use-my-access.tsx` (everything resolves to `edit`) |
| `stubs/use-channel-members.ts` | `src/features/channels/hooks/use-channel-members.ts` |
| `stubs/use-current-profile.ts` | `src/shared/auth/use-current-profile.ts` |
| `stubs/use-presence.ts` | `src/shared/realtime/use-presence.ts` (Grace is always reading) |
| `data.ts` / `fake-store.ts` | the database. Reset on every page mount. |
| `knowledge-staging-page.tsx` | `pages/home/home-panes.tsx › HomePane`'s Knowledge branch (props from boot) |
| `ui-staging/staging-scenario-switch.tsx` (shared, moved 2026-10-22) | nothing: the floating "States" pill (channel / role / home space); identities uses it too |
