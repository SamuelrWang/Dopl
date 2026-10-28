# Overview staging — porting map

`/overview` (and `/playground/overview`) mounts the PRODUCT Overview face,
`src/features/home/components/overview/home-overview.tsx › HomeOverview`, inside the shared
UI-staging frame (`src/features/ui-staging/staging-frame.tsx`), on fake data. The face was ported
on 2026-10-26 (`docs/specs/overview-port/INVENTORY.md`); its staging copies are deleted, so a design
change here is a change to the product component.

The face takes a `useReads` hook. The desktop passes nothing (the product reads); this page passes
`stubs/use-staging-overview-reads.ts › useStagingOverviewReads`, which answers the same reads on the
same paths from `overview-mock-data.ts`.

## The grey ban (ruling, 2026-10-22)

Samuel: *"I don't like that gray color. I actually want to not use that gray color at all."* The
ban targets a grey SURFACE OR FILL BEHIND CONTENT. A meter track is neither: a 3px track must show
its unfilled portion to mean anything, so it keeps a translucent tone. The staging toolbar's
segmented background is staging-only chrome and never ports.

## Settings modal

"Get more credits" and "Add device" open the header's PRODUCT Settings modal on Plans & Billing /
Devices through `ui-staging/staging-popups-provider.tsx › openStagingSettings`, with billing answering
for the toolbar's plan (`src/features/settings-staging/PORTING.md`).

## Proposed fork (2026-10-28, staging only until Samuel approves)

The toolbar's **Face** switch mounts `proposed/proposed-overview.tsx › ProposedOverview` (default)
or the untouched product face (Current). The fork takes the same props and the same `useReads`, and
imports the product's pure helpers (`creditAllowance`, `deviceViews`, `agentTally`, `Bars`,
`GhostRows`) without changing them. Porting it means replacing each product file below with its
proposed twin, then deleting `overview-summary.tsx`, `overview-tokens.tsx` and `overview-card.tsx ›
OverviewCard` once nothing reads them.

| Proposed file | Replaces |
|---|---|
| `proposed/proposed-overview.tsx` | `home/components/overview/home-overview.tsx` (+ `overview-skeleton.tsx`'s ghost) |
| `proposed/proposed-section.tsx` | `overview-card.tsx › OverviewCard`; `overview-summary.tsx` (deleted, no strip) |
| `proposed/proposed-needs.tsx` | `overview-needs.tsx` |
| `proposed/proposed-agents.tsx` | `overview-agents.tsx` |
| `proposed/proposed-usage.tsx` | `overview-credits.tsx` + `overview-tokens.tsx` (one Usage section) |
| `proposed/proposed-devices.tsx` | `overview-devices.tsx` |
| `proposed/proposed-ledger.tsx` | `overview-ledger.tsx` |
| `proposed/proposed.module.css` | `overview.module.css` + `overview-preview.module.css` |

## Stubs and staging-only files (do NOT port)

| Staging file | Stands in for |
|---|---|
| `stubs/use-staging-overview-reads.ts` | `home/components/overview/use-home-overview-reads.ts › useHomeOverviewReads` |
| `stubs/use-api-query.ts` | `@/shared/hooks/use-api-query › useApiQuery` (same call shape; answers from the data file) |
| `stubs/use-workspace-entitlements.ts` | `@/features/billing/components/use-workspace-entitlements › useWorkspaceEntitlements` |
| `stubs/staging-state.tsx` | nothing: the staging toolbar's state (reads, plan) |
| `overview-mock-data.ts` | every payload: overview, series, token spend, wallet, devices |
| `overview-staging-page.tsx` | `apps/desktop-ui/src/pages/home/home-panes.tsx › HomePane` Overview branch + the staging toolbar |
| `overview-staging-page.test.tsx` | render smoke test (no network, Settings opens) |
| `src/app/overview/page.tsx` | the route |
