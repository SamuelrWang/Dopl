# Live data plan: Overview, Issues, Usage

Measured 2026-10-31 on branch `ui/dev-portal-redesign`. Production figures come from aggregate SELECTs on `mrefkedvdehahjejreae`. No message content, names or emails were read.

Labels: **[V]** verified in code or production, with `path › symbol`. **[A]** assumption, not proven.

## 0. Facts that shape everything

| # | Fact | Evidence |
|---|---|---|
| F1 | Production holds 1 org, and it is internal. It has 1 project, 1 end user, 2 secret keys (the test key has never been used), 4 SDK devices (all G2), 4 active connections, 14 `dev_events`, 2 `dev_actions`, 2 `dev_device_messages`. It has 0 webhook endpoints, outbox rows or attempts, 0 connect sessions, 0 context profiles. | [V] prod counts |
| F2 | **`dev_billable_events` has 0 rows, so usage for Dopl is structurally zero.** The real page shows "Internal projects are not billed" in place of any chart. Samuel's demo project is exactly this project. | [V] `supabase/migrations/20261122800000_device_sdk_internal_orgs.sql`, `src/app/developers/usage/page.tsx › UsagePage`, `src/features/device-sdk/server/usage.ts › readUsage` |
| F3 | The 14 events are all `present.notify`, live, on glasses, all on 2026-10-30: 2 ok and 12 `device_offline`. `intent` is null on all 14 because they use the device action route, not `/deliver`. `connection_id` is null and `cost_units` is 0 on all 14. A real shown rate today is 2 of 14, about 14%. | [V] prod aggregate |
| F4 | The 12 refusals are spread over all 4 G2 rows: idle 0.0 days (2 ok, 1 refused), 4.1 days (3 refused), 28.9 days (3 refused), 31.0 days (5 refused). This is a real "stale pairings" issue. [A] The seam appears to try each migrated device, which inflates refusals. | [V] prod aggregate. [A] on the cause, `src/features/display/server/sdk-lens.ts` |
| F5 | `dev_events` has no key id, route, method or HTTP status. "Top by API key" and `calls7d` cannot be computed today. | [V] `information_schema`, `supabase/migrations/20261122300000_device_sdk_events.sql` |
| F6 | A delivery cannot be counted cleanly from either table alone. Refusals before the claim write no `dev_actions` row. Polls of `GET /v1/actions/{id}` write a `dev_events` row with `capability` set, and idempotent replays also write a row. | [V] `delivery-service.ts › deliver`, `action-service.ts › deviceAction`, `getAction`, `delivery-common.ts › replayResult` |
| F7 | "Seen" is not tracked. `delivered` means the glasses inbox took the row. Only `ask` rows settle: `settlementFor` returns null for a notify. Production shows this: 2 lens rows are `dismissed` while their 2 actions stay `delivered`. | [V] `server/glasses/lens-actions.ts › settlementFor`, prod counts |
| F8 | Retention is 30 days, pruned daily at 09:15 UTC, and only on `dev_events`. No prune was found for `dev_actions`, `dev_device_messages` or the `dev_webhook_*` log tables. | [V] `server/events.ts › pruneDevEvents`, `vercel.json`, grep for `.delete()` in `device-sdk/server` |
| F9 | Nothing writes `connections.status = 'needs_reauth'`. Nothing emits `connection.needs_reauth`, `device.online` or `device.offline`, and `input.utterance` "lands later". So 4 of the 9 webhook names have no emitter. | [V] grep over `device-sdk/server`, `glasses`, `api`; `delivery-service.ts › getContext` comment |
| F10 | The wired adapters are `even_g2`, `desktop` and `simulator` only. **Desktop always refuses SDK delivery with `capability_unsupported`.** The simulator is test env only. **No Google Home adapter exists**; it appears only as catalog fixtures (`google_home@preview`). | [V] `server/device-adapters.ts › wiredDeviceAdapters`, `desktopUnavailable`, `adapters/registry.ts › createAdapterRegistry`, `_data/catalog.ts` |
| F11 | No plan, price, period or Stripe link exists for dev orgs. `dev_orgs` has no plan column, `features/billing` has no `dev_` reference, and spec D5 says "pricing held". Limits on the page are invented except keys, and the real key limit differs: `MAX_ACTIVE_KEYS = 10` per project and env against the demo's 20. No endpoint or seat limit was found. | [V] `information_schema`, `SPEC-v1.md › D5`, `server/portal-admin.ts › MAX_ACTIVE_KEYS`, `usage.tsx › KEY_LIMIT` |
| F12 | There is no LLM client in the web app. `src` has no `@anthropic-ai/sdk` import and no `ANTHROPIC_API_KEY` reference. | [V] grep |
| F13 | `dev_end_users` has only `external_user_id`, no name. For Dopl App that id is the Dopl user id. Plan and region on the fixture users do not exist anywhere. | [V] `information_schema`, `sdk-lens.ts` header |
| F14 | The real portal has no Overview or Issues page. `/developers` redirects to logs, and the nav lists logs, usage, playground, keys, webhooks, org. | [V] `src/app/developers/page.tsx`, `_components/portal-frame.tsx › SECTIONS` |
| F15 | A channel message from the Mac writes nothing to `dev_*`. Only `/api/v1` calls log, through `withDeveloperKey`. Device-side inbox and answer moves change `dev_actions` but add no event. | [V] `server/with-developer-key.ts`, `server/glasses/sdk-glasses-port.ts` |

