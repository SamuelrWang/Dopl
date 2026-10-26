# Overview staging — porting map

`/overview` stages desktop **/home → Overview** on fake data, inside the shared UI-staging frame
(`src/features/ui-staging/staging-frame.tsx`). It holds one face, redesigned from scratch on
2026-10-26 (Samuel: *"completely redesign the overview page from scratch … it should not copy any
of the UI. I like the way that it has been doing the UI stuff for the task."*). The other faces
(the branch copy and Version D) were deleted on 2026-10-26 (Samuel: *"For the playground, delete
all the other versions of the overview and just keep version E."*).

Look: the channel tasks recipe (`channels-staging`, `ui-staging/staging.css › .uis-tk*`): white
cards, hairlines between rows, `--shadow-bento`, caption-scale meta, tokens only, under the grey
ban below.

## The face

| Order | Block | What is in it |
|---|---|---|
| 1 | Summary strip (one card, hairline-split cells) | Working n / running, Need you, Devices online n / total, Credits left n / limit + 3px meter |
| 2 · main | Needs you | out-of-credits row (plan exhausted) + the two invented asks (`overview-data.ts › NEEDS`) with Approve / Deny / Answer |
| 2 · main | Agents | per computer: name, This computer, status; each agent: runtime logo, name, channel · runtime, run time, Working / Waiting for you |
| 2 · main | Activity | `Routing` / `Logs` tabs; routing: time, summary, kind + from (why on hover), hops ✕/✓, "n/5 first try"; logs: level dot, time, event, device · detail |
| 2 · side | Credits | used of limit, meter, left, resets, Unreconciled / Unmetered, paused note, Get more credits (unpaid); then scope picker, month stepper, total, daily bars, clipped note |
| 2 · side | Tokens | at least N, sessions, 31-day bars |
| 2 · side | Devices | online count, Add device (kind → pairing code), reach order chain with 30s waits, every device: model (+ through host), In use, battery, status + last seen |
| 3 | Channels | one table: channel (Untitled fallback), credits with meter, messages |
| 4 | People · MCP tools | name (Unknown member), role, credits · tool.op, calls; then "From the newest N events." |

States: loading = `overview-skeleton.tsx` (same frame, ghost lines); empty = in-card empty wells;
error = message + Try again; plans from `useWorkspaceEntitlements`. Agents, Needs, Devices and
Activity follow the Devices preview gate (the toolbar's Devices switch).

**Files** (`pages/home/overview/`): `overview.tsx` (shell, reads, order), `overview-now.tsx`,
`overview-usage.tsx`, `overview-devices.tsx`, `overview-ledger.tsx`, `overview-bits.tsx`,
`overview-skeleton.tsx`, `overview-data.ts`, `overview.css` + `overview-parts.css` (plain scoped
CSS under `.ove`), `overview.test.tsx`. **Port:** the reads are the product's; `.ove-card` is the
white card the kit needs; the summary strip, the row recipe and the scope
picker are the pieces worth promoting.

### The grey ban (ruling, 2026-10-22)

Samuel: *"I don't like that gray color. I actually want to not use that gray color at all."* The
ban targets a grey SURFACE OR FILL BEHIND CONTENT. A meter track is neither: a 3px track must show
its unfilled portion to mean anything, so it keeps a translucent tone. The staging toolbar's
segmented background is staging-only chrome and never ports. If Samuel flags the tracks himself,
that override wins.

## Imported, not copied

`@/features/home/overview-types`, `@/features/devices/components/device-glyph`,
`@/shared/layout/settings-modal/settings-modal-core`.

## Settings modal

"Get more credits" opens `@/features/settings-staging/staging-settings-modal › StagingSettingsModal`.
Its copies and porting map live in `src/features/settings-staging/PORTING.md`.

## Stubs and staging-only files (do NOT port)

| Staging file | Stands in for |
|---|---|
| `stubs/use-api-query.ts` | `apps/desktop-ui/src/hooks/use-api-query.ts › useApiQuery` (same call shape; answers from the data file) |
| `stubs/use-workspace-entitlements.ts` | `@/features/billing/components/use-workspace-entitlements › useWorkspaceEntitlements` |
| `stubs/home-settings-control.ts` | `apps/desktop-ui/src/pages/home/home-settings-control.tsx › openHomeSettings` |
| `stubs/staging-state.tsx` | nothing: the staging toolbar's state |
| `overview-mock-data.ts` | every API payload, plus `DEVICES_MOCK` for the Devices preview |
| `overview-staging-page.tsx` | `apps/desktop-ui/src/pages/home/home-panes.tsx › HomePane` Overview branch + the staging toolbar |
| `overview-staging-page.test.tsx` | render smoke test (no network, Settings opens) |
| `src/app/overview/page.tsx` | the route |
