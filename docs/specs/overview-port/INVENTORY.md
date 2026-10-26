# Overview port: inventory (2026-10-26, branch `ui/port-overview`)

Spec: `/playground/overview` (`src/features/overview-staging/pages/home/overview/**`, Version E).
Product: desktop `/home` → Overview. Method: `docs/specs/channel-page-port/PLAN.md` §1 and
`WORKER-RULES.md`. Anchors are `path › symbol`.

## 1. Layer map (before the port)

| Layer | Product file | Mounted by |
|---|---|---|
| Face + reads | `apps/desktop-ui/src/pages/home/overview-panels.tsx › HomeOverviewPanels` (`/api/home/overview`), `› UsageCard` (`/api/home/overview-series`, scope + month state), `› CreditsBar` (`useWorkspaceEntitlements` → `/api/billing/status`) | `pages/home/home-panes.tsx › HomePane` (token `OVERVIEW_PANE`) |
| Usage bar + plot | `pages/home/overview-sections.tsx › CreditCapacityBar` (`UsageMeter`, the sanctioned concave surface), `› UsageChart` (`#/components/charts/bar-series › BarSeries`) | `overview-panels.tsx` |
| Scope + month | `pages/home/overview-usage-filter.tsx › UsageScopeMenu` (`SelectMenu variant="text"` over `use-home-channels.ts › useHomeChannels`), `› MonthStepper`, `› usageSeriesPath`, `› monthKey` | `overview-panels.tsx` |
| Token spend | `pages/home/overview-token-spend.tsx › TokenSpendPanel` (`/api/home/token-spend`, folds away) over `components/overview/token-spend-strip.tsx › TokenSpendStrip` (+ local-day arithmetic) | `overview-panels.tsx`; the strip also by the WORKSPACE Overview (`pages/overview/token-spend.tsx`) |
| Rails | `components/overview/rank-rail.tsx` (`ChannelCreditRail`, `ChannelMessageRail`, `PeopleRail`, `ToolRail`, `ClippedNote`, `RailsGhost`) | `overview-panels.tsx` and the workspace Overview (`pages/overview/usage-rails.tsx`) |
| Ground | `shared/ui/section-panel.tsx › SectionPanel` wells + `.bento` cards; `pages/home/home.module.css › .pane` (`--home-card`) | |
| Loading | `pages/home/home-skeleton.tsx › OverviewFaceGhost` (frame ghost), `Skeleton`/`RailsGhost` in-face | `HomePageSkeleton` (boot + /home gate) |
| Error | `#/components/page-states › PageError` (userFacingMessage, Try again, Reload) | `overview-panels.tsx` |
| Settings | `pages/home/home-settings-control.tsx › openHomeSettings("billing")` | Get more credits |
| Devices (Settings only) | `src/features/devices/components/use-devices.ts › useConnectedDevices` (computers `/api/devices` + glasses, 30s presence refresh), `devices-panel.tsx`, `merge.ts › mergeDevices` | Settings › Devices |

Tests: `pages/home/overview-{panels,credit-bar,unmetered-caption,usage-filter}.test.tsx`,
`overview-token-spend.test.ts`, `overview-card-shadow.test.ts`, `overview-test-harness.ts`,
`components/overview/rank-rail.test.tsx`, `components/skeletons/frame-skeletons.test.tsx`
(Overview ghost pins), `src/features/agent-identities/components/identity-editor-surface.test.tsx`
(the /home concave sweep and its `overview-sections.tsx` carve-out).

## 2. Staging → product deltas

| Staging block | Product today | Port |
|---|---|---|
| Summary strip (Working, Need you, Devices online, Credits left + 3px meter) | none (stat tiles were cut 2026-09-01) | Need you, Devices online, Credits left; Working needs per-computer agents (§4) |
| Two equal-height columns, fixed slots, inner scroll | gray `SectionPanel` wells, content height | the column grid (`--ove-*` heights), container query to one column |
| Needs you (out-of-credits row + invented asks) | none | out-of-credits row only (real); asks are mock (§4) |
| Agents by computer | cut 2026-09-20 | not shipped (§4) |
| Activity Routing / Logs | cut 2026-09-20 | not shipped (§4) |
| Credits: used of limit, 3px meter, left · Resets · Unreconciled · Unmetered, paused note, Get more credits; scope pill + month + total; daily bars; "Newest rows only." | `CreditCapacityBar` (`UsageMeter`) + `UsageChart` (`BarSeries`) in two `.bento` cards | one card, `ThinMeter`, plain bars |
| Tokens: "At least N", sessions, 31-day bars | Token spend panel (folds away), honesty paragraph | always a card; "At least" stays in the figure |
| Devices: reach order, every device (model, through host, In use, battery, status), Add device | Settings › Devices only | real list from `useConnectedDevices`; reach order, In use, battery, through-host are mock (§4); Add device opens Settings › Devices |
| Channels table (credits + meter, messages, Untitled fallback) | two rails | one table |
| People (initial, role tag, credits) · MCP tools (tool.op, calls) | `PeopleRail` (guest mark + subtotal), `ToolRail` | cards; guest subtotal kept |
| "From the newest N events." | `ClippedNote` ("Rails cover the newest N rows.") | staging copy |
| Skeleton (white ghost cards, local `.ove-ghost`) | flat `OverviewFaceGhost` | the face's own geometry, flat (`GHOST_FLAT_FACE`), `Skeleton` atoms |
| Error: message + Try again | `PageError` | message (`userFacingMessage`) + Try again + Reload |