**Rules any build must follow** [V] `docs/INVARIANTS.md`:
- Pages never talk to Supabase, and an RSC and its API twin read the same service code (§2). Reads go in `features/device-sdk/server/`, scoped by `listPortalProjects`, the only place a user id becomes project ids.
- `dev_*` tables are service role only, with no RLS backstop, so the service is the fence.
- A route handler is at most 80 lines. Files are capped at 500 lines.
- Portal writes that act on credentials or devices need `sessionOnly` and a `write-gate-coverage.test.ts` update (§3).
- Migrations are applied by hand, by name (§12). A column written on every request needs a missing-column fallback and a test (§12, hot-path rule). This matters here: `logDevEvent` inserts a batch, so a missing column drops the whole batch with only a `console.error`.
- A column added to `dev_events` must also re-run `CREATE OR REPLACE VIEW dev_billable_events`, per that migration's header. It also touches `DeviceEventRowSchema`, `toPublicDeviceEvent` and the pin in `device-sdk-events-sql.test.ts`.

## 1. Element tables

Status key: **LIVE** today / **QUERY** data exists, needs query / **NEW** needs new data / **DECIDE** needs product decision / **CUT**.

Metric definitions used below (proposed, see Q4 and Q5):
- **Attempt:** a `dev_events` row for a deliver or device action call, excluding polls and replays.
- **Accepted:** an attempt with `outcome = ok`.
- **Delivered:** a `dev_actions` row with `status` in (`delivered`, `done`).
- **Delivered rate:** Delivered divided by Attempts.

### Overview (`_sections/overview.tsx`)

