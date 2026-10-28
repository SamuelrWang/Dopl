# Identities port: inventory (2026-10-26)

Port of the UI-staging Identities face (`/playground/identities`, `src/features/identities-staging/**`)
into desktop /home → Identities. Method and rules: `docs/specs/channel-page-port/WORKER-RULES.md` and
`PLAN.md` §1. Branch `ui/port-identities`. Unknowns: `OPEN-QUESTIONS.md` beside this file.

## 1. Layer map (before the port)

| Layer | File | Role |
|---|---|---|
| Desktop host | `apps/desktop-ui/src/pages/home/home-panes.tsx › HomePane` | Mounts the face keyed by pane token (F-338). |
| Desktop host | `pages/home/identity-panels.tsx › HomeIdentityPanels` | Two reads (container, home shelf), both sections, create gates, editor + knowledge dialog mounts, card launch. Card click opened the EDITOR. |
| Desktop host | `pages/home/identity-editor.tsx` | `ContainerIdentityEditor` / `HomeWorkspaceIdentityEditor` over `IdentityEditor`. |
| Desktop host | `pages/home/identity-card-launch.tsx` | `LaunchIntoChannelButton` (face) + `useCardLaunch` (bridge launch, rename, describe, refusal copy). |
| Desktop host | `pages/home/identity-card-knowledge.tsx` | `AddKnowledgeWell` (grey `bg-bg-inset` box listing every attachment) + `IdentityKnowledgeDialog`. |
| Desktop host | `pages/home/home-skeleton.tsx › HomeIdentityPanelsSkeleton` | One grey section, 4-up ghost grid. |
| Shared | `src/features/agent-identities/components/identity-section.tsx` | `IdentityPanel` / `IdentityGrid` / `IdentitySection` / `IdentityCard` (grey-pill marker, `bg-bg-inset` model chip, 4-up). Also the workspace Agents page. |
| Shared | `components/identity-editor*.tsx`, `knowledge-scope-*.tsx`, `identity-picker.tsx › authorMarker` | Editor (FormDialog), knowledge picker, authorship marker. |
| Shared | `src/shared/ui/{section-panel,identity-face,avatar-stack,select-menu,status-pill,runtime-logo}.tsx`, `settings-modal/modal-shell.tsx` | Kit primitives. |
| Data | `hooks/use-agent-identities.ts`, `use-agent-identity-writes.ts`, `use-identity-save.ts`, `use-attachable-bases.ts`; `channels/hooks/use-launch-selection.ts`; `channels/components/use-desktop-sessions.ts` | Reads, writes, runtimes + catalogs, this machine's session feed. |

## 2. Staging → product deltas (the visual spec)

| # | Staging piece | Product target |
|---|---|---|
| D1 | Card rebuild: white 12px card, 38px `IdentityFace` (owner photo, runtime badge, neutral ring), name + owner line, 2-line description, one-concept chips (runtime/model, knowledge count), scope line, state line (running + last used), worn-by stack, footer action block on a hairline | `identity-section.tsx › IdentityCard` restyled in place; `IDENTITY_ROW` / `IDENTITY_ROW_ADD` exported |
| D2 | Grid 4 → 3 across on /home only (the rail takes a quarter); the workspace page stays 4 | `IDENTITY_GRID_RAIL`, passed by `identities-home.tsx` |
| D3 | Read-only view popup with tabs; card click opens VIEW, Edit hands to the editor; create still opens the editor | new `components/identity-view-dialog.tsx` + `identity-view-parts.tsx` + `identity-view.module.css`, shell is `ModalShell size="panel"` (port target named by staging) |
| D4 | Page head: counts line + runtime readiness | `components/identity-page-controls.tsx › IdentityPageHead` |
| D5 | Grid controls: search pill (`.search-expand` recipe), runtime filter, sort (`SelectMenu variant="bare"`) | `components/identity-page-controls.tsx › IdentityControls` over `shared/ui/search-pill.tsx › SearchPill` |
| D6 | Activity right rail 3/4 \| 1/4 (container query at 760px), Active now run cards + Recent rows, owner filter | new `components/identity-activity-panel.tsx`; layout kit recipe `.rail-layout*` in both CSS copies |
| D7 | All-white pane, sections flat (no well), heading as a snug grey title chip, 28px between sections | `SectionPanel flat` + kit `.title-chip`; `home.module.css` identities pane |
| D8 | Dashed "Add knowledge" row (no attachment list), full-width Launch at the card foot | `components/identity-card-actions.tsx` |
| D9 | Knowledge dialog's selected set on a hairline, not `bg-bg-inset` | `identity-knowledge-dialog.tsx` |
| D10 | Skeleton mirrors two columns and three flat sections | `home-skeleton.tsx`, `section-panel-ghost.tsx` |
| D11 | Model chip reads short labels (catalogs handed down) | host passes `useLaunchSelection({kind:"defaults"}).catalogs` |