## 3. Reverse gaps (product behaviour staging stubbed) and how each survives

1. Reads: `/api/home/overview?range=month` (no `workspaceId`), `/api/home/overview-series` with
   `channel=`/`month=` only off the defaults (`usageSeriesPath`), `/api/home/token-spend`,
   `/api/billing/status` against the home container. Kept in
   `home/components/overview/use-home-overview-reads.ts`; staging answers the same shapes.
2. Cold reads, `keepPreviousData` on overview + series (dim while the next series lands). Kept.
   Devices inherit the devices feature's 30s presence refresh (OPEN-QUESTIONS 3).
3. Stale cache: `?? EMPTY_*` at every array read (`channels`, `people`, `tools`, `points`), the
   entitlements hook's field-wise fallbacks, `bucketByLocalDay` dropping unparseable instants. Kept.
4. Credits: wallet counter (`credits.used`) on the allowance, the plot totals its own bars; a
   `limit` of 0 falls back to `PERSONAL_MONTHLY_CREDITS.free`; `over` = `remaining === 0 && limit > 0`;
   Unreconciled (`ledgerDrift !== 0`, never the figure), Unmetered (`unmeteredSince`, never the
   instant), Resets only with a `periodEnd`. Kept.
5. Plan gate: Get more credits only while `!isPaid`, opening Settings › Plans & Billing. Kept.
6. Scope menu: All channels, Desktop agent (with its description), every home channel from the
   left pane's cached read (no extra request); the value is the channel's own id. Kept.
7. Month stepper: next disabled at the current month, no lower bound, year carry; never re-reads
   billing. Kept.
8. Token floor: `formatTokens` (floored) and "At least"; the truncated report's note. Kept
   (staging `compact` rounded up and is not ported).
9. Guests: role from `workspace_members`, guest subtotal on People; nameless channel → "Untitled
   channel", nameless person → "Unknown member". Kept.
10. Clipped scan says so (`truncated` → the scanned count). Kept.
11. Loading: a ghost while overview has no data; in-card ghosts while the wallet / series / spend /
    devices are unknown. Unknown is never drawn as empty ("Nothing waiting" waits for the wallet).
12. Error: `userFacingMessage` + Try again + Reload; a failed token or devices read says so in its
    card rather than reading as empty.
13. Pane token carries no row (no remount on list clicks); Overview leftmost and default. Untouched.

## 4. Data the staging look needs that the product lacks

| Staging data | Product | Shipped as |
|---|---|---|
| Needs-you asks (approvals, open questions) | none since "Waiting on you" was cut 2026-09-05 | out-of-credits row only |
| Agents by computer, run time, Working/Waiting | `channel_sessions` has no device column; /home board cut 2026-09-20 | hidden, with the Working cell |
| Activity routing + logs | no routing ledger, no device log | hidden |
| Reach order (fallback chain, 30s waits) | no router | hidden |
| Device In use, battery, "through" host, Away | not on `ConnectedDevice` | hidden; Online / last seen only |
| Add device kinds + pairing code | pairing lives in Settings › Devices (`PairGlasses`) | the button opens that section |

## 5. Dead code after the port

`pages/home/overview-panels.tsx`, `overview-sections.tsx`, `overview-usage-filter.tsx`,
`overview-token-spend.tsx` and their four suites; `home-skeleton.tsx › OverviewFaceGhost` and its
`MONTH_ARROW`; the concave carve-out for `overview-sections.tsx`; staging's
`pages/home/overview/**` copies, `overview-data.ts`, `stubs/home-settings-control.ts`, the Devices
preview gate and `DEVICES_MOCK`. `rank-rail.tsx` and `token-spend-strip.tsx` stay (workspace
Overview); their "both Overviews" comments are corrected.

## 6. Duplication

- Local-day token arithmetic: staging `tokenDays` re-implemented `token-spend-strip.tsx ›
  bucketByLocalDay`. One copy now, in `src/` (both trees import it).
- Month helpers: staging `monthKeyOf`/`shiftMonth`/`monthName`/`seriesPath` duplicated
  `overview-usage-filter.tsx`. One copy now, in `src/`.
- Meter: staging `EMeter` = `shared/ui/usage-meter.tsx › ThinMeter`. Reused.
- Pills: staging `.ove-btn` = `small-action-button.ts › PILL_BUTTON` / `INK_PILL`. Reused.
- Card title: `shared/ui/section-title.ts › SECTION_TITLE` (byte-identical to `ui/port-ontology`).