| Element | Status | Source | Work | Size |
|---|---|---|---|---|
| Page route and auth | NEW | `/developers/overview` via `_lib/load-portal.ts › loadPortal` | Add the page, add it to `SECTIONS`, make it the `/developers` redirect target | S |
| Project and env scope | LIVE | `portal/scope.ts › parsePortalParams` | Replace `usePortal().state.env` and `state.project`. Decide how `project=all` looks in the new one-project switcher | S |
| Header button "N open issues" | QUERY | `server/issues.ts` (new) | Count from the Issues read, excluding mutes | S |
| Test env banner | LIVE | `params.env` | Link "Switch to Live" through `portalHref` | S |
| "Scheduled maintenance" banner | CUT | Literal string; no status source exists | Delete. A hard-coded outage notice is the worst fake on the page | S |
| Stat: Deliveries, 7d | QUERY | `dev_events`, or `dev_actions.created_at` for accepted only | RPC (§2). Fixture `deliveries7d` does not exist | M |
| Delta on Deliveries, "6.1%" | QUERY | Same RPC, prior 7 days (within 30-day retention) | Compute. Show nothing when the prior window is empty, which is true today | S |
| Stat: Shown rate | QUERY + DECIDE | `dev_actions.status` over attempts | Same RPC. F7 means the label "seen by a device" is false. See Q4 | M |
| Delta on Shown rate, "0.8%" | QUERY | Same | Points difference, same empty rule | S |
| Stat: Active users, 7d | QUERY | `devices.last_seen` with `end_user_id`, or distinct `dev_events.external_user_id` | Pick one. Recommend an accepted delivery or a device seen in 7 days | S |
| Delta on Active users, "3 new" | QUERY | `dev_end_users.created_at` in the last 7 days | Count | S |
| Stat: Devices online, x of y | QUERY | `devices` (SDK shape, `revoked_at` null), `adapter.health` | **Do it in the service, not in SQL.** The window differs per adapter: G2 60s (`glasses/core/devices/service.ts › isOnline`), desktop 150s (`COMPUTER_ONLINE_WINDOW_MS`). Reuse `delivery-common.ts › toDevice` | S |
| Delta on Devices online, "2 fewer" | NEW or CUT | No history of online state exists | **Cut.** Replacing it needs presence snapshots. If a hint is wanted, use "seen today" from `last_seen` | S |
| Project summary sentence | QUERY | Same figures as the stats and top issue | Keep as a template over real numbers. Remove any claim the data cannot support | S |
| Ask input (free text) | DECIDE | No LLM exists (F12) | **Today it returns the same answer to any question, ignoring the words.** See Q3 | S to M |
| Question chip: "Why are deliveries failing?" | QUERY | `dev_events.error_code` groups | Deterministic answer from the Issues read | S |
| Question chip: "Which users need a relink?" | QUERY + NEW | `connections.status`, but nothing writes `needs_reauth` (F9) | Honest "None" until the writer exists | S |
| Question chip: "What changed this week?" | QUERY | The stat deltas, new users, new issues | Template | S |
| "Use activity logs" button | LIVE | Link to logs | Reword or drop. It is a link that looks like an attachment | S |
| "Last 7 days" footer | LIVE | Constant | Keep | S |
| Setup ring, "n of 5" | QUERY | The five below | One service call | S |
| Setup: Create an API key | LIVE | `dev_api_keys`, `server/portal.ts › listProjectKeys` | Filter on not revoked and not expired | S |
| Setup: Add a device | DECIDE | `state.integrations` has no table; `dev_projects` has only `branding` | Other lane owns it. Recommend deriving from any live `devices` row in this project and env | S |
| Setup: Connect a user | QUERY | `connections` with `status = active` | Count | S |
| Setup: Send a delivery | QUERY | `dev_actions` exists for project and env | `limit 1` | S |
| Setup: Receive a webhook | QUERY | `dev_webhook_endpoints`, `dev_webhook_deliveries.status` | "done" should mean one delivered, not one endpoint exists. Production has 0 endpoints, so this step shows pending | S |
| Next-step button | LIVE | First unfinished step | Keep; fix the links to the real pages | S |
| Deliveries chart, 14 days | QUERY | RPC daily buckets, UTC | **`dailySeries` is synthetic, built from a weekday shape.** Replace it. Reuse `portal/usage.ts › usageBuckets`, which needs a 14-day range added | M |
| Shown rate line, 14 days | QUERY | Same RPC | **The current line is `Math.sin` over a fixed value.** Replace it. The fixed `min=85` axis must go or 14% draws off the chart | S |
| Recent users list | QUERY | `dev_end_users`, last accepted action per user | Add a read. Name is missing (F13). See Q9 | S |
| Avatar stack | QUERY | Same | Initials of a UUID look wrong; depends on Q9 | S |
| Time since last delivery | QUERY | `dev_actions.created_at` per `end_user_id` | Same read | S |