## 3. Reverse gaps (product behaviour staging stubbed; every one must survive)

| Behaviour | Where it lives after the port |
|---|---|
| Two reads, two workspaces, entry-key writes (F-331), shelf matching | host `identity-panels.tsx` (unchanged hooks) |
| Shared section only with a channel; "No channel selected" empty state; Personal renders with no channel | host + `identities-home.tsx` |
| `canCreateShared` gate (workspace role ≥ member, hidden not disabled) | host |
| Personal create disabled until onboarded (`homeWorkspaceId === null`) + `SCOPE_UNAVAILABLE` sentence | `identities-home.tsx › personalState` (both hosts) |
| Personal failure outranks pending (F-339), retry in place; container error → `PageError`; container pending → skeleton | host + sections |
| Author marker on every row the viewer did not write (INVARIANTS §5A security signal) | `identity-section.tsx` (owner line) + view popup head |
| Create opens the editor directly; edit opens where the row lives (`where`) | `identities-home.tsx` view → `onEdit(target)` → host editor mounts |
| `acknowledgeShared` / `homeScoped` extras, `containerKind`, `defaultVisibility` | `pages/home/identity-editor.tsx` (untouched) |
| Delete behind `ConfirmDialog`, 412 stale-version copy | `IdentityEditor` / `use-identity-save.ts` (untouched) |
| Knowledge popup: replace-set save under the opened version, pending/failed base list | `identity-knowledge-dialog.tsx` (shared face) + host save |
| Card launch: bridge-gated button, double-submit guard, refusal on the row, rename + describe after launch | `pages/home/identity-card-launch.tsx › useCardLaunch` (logic untouched) + shared button |
| Launch only on personal cards and only with a channel | host `cardActionFor` |
| `team` rows dropped, container `private` rows dropped | `groupByVisibility` (untouched) |
| Pane token keying, no surviving held state | `home-panes.tsx` (untouched) |
| Runtime + model + permission + profile fields, instructions editor, custom fields, colour, knowledge scopes | `IdentityEditor` (untouched); view popup shows runtime, model, instructions, fields, knowledge |
| MCP-created identities | same read; they render like any row (author marker when not mine) |
| Workspace Agents page (`agent-identities-core.tsx`) and channel identity pickers (`identity-picker.tsx`, launch dialog) | untouched APIs; the card restyle reaches the workspace page by design (R12) |
| Keyboard: cards are buttons, tabs are `role=tab`, Escape closes the popup, Escape clears search | components |

Not in the product and NOT invented by the port (see OPEN-QUESTIONS): an all-channels scope and per-row
reach, the Tools-and-rules tab, an action log per identity, runtime re-auth state and a fix button.

## 4. Real data for the staged mock surfaces

| Staged mock | Real source |
|---|---|
| owner photo | `viewer.avatarUrl` (`/api/user/profile`, now passed down `HomePane`) for mine, `channel.peers[].avatarUrl` for a peer |
| runtime badge / logo | `shared/ui/runtime-logo.tsx › useRuntimeLogo` |
| runtime label, readiness, catalogs | `useLaunchSelection({kind:"defaults"})`: `runtimes`, `connected`, `connectedKnown`, `catalogs` |
| running count, Active now, Running tab | `useDesktopSessions()` sessions joined by the spawn-time `identityId` (`lib/identity-runs.ts › joinRuns`; name only for an older desktop) |
| last used, Recent, Activity tab | the same feed's ended sessions (`main/agent-history.js` keeps them seven days), `endedAt` |
| worn by (shared) | `channel.peers` |

`null` from the session feed (no bridge) means "could not ask": no state lines, no rail (INVARIANTS §11).

## 5. Dead code and duplication removed by the port

- `pages/home/identity-card-knowledge.tsx › AddKnowledgeWell`, its `ScopeBar` grey list; `identity-card-launch.tsx › LaunchIntoChannelButton` (moved to the shared actions file).
- `identity-panels.tsx`'s inline `SharedIdentitySection` / `PrivateIdentitySection` (moved, shared with the playground).
- The whole staging tree except its data layer: `identities-staging/agent-identities/components/*`,
  `home/{identity-panels,identity-sections,identity-editor,identity-card-launch,identity-card-knowledge,home-skeleton}.tsx`,
  `desktop/**`, `page/*`, `view/*`, the `.uis-idp-*` rules in `ui-staging/staging.css`, and PORTING.md's port rows.
- Grey surfaces on the face (`bg-bg-inset` model chip, add box, selected set).