### Issues (`_sections/issues.tsx`, `_data/issues.ts`)

| Element | Status | Source | Work | Size |
|---|---|---|---|---|
| Open / Muted segment | NEW | No mute storage exists (`state.mutedIssues` is local) | `dev_issue_mutes` table, session-only write route | S |
| Mute and Unmute button | NEW | Same | Shared per project and env, so a teammate sees it | S |
| List header "n open" | QUERY | Computed | Count | S |
| Row title, subtitle count, glyph | QUERY | Issue read | Replace the fixture; keep the `GLYPH` map plus a default | M |
| Issue: Stale pairings, `device_offline` | QUERY + DECIDE | `devices.last_seen`, `revoked_at`; `dev_events.error_code`, `device_id` | **Real in production** (F4). `stale` is not a stored state, so it is a threshold. See Q7 | M |
| Issue: Needs relink, `needs_reauth` | NEW | `connections.status`, `expires_at`; no writer (F9) | Empty until a writer exists. Add a `grant_expired` read now, because `connections.expires_at` and the policy code exist. A sweep that sets the status and emits the webhook is a job | M |
| Issue: Messages over the limit, `overflow.truncate` | QUERY, narrow | `dev_actions.result.truncated`, `route_decision.reason` | `deliver` only. `deviceAction` refuses rather than truncates, and all production traffic uses `deviceAction`, so this stays 0 for Dopl. The fixed `63` and the user list are invented. Query by `source = 'deliver'` | S |
| Issue: Webhook endpoint failing, `HTTP 500` | QUERY | `dev_webhook_attempts` joined to `dev_webhook_deliveries` for project and env | Group by endpoint for 7 days. Code is the most common `status_code` | M |
| Issues not in the demo: `capability_unsupported`, `grant_missing`, `grant_expired`, `rate_limited`, `vendor_error`, other | QUERY | `dev_events.error_code` | **Add a catch-all group per error code.** Without it, a Mac refusal (F10) would not appear on the page at all | S |
| Impact | QUERY | Count per group, last 7 days | From the read | S |
| First seen | QUERY, capped | `min(ts)` for the group | Retention caps this at 30 days. Display "30+ days" when it hits the edge; do not persist issues yet | S |
| "n users affected" and rows | QUERY | distinct `dev_events.external_user_id` | Webhook issues are the exception: attempts carry no user, and payload `Action` has no external id. **Show events or endpoints there, not users** | M |
| User "Open" link | Depends | Users lane | Needs the real user page | S |
| Why text | LIVE | `WHY` constants | Keep as copy, one line per group plus a generic | S |
| Code badge | QUERY | `error_code` | From the read | S |
| "Latest call" link | QUERY | newest `event_id` in the group; `server/portal.ts › getPortalEvent` | Activity lane's detail page | S |
| Fix: Revoke the stale pairings | NEW | `/api/developers/...` session route | **Only an API key route exists today** (`DELETE /v1/connections/{id}`). `revokeConnection` does not set `devices.revoked_at`, and `listDevices` filters only on that, so a revoked connection's device stays a candidate. Needs a portal route that revokes both, in one service function | M |
| Fix: Send relink links | DECIDE | D1 means no contact details for end users | Dopl cannot reach them. See Q8 | M |
| Fix: Review length rules | Depends | Receives lane | Link only | S |
| Fix: Open the endpoint | LIVE | `/developers/webhooks` | Link | S |
| Empty state | LIVE | Component | Keep | S |

### Usage (`_sections/usage.tsx`)

| Element | Status | Source | Work | Size |
|---|---|---|---|---|
| Internal-org behaviour | DECIDE | F2 | Without this ruling the whole page reads zero for the demo. See Q1 | S |
| Export button | QUERY | Current client CSV | Keep client-side. Build from all rows, not the fitted ones | S |
| Stat: This month | QUERY + DECIDE | RPC by period | **Fixture is week × 3.9.** Needs a period definition. Use calendar month UTC until plans exist | S |
| Hint: "% of 25,000" | DECIDE | No plan (F11) | Cut with the plan | S |
| Stat: Projected | QUERY + DECIDE | Linear run rate over the period | **`ELAPSED = 29/30` is hard-coded.** Compute from the date. Cut if plans are cut, since "over plan" means nothing | S |
| Stat: Delivered | QUERY | Same RPC as Overview | Share the function so the two pages cannot differ | S |
| Stat: Next bill | CUT | Nothing exists (F11) | Replace with a real figure, such as failed calls | S |
| Category filter | QUERY | `dev_events.device_kind`; catalog merges `home_hub` and `home_device` | Move the mapping out of `playground/_data` | S |
| Model filter | QUERY | `dev_events.model`, which holds `even_g2` while the catalog uses `g2` | Mapping needed | S |
| Null device rows | QUERY | Refusals that routed nowhere have null device fields | **Totals exceed the sum by model.** Show an "Unrouted" row, or the numbers look wrong | S |
| Range: 7 days, 30 days | LIVE, partly | `portal/usage.ts › USAGE_RANGES`, `server/usage.ts › readUsage` | Works on billable only, and costs up to 60 count queries. Replace with one RPC | M |
| Range: 90 days | NEW | Raw is pruned at 30 days | Hide, or use the rollup. See Q6 | S or M |
| Custom date range | QUERY, capped | Same | **Fixture hard-codes `month="2026-10"` and 365 days.** Cap at 30 days | S |
| Deliveries chart | QUERY | Same RPC | Replace `dailySeries` | S |
| Plan card, name, price, renewal | DECIDE | `PLAN` fixture only | See Q2 | S to L |
| Manage button and plan dialog | DECIDE | **Starter, Team and Scale prices are invented**, and only ever show a toast | Cut | S |
| Limit: Deliveries | DECIDE | No plan | Cut with the plan | S |
| Limit: Seats | QUERY + DECIDE | `dev_org_members` plus `dev_orgs.owner_user_id`, distinct. The owner may not be a member row. Limit is invented | Show a count, no limit | S |
| Limit: API keys | QUERY | Count of live keys against `MAX_ACTIVE_KEYS` | **Real limit is 10 per project and env, not 20.** Export the constant and use it | S |
| Limit: Webhook endpoints | QUERY + DECIDE | Count of `dev_webhook_endpoints`; no limit found | Show a count, no limit | S |
| Top by: Model | QUERY | Group on `dev_events.model` | RPC | S |
| Top by: User | QUERY | Group on `external_user_id` | RPC; name per Q9 | S |
| Top by: API key | NEW | F5 | Add `dev_events.api_key_id`. Older rows stay unattributed; show "Unattributed" | M |
| Column: Calls, 7d | QUERY | Same | **Column is fixed at 7 days while the chart has a range.** Make the table follow the range, and rename it | S |
| Column: Detail | QUERY | Users per model; devices per user; key kind | Small joins | S |
| Column: Share | LIVE | Computed client-side | Keep | S |

## 2. New tables, columns, jobs, endpoints

### Required
| Item | Purpose | Notes |
|---|---|---|
| `dev_events.api_key_id uuid NULL`, no FK | Top by API key; also feeds the Keys page `calls7d` | Hot path. Set in `withDeveloperKey › record`, keep it out of the public event shape, re-create the view. Apply the migration before deploy, with a §12 fallback |
| `dev_events.operation text NULL` | Clean delivery count: `deliver`, `action`, `poll`, `context`, other, plus a replay marker | Same migration and rules. Older rows stay null. Fixes F6 for good |
| RPC `dev_portal_metrics(project_ids, env, from, to, bucket, group_by)` | One grouped query for the stats, both charts and Top by | `SECURITY INVOKER`, pinned `search_path`, EXECUTE to `service_role` only. Replaces 60 counts in `readUsage`, which its own header flags as needing an RPC |
| `dev_issue_mutes (project_id, env, issue_key, muted_by, muted_at)` | Mute | RLS on, no policy, service role only |
| `server/overview.ts`, `server/issues.ts`, extended `server/usage.ts` | Reads | `issues.ts` is computed on read |
| Portal route to revoke a stale device and its connection; portal route to mute | Fix and Mute buttons | `withUserAuth`, `sessionOnly`, role check with `canManageKeys` or similar, coverage test update |

### Avoidable
- **A persisted `dev_issues` table.** Computed groups do the job. The cost is that First seen caps at 30 days and there is no "resolved" history.
- **Presence history.** Only needed for "2 fewer". Cut that delta.
- **Plan and billing tables, for now.** Held by D5.
- **`dev_events` rollup for the demo.** 7, 14 and 30-day reads on raw events use `dev_events_project_env_ts_idx` and volume is tiny (14 rows).

### Rollup versus raw, and what the 30-day limit does
| Reads raw safely | Breaks at 30 days |
|---|---|
| 7d stats and deltas (needs 14 days) | 90-day and custom long ranges |
| 14-day charts | **Monthly metering: a 31-day month loses its first hours to the prune**, so billing must never read raw |
| 30-day chart | First seen, capped |
| Top by, over at most 30 days | Year-over-year anything |

- `dev_actions` has no prune, so accepted delivery counts survive longer than events, but refusals do not. That table also grows without bound, as do the webhook logs (F8). Set retention for them before real traffic.
- **When plans or 90 days arrive:** add `dev_usage_daily (project_id, env, day, device_kind, vendor, model, api_key_id, attempts, accepted, failed, denied)`, upserted by a job that runs before the 09:15 prune and recomputes the last 2 days, because `dev_actions.status` moves after the call. Do not roll up distinct users, which cannot be summed across days.
- If billing reads it, the rollup must follow the same internal-org exclusion as `dev_billable_events`.

### Freshness
`dev_*` tables are service role only, so realtime cannot reach the browser, and the pages are server-rendered. For the demo, re-read on window focus and on a short interval on Overview and Issues. Events flush in `after()` so they appear within moments. Webhook sends wait on the per-minute cron (`vercel.json`), so a webhook row can lag up to a minute. [A] The cron runs in production; there is no row to prove it, since the outbox is empty.

## 3. Samuel's demo, for these pages

### Must be true
1. Overview and Issues exist under `/developers`, and the new Usage replaces the current one, shipped to wherever he demos from. Nothing in this worktree is live.
2. **Usage shows activity for Dopl App despite `internal = true`** (Q1). This is the largest single blocker on these pages.
3. **Fake-by-formula values are gone:** `dailySeries`, the `Math.sin` rate line, week × 3.9, `ELAPSED`, the fixed issue counts, the maintenance banner, the canned Ask answer, invented plan prices.
4. **The Mac and Google Home produce rows and count as devices. This is not achievable on these pages alone**, and depends on the devices lane:
   - The Mac has no SDK device row and its adapter refuses delivery (F10). Today, a send to it would show as a `capability_unsupported` failure.
   - A message typed on the Mac writes no row (F15), so "from my Mac" needs its own log entry.
   - Google Home needs an adapter, a pairing path and a device row. None exist. [V] `SPEC-v1.md › D2` names Home Assistant, not Google Home, as the first non-glasses target.
   - The Even simulator should work if it holds a real device token, since the G2 path updates `devices.last_seen`. [A] Not exercised for this plan. With a 60-second window it flips offline quickly if it stops polling.
5. **Current numbers will look bad without a decision** (Q10): 2 of 14 delivered, 12 refusals, 3 idle pairings.
6. Real sends happen before the demo, or the 14-day charts show one or two bars. Empty windows must render cleanly, and deltas must hide.
7. Pages refresh on focus, so switching back shows new rows without a reload.
8. A webhook endpoint exists if he wants step 5 of Setup done. **A notify never triggers one**, because only asks settle (F7) and connections were created by migration, not Connect. To show a webhook row he must send an ask and answer it.

### Can wait
Rollup and 90-day range; Top by API key if the column slips (hide that tab); Needs relink writer and sweep; `device.online` and `device.offline` emitters; mutes shared across a team (still small, though); plans and billing; retention on `dev_actions` and the webhook logs; free-text Ask.

### Still fake or weak if nothing more is done
- **Names:** users appear as a UUID, since Dopl App's external id is the Dopl user id (F13).
- **"Shown" or "Seen":** this means the inbox took the row, not that a person saw it (F7).
- **Any device count that includes the Mac or Google Home**, until the devices lane delivers.
- **Overflow** cannot appear for Dopl's own traffic, which uses the action route.
- **"Billable" language:** nothing is billed. Say so rather than imply it.

## 4. Questions only Samuel can answer

| # | Question | Recommendation |
|---|---|---|
| Q1 | Dopl App is internal, so usage is zero by design. How should Usage behave? | Keep the flag and keep `dev_billable_events` for billing. Add an activity read that includes internal orgs, and label the page "Internal, not billed". Do not flip `internal`. This relaxes the "usage reads the view" rule, so it needs his word |
| Q2 | Show a plan at all, given pricing is held (D5)? | No. Cut price, Next bill, Manage, delivery limit and Projected-over-plan. Keep real counts and the real key limit. **Inventing $249 on a screen shown to others is a risk, not polish** |
| Q3 | Is Ask a real model? | For the demo, chips answer deterministically from live data and the free-text box is removed. A later real version sends aggregates only, never content, and needs a key, a cost owner and a model choice |
| Q4 | "Shown rate" or "Delivered"? | Rename to Delivered and define it as "taken by the device". True "seen" needs an acknowledgement from each device; not for this demo |
| Q5 | What counts as one delivery for usage? | One accepted deliver or action call. Exclude polls, replays and refusals. Show refusals separately as failed. This also decides pricing later, so it should be explicit |
| Q6 | Keep the 90-day range? | Hide it now. Add it with the rollup, which real billing needs anyway |
| Q7 | When is a pairing stale, and what does the fix do? | Stale means idle 14+ days while the same user has a newer device. The fix revokes the device and its connection. Under this rule the 28.9 and 31.0-day devices qualify, the 4.1-day one does not |
| Q8 | "Send relink links": Dopl has no way to reach end users (D1). What should the button do? | Copy a fresh Connect link for the developer, and emit `connection.needs_reauth` so their backend can contact the user |
| Q9 | Should end users have display names? | Add an optional `dev_end_users.display_name` that the developer sets. For the demo, set it for his one user. Coordinate with the Users lane |
| Q10 | The existing 12 refusals and 3 idle pairings: keep, clean, or use? | Use them. Clicking Revoke on real stale pairings is a stronger demo moment than a clean page. The revoke acts on his own devices, so he should decide. Otherwise the refused rows age out around 2026-11-29 |

## 5. Build order

1. **Rulings:** Q1, Q2, Q4, Q5, then Q3, Q7. Everything below changes shape with these. No code.
2. **Metric core:** the migration (`operation`, `api_key_id`, view re-create) with the §12 fallback, the RPC, and a service with one definition of each figure. Migration applied by Samuel's process before deploy. (M)
3. **Usage:** smallest step that proves the core. Swap fixtures for the RPC, apply Q1 and Q2, cut the plan parts. (M)
4. **Overview:** stats, charts, setup, recent users, summary. No Ask yet. Add the page and nav. (M)
5. **Issues, read side:** computed groups with the error code catch-all, First seen, affected users. (M)
6. **Issues, write side:** mute table and route, revoke route and fix button. (M)
7. **Ask chips**, then focus refresh across all three pages. (S)
8. **Cross-lane check with the devices lane:** Mac and Google Home rows appear, in the right category filters and catch-all groups. Then a real rehearsal on production data. (S here; L in that lane)
9. **After the demo:** rollup, 90 days, needs_reauth sweep, online and offline emitters, retention on `dev_actions` and webhook logs, plans.
