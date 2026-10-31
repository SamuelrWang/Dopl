# Activity + Webhooks: wiring map for the real portal

Mapped 2026-10-31 in worktree `dev-portal-redesign`. Read-only. Nothing edited, run or started.

Tags: **[V]** verified in code or by SELECT. **[A]** assumption, not traced to the end.
Status words: LIVE today / DATA EXISTS, needs query / NEEDS NEW DATA / NEEDS PRODUCT DECISION / CUT.
"LIVE today" means the real portal (`src/app/developers/*`) already shows it. Nothing under `src/app/playground/developers` reads a database: `_components/portal-store.tsx` header says "No API, no DB".

## 0. Headline findings

1. **"Devices considered" verdicts and reasons are not stored.** [V] `dev_events.route_decision` and `dev_actions.route_decision` hold only `{target, reason, candidates: string[]}`. `reason` explains the winner, or the first filter that emptied the set. `delivery/router.ts › route` computes presence, capability and grant filters per device, then throws that away. The per-device "Skipped / Refused + reason" rows cannot be shown, even for past calls. Cannot be backfilled.
2. **Timeline stage timestamps are mostly not stored.** [V] See the table below. Only request end, action create and answer time survive. "Sent" and "Seen by device" are the same event today, and that event is not a render acknowledgement.
3. **`dev_events` and `dev_actions` cannot be joined.** [V] No shared id in either table (prod column list checked). `Request-Id` = `dev_events.event_id`; `delivery_id` = `dev_actions.id`; nothing records both. The Activity detail needs this join.
4. **Request rows lack method, path, HTTP status and key.** [V] `dev_events` has none of them. `with-developer-key.ts › record` has all of them in hand and uses status only to derive `outcome`.
5. **Traffic sources do not write the same logs.** [V] Only `/api/v1` writes `dev_events`. Google Home, `glasses_show`, the prosumer fallback, the reply mirror, hosted Connect steps and glasses device routes write nothing. **The Google Home half of the demo produces zero rows** (`dopl-desktop-app/main/google-home` is a local stdio MCP with no server call).
6. **Webhooks: sender is real and solid; emission is thin.** [V] Of 9 declared events, 3 can fire (`connection.created`, `connection.revoked`, `action.completed`). `action.failed` is declared and has an emit helper, but no production path can reach it. 5 have no emitter. Prod has 0 endpoints, 0 outbox rows, 0 deliveries.
7. **A failed row can sit beside a delivered message.** [V for mechanism, A for prod cause] A proven SDK refusal (e.g. `device_offline`) logs an error row, then `glassesNotify` falls back to the prosumer queue, which logs nothing. Prod shows 12 `device_offline` error rows of 14 events. On stage this would read as "Failed" while the glasses show the message.
8. **No live updating exists.** [V] Portal pages are server-rendered per URL with no polling or refresh. No `dev_*` table is in the `supabase_realtime` publication (SELECT returned none).

### Prod counts (SELECT, 2026-10-31) [V]
`dev_events` 14 (all live: 12 error `device_offline`, 2 ok; last 2026-10-30) · `dev_actions` 2 (both `source=action`, `delivered`, both lens-linked) · `dev_device_messages` 2 · endpoints/outbox/deliveries/attempts 0 · projects 1 · internal orgs 1 · SDK devices 4 (all `even_g2`, all live) · end users 1 · connections 4 · connect_sessions 0 · `sdk_delivery_users` 1 · `glasses_messages` 39.

### Pipeline: what is recorded per delivery [V]

| Step | Stored? | Where exactly | Gap |
|---|---|---|---|
| Accepted | Yes, derived | `dev_events.ts` is stamped at the END of the call (`events.ts › buildDevEvent`, called from `record`). Start = `ts - latency_ms.api`. `dev_actions.created_at` is the claim, after routing. | Validation time not separate. A held `ask` (up to 200s) pushes `ts` late. |
| Candidates | Ids only | `route_decision.candidates` = every device `toDevice` kept, including ones outside the target (`router.ts › route`: `ids = input.candidates.map`). Devices whose adapter is unavailable are dropped earlier and never listed. | Empty on pre-routing refusals. Always one id on device-level actions (`action-service.ts › deviceAction`: `reason: "explicit device"`). |
| Filters | **No** | Computed in `router.ts › route` step 1, discarded. Only the first emptying filter survives, as a string in `reason`. | Per-device verdict and reason lost. |
| Chosen device | Yes | `dev_actions.device_id`, `dev_events.device_id/kind/vendor/model/firmware/adapter_version`, `route_decision.reason`. | Fan-out extras only in `dev_actions.result.fanout`. |
| Rules version | Yes on events | `dev_events.profile_id`, `profile_version` (`delivery-common.ts › profileEventFields`). | Absent on routing refusals and on `dev_actions`. "Segment" stored nowhere. |
| Truncated | Partly | `result.truncated: true` and reason suffix "truncated to profile limits". | "4 of 7 lines" not stored. |
| Queued | Approximate | `dev_actions.created_at`; lens row `dev_device_messages.created_at`. No `queued_at`. | Fine as an approximation. |
| Sent | **Not distinct** | `dev_actions.status` moves to `delivered` when the glasses inbox reads the row (`glasses/core/messages/inbox.ts` → `markDelivered` → `lens-actions.ts`). The time is overwritten by later `updated_at` writes. | No `delivered_at`. `latency_ms.device_delivery` measures only the adapter call (a queue insert for G2), not reaching a device. |
| Seen by device | **No** | No ack route exists under `src/app/api/glasses/device/` (answer, channels, dismiss, home, inbox, launch, launch-options, pair, target, unpair, voice). | Demo copy "The device acknowledged the render" is false today. |
| Answered | Yes | `dev_actions.result.{index,label,answered_at}` or `{dismissed:true}`; `dev_device_messages.answer`. | `latency_ms.user_response` is declared and never set (grep: no writer). The event row is written once, before the answer when `respond-async`. |
| Expired | **No** | `sdk-glasses-store.ts › expireStale` moves the lens row only. `ACTION_STATUSES` has no `expired`; the action stays `queued` or `delivered` forever. | "No answer" must be derived from the lens row. |
| Notify finish | **No** | `lens-actions.ts › settlementFor` returns null unless `kind === "ask"`. A notify stays `delivered` forever. | No terminal state, no webhook. |

### Is every API call logged? [V] `with-developer-key.ts`

Logged, one row each: success, handler error, scope or publishable refusal, revoked or expired key, handler throw (`error_code` null, recorded as 500), body parse failure, idempotent replay.
**Not logged:** no key or unknown key (no project resolved); `GET /v1/events` (`logEvent: false`); rows failing zod (dropped with `console.warn`); failed batch writes (`console.error`, rows lost). Logging is fire-and-forget with `after()` flush, so loss is possible by design.
**Fields:** latency yes (`latency_ms.api`). Status no (only `outcome` ok/error/denied plus `error_code`). Key no. Method and path no.

### Traffic sources [V unless marked]

| Source | `dev_events` | `dev_actions` | Routing data | Notes |
|---|---|---|---|---|
| SDK `/v1` | Yes | deliver and action routes | Full `route_decision` on `deliver` | All `/api/v1` route handlers use `withDeveloperKey` (21 by grep, including `test/reset`). |
| `glasses_notify`, flag on, all links migrated, ttl 60 (default) | Yes (real HTTP call with `DOPL_APP_SDK_KEY`, `sdk-lens.ts › createDoplApp`) | `source=action`, one per device | One candidate, "explicit device" | Per-device idempotency key. Router never runs, so never a "considered" story. |
| `glasses_notify`, flag off, unmigrated link, ttl ≠ 60, or proven refusal | Refused call logs an error row; the fallback send logs nothing | None | None | `core/messages/service.ts › glassesNotify` writes `glasses_messages` and only `console.info`. |
| `glasses_show` | **No** | **No** | None | `service.ts › glassesShow` has no SDK branch at all. |
| `glasses_ask` / render via the display seam | Yes when SDK path is taken | `source=deliver` for asks, `target: "glasses"` | Full, through router | `sdk-lens.ts › sdkUserLens`. Prosumer fallback (`display/server/lens.ts`) logs nothing. |
| Reply mirror | **No** | **No** | None | `core/messages/reply-mirror.ts` uses the prosumer store. [A: exact call path not traced] |
| Connect API (`connect_sessions`, `exchange`, `connections`) | Yes | No | Not applicable | Wrapped. |
| Hosted Connect steps (`/api/connect/[token]/[step]`) | **No** | No | No | Only trace is the `connection.created` outbox row. |
| Prosumer migration (`migrate_prosumer_device`) | No | No | No | Prod: 4 connections, 0 connect_sessions, 0 outbox: these connections emitted no webhook. |
| Glasses device routes (inbox, answer, dismiss, voice) | **No** | Moves action status | No | Glasses presence, answers and voice are not rows. |
| Google Home | **No** | **No** | None | Local stdio MCP on the desktop. No adapter in `server/device-adapters.ts › wiredDeviceAdapters`. Cast output cannot answer or ack (`docs/specs/google-home/DESIGN.md`). |
| Desktop as a target | Refusal row | Failed | Possible | `device-adapters.ts › desktopUnavailable` always answers `capability_unsupported`. |
| SDK simulator adapter | Yes | Yes, `done` immediately | Full | Test env only (`delivery-common.ts › toDevice`). No lens row. Never emits a webhook. |

### Content retention and privacy [V]

| Store | Holds | Retention |
|---|---|---|
| `dev_events` | Metadata only: ids, kind, capability, intent, route, outcome, bytes. No message text. | 30 days (`/api/cron/device-sdk-events-prune`, daily) |
| `dev_actions` | `request_hash` (sha256), not the request. `result` holds the wearer's answer label and `lens_message_id`. `error.message` is server-written. | **None** |
| `dev_device_messages` | **Full content**: `payload`, `spec` (blocks), `answer`. G2 only. | **None** |
| `dev_webhook_outbox` | Full envelope, including `Action.result` answer label. | **None** |
| `dev_webhook_attempts` | First 1 KiB of the developer's response body. | **None** |
| `glasses_messages` | Full content, keyed to a Dopl user, no project or env. | Not traced [A] |

So the Activity row title (message text) exists **only for G2 sends**, via `dev_actions.result->>'lens_message_id'` → `dev_device_messages.id` (indexed: `dev_actions_device_lens_message_idx`). Simulator content is stored nowhere. All tables are service-role only with no RLS policy. `src/app/privacy/page.tsx` has no match for device SDK, glasses, webhook or retention wording [V for that file; copy may live elsewhere, A].

**Environment:** decided by the API key (`resolved.env` from the key; `dev_api_keys.env`) and repeated on devices. Dopl's own traffic uses a live key, and all prod rows are `live`. `portal/scope.ts › parsePortalParams` defaults to **`test`**, so `/developers/logs` opens empty for this project. The demo store defaults to `live` (`portal-store.tsx:80`). Internal org traffic is shown by default (`internal: first(raw,"internal") !== "0"`), but the log header counts `dev_billable_events`, so it reads **"0 billable calls"** for Dopl.

## 1. Page tables

### Activity (`_sections/activity.tsx`, `activity-detail.tsx`, `_data/activity.ts`)

| Element | Status | Source | Work needed | Size |
|---|---|---|---|---|
| Env badge, env scoping | LIVE today | `dev_events.env`; `scope.ts › parsePortalParams` | Default env must become project-aware or `live` when test is empty | S |
| Project scoping | LIVE today | `portal.ts › listPortalProjects`, `logProjectIds` | Reuse | S |
| Calls figure | DATA EXISTS | count over `dev_events` + deliveries | Today's page counts a page, not a total. Add count query | S |
| Succeeded % | DATA EXISTS | `dev_events.outcome` | Definition change: demo counts seen/answered/ok | S |
| Median time ("Accepted to sent") | NEEDS NEW DATA | `dev_actions.delivered_at` (new). `latency_ms.api` is available now | Relabel, or new column. Note a held ask inflates api latency | S |
| Needs a look figure | DATA EXISTS | `outcome`, delivery `status`, lens expiry | Derive | S |
| Export CSV | DATA EXISTS | Client export of loaded rows | Exports the loaded page only; say so or fetch server-side | S |
| Search (id, request, device, user, event) | DATA EXISTS | `event_id`, `device_id`, `external_user_id` | Exact match only without new indexes. Validate through `scope.ts` token rule | S |
| Type segment: Deliveries | NEEDS NEW DATA | `dev_events.action_id` (new) to classify | Without it, classify by `capability`/`intent` non-null | S |
| Type segment: Requests | LIVE today | `dev_events` | Rename | S |
| Type segment: Webhooks | DATA EXISTS | `dev_webhook_deliveries` | Merge second source into feed with a cursor | M |
| Status filter | DATA EXISTS | `outcome`, `dev_actions.status` | Map real statuses; see decision Q2. `seen` cannot exist | M |
| User filter | DATA EXISTS | `dev_events.external_user_id` | Options from a distinct query. No index on it; bounded by the ts index | S |
| Capability filter | LIVE today | `dev_events.capability`, indexed | Reuse | S |
| Time filter, date range | LIVE today (1h/24h/7d/30d) | `LOG_WINDOWS` | Custom range is new. 30-day retention caps it | S |
| Row title (message text) | NEEDS PRODUCT DECISION | G2 only, via lens join | Q1. Fallback title: intent + capability | M |
| Row meta (user, device, error) | DATA EXISTS | `external_user_id`, `devices.display_name`, `error_code` | Device name lookup; user name does not exist (external id only) | S |
| Row status badge | NEEDS NEW DATA | Join `dev_actions` | Needs `action_id` | S |
| When | LIVE today | `dev_events.ts` | Reuse | S |
| Detail: id, kind | LIVE today | `event_id` | Reuse. Show `delivery_id` too once joined | S |
| Detail: When, Took | LIVE today | `ts`, `latency_ms.api` | Reuse | S |
| Detail: User, Device | DATA EXISTS | as row meta | Lookup | S |
| Detail: truncated badge | NEEDS NEW DATA | `result.truncated` exists; kept/of does not | Store counts in `result` at `delivery-service.ts › finish` | S |
| Timeline: Accepted | DATA EXISTS | `ts - latency_ms.api` | Needs join for the rest | S |
| Timeline: Candidates | NEEDS NEW DATA | `route_decision.candidates` has ids only | Needs trace below for "x of y" | S |
| Timeline: Filters | NEEDS NEW DATA | Discarded in `router.ts › route` | Router trace | M |
| Timeline: Chosen device | LIVE today | `device_id`, `route_decision.reason` | Reuse | S |
| Timeline: Rules version | LIVE today | `profile_id`, `profile_version` | Show profile name + version | S |
| Timeline: segment | CUT | Stored nowhere | Drop for now, unless Receives work adds it | S |
| Timeline: Queued | DATA EXISTS | `dev_actions.created_at` | Join | S |
| Timeline: Sent | CUT as separate step | Same event as pickup | Merge into "Picked up by device", Q2 | S |
| Timeline: Seen by device | NEEDS PRODUCT DECISION | Needs a plugin ack for true "rendered" | Q2. Recommend relabel, backed by `delivered_at` | S (relabel) / L (ack) |
| Timeline: Answered | DATA EXISTS | `result.answered_at`, `result.label` | Read | S |
| Timeline: No answer (expired) | DATA EXISTS | Lens `status`/`expires_at` | Derive through lens join. Non-G2 has no expiry | S |
| Timeline: Read by the person | LIVE today (static text) | Always "unknowable" | `stepsOf` filters it out; keep | S |
| Devices considered | NEEDS NEW DATA | `route_decision` additive field | Router trace. Past calls show ids only | M |
| Attempts (webhook rows) | LIVE today | `dev_webhook_attempts` | Map; "note" text must be derived from `status_code`/`error` | S |
| Response code block | NEEDS NEW DATA | Demo synthesizes JSON. `dev_actions.response` real for actions; requests store no body | Show `dev_actions.response`, or for failures rebuild from `error_code`; do not fake | S |
| Method + path title | NEEDS NEW DATA | New columns | `record` adds them | S |
| Key prefix | NEEDS NEW DATA | New `api_key_id`; `dev_api_keys.prefix` | Note: `dev_api_keys` has no `name` column [V] | S |
| HTTP status | NEEDS NEW DATA | New column | `record` adds it | S |
| Copy ID | LIVE today | Client | Reuse | S |
| Open user | DATA EXISTS | External id | Depends on Users page work | S |
| `?call=` deep link, `find-anything`, Issues | DATA EXISTS | `getPortalEvent` | `_data/issues.ts`, `find-anything.tsx` read `ALL_CALLS` too: must move at the same time or show fake rows | M |
| Row added on Send/Test from other pages | CUT | `state.sentCalls` local only | Remove once real sends appear in the feed | S |

### Webhooks (`_sections/webhooks*.tsx`, `_data/misc.ts`)

| Element | Status | Source | Work needed | Size |
|---|---|---|---|---|
| Endpoints count | LIVE today | `portal-webhooks.ts › listPortalWebhookEndpoints` | Reuse | S |
| Healthy count, Failing state | NEEDS PRODUCT DECISION | Not stored; derive from recent deliveries | Q5 threshold | S |
| Sent, 7d | DATA EXISTS | `dev_webhook_deliveries.created_at`, `endpoint_id` (indexed) | Aggregate. An RPC or view fits; do not load rows | S |
| Delivered % | DATA EXISTS | `status='delivered'` over settled | Aggregate | S |
| Failed events | DATA EXISTS | `status='failed'` | "retrying" = pending with `attempts>0` | S |
| Endpoint name | LIVE today | `description` (nullable) | Reuse; fall back to host | S |
| URL | LIVE today | `url` | Reuse | S |
| Event chips | LIVE today | `enabled_events`; NULL = all | Render "All events" | S |
| Paused state | LIVE today | `disabled_at` → `status: disabled` | Reuse | S |
| Figure: Delivered, Sent, Last | DATA EXISTS | As above; Last = max `created_at` | Per-endpoint aggregate | S |
| Spark bars | CUT or DATA EXISTS | **Fake**: `barsOf` hashes the id characters | Daily counts or remove | S |
| See events / See failures | LIVE today | `listPortalWebhookDeliveries` | Reuse | S |
| Test button | NEEDS NEW DATA | No test event exists. `dev_webhook_outbox.event_type` CHECK and `WEBHOOK_EVENT_NAMES` forbid it | See section 3 | M |
| Pause/Resume button | NEEDS NEW DATA (write path) | `api.ts › updateEndpoint` exists, no portal route | Portal route. ⚠ Disabling dead-letters pending deliveries (`WebhookEndpointUpdateRequestSchema` comment) | S |
| Delete endpoint | NEEDS NEW DATA (write path) | `api.ts › deleteEndpoint` exists, not in demo UI | Add portal route + control | S |
| Event table: event, status, code, tries, created | LIVE today | `dev_webhook_deliveries` | Page spans one endpoint today; "All endpoints" needs a project-wide read, index on `(project_id, env, created_at)` absent | S |
| Search events | DATA EXISTS | `event_type` | Filter | S |
| Failed view | LIVE today | `status` | Add server filter | S |
| Event sheet: attempts | LIVE today | `dev_webhook_attempts` | Reuse. Attempts endpoint already returns duration and body preview | S |
| Event sheet: payload | DATA EXISTS | `dev_webhook_outbox.payload` by `outbox_id` | **Demo payload is invented** (`data: {user_id, device_id}`). Real one is an `Action` or `Connection`. Read must be service-side and project-fenced | S |
| Send again | NEEDS NEW DATA (write path) | `api.ts › replayDelivery`, RPC `dev_webhook_replay` | Portal route + kick. Refused while leased: handle "try again shortly" | S |
| Add endpoint: name, URL | NEEDS NEW DATA (write path) | `api.ts › createEndpoint` | Portal route with `canManageKeys` gate (API route uses `scopes: []`, so any key). Client regex is weaker than `url-guard.ts`; surface server error | S |
| Add endpoint: event tiles | LIVE contract, misleading | `ALL_WEBHOOK_EVENTS` matches the 9 names | **Defaults preselect `ask.answered`, which never fires.** See Q4 | S |
| Signing secret, shown once | NEEDS NEW DATA (write path) | `createEndpoint` returns real `secret`, Vault-stored | **`SECRET` is a hard-coded constant in `webhooks-add.tsx`** | S |
| Rotate secret | CUT from demo UI today, API ready | `api.ts › rotateSecret`, overlap default 24h, max 7d | Not in demo UI. Add to endpoint card after demo | S |
| Show secret again | CUT | Never readable by design | Keep impossible | S |

## 2. Webhook catalog

**Envelope, all events [V]** `webhooks/envelope.ts`: `{ id: "evt_<outbox uuid>", type, api_version (stamped at fan-out, SQL dev_webhook_fan_out), timestamp, livemode, data }`.

**Connection [V]** `connect/dto.ts › toConnection`: `id, external_user_id, status, device{id, kind, vendor, model, firmware, adapter_id, adapter_version, capabilities, online, last_seen_at}, grants[{scope, granted_at, expires_at}], created_at, revoked_at`.
**Action [V]** `action-service.ts › toAction`: `action_id, device_id, capability, status, result, error, created_at, updated_at`. Result on an ask: `{lens_message_id, index, label, answered_at}` or `{lens_message_id, dismissed:true, index:null, label:null}`. No `external_user_id` and no `intent`; a developer cannot tell whose answer it is without mapping `device_id`. `lens_message_id` is an internal id reaching customers.

| Event | Trigger | Payload | Emitted today | Where |
|---|---|---|---|---|
| `connection.created` | Hosted Connect consent | Connection | **Yes**, hosted path only. Not on `migrate_prosumer_device` | `connect/hosted.ts` (consent step) › `enqueueWebhookEvent` |
| `connection.revoked` | `DELETE /v1/connections/{id}`, first revoke only | Connection | **Yes** | `connect/service.ts › revokeConnection` |
| `action.completed` | Ask answered or dismissed on a G2 | Action | **Yes, asks on G2 only.** Not notify, display or simulator | `glasses/sdk-glasses-port.ts › sdkGlassesPort.settled` → `webhooks/action-events.ts › emitActionSettled` |
| `action.failed` | Intended: action fails | Action | **No, unreachable.** The helper handles `failed`, but its only caller passes `settle` rows and `settlementFor` patches only `done`. Failures in `deliver`/`deviceAction` emit nothing | `webhooks/action-events.ts › emitActionSettled` |
| `connection.needs_reauth` | Intended: grant needs reconnect | Connection (typed in `__fixtures__/dopl-sdk-webhooks.ts`) | **No.** Also nothing sets `needs_reauth` status; only read in `delivery/policy.ts › checkGrant` | none |
| `device.online` | Intended: presence up | Undefined: `Record<string, unknown>` | **No** | none |
| `device.offline` | Intended: presence down | Undefined | **No.** Presence is `last_seen` within 60s (`glasses/core/devices/service.ts › isOnline`), with no transition detection | none |
| `ask.answered` | Intended: answer. Ruling 2026-10-28 maps answers to `action.completed` instead | Undefined | **No** | none |
| `input.utterance` | Intended: device voice | Undefined; `adapter.ts › DeviceEvent` suggests `{type, device_id, ts, data}` | **No.** `delivery-service.ts › getContext` comment: not stored for SDK users yet | none |

**Declared, never emitted:** `connection.needs_reauth`, `device.online`, `device.offline`, `ask.answered`, `input.utterance`, plus `action.failed` (helper exists, unreachable).

**Sender facts [V]**
- **Signing:** Standard Webhooks. `webhook-id: msg_<delivery uuid>` (stable across retries and replays), `webhook-timestamp` per attempt, `webhook-signature: v1,<base64 HMAC-SHA256 of id.timestamp.body>`, key = base64 part of `whsec_` (`webhooks/signing.ts`). During rotation one signature per live secret, space-separated.
- **Retries:** 5s, 5m, 30m, 2h, 5h, 10h, 10h, ±10% jitter, then `failed` after 8 attempts, about 27h (`webhooks/retry.ts`). 2xx within 15s counts; redirects are failures (`webhooks/transport.ts`). Retries land on the minute tick.
- **Drain:** `/api/cron/device-sdk-webhooks-send` each minute (`vercel.json`), plus `runtime.ts › kickWebhookSender` from `connect/store.ts › insertOutbox` via `after()`. First attempt is normally seconds after the event.
- **Fan-out:** `dev_webhook_fan_out`; an endpoint created after the event never receives it.
- **At-least-once:** leased by claim token; a killed run re-sends with the same id.
- **Replay:** `POST /v1/webhook_deliveries/{id}/replay` → RPC `dev_webhook_replay`, resets `attempts`, refused during a live lease. Attempt numbers stay monotonic.
- **Rotation:** `POST /v1/webhook_endpoints/{id}/rotate_secret`, overlap 0 to 7 days, default 24h, secrets in Vault, expired ones pruned at each run.
- **URL rule:** https, port 443 or 8443, public host, no blocked addresses (`webhooks/url-guard.ts`). **localhost cannot be a demo endpoint.**
- **Portal today is read-only** (`src/app/developers/webhooks/page.tsx`): create, rotate, replay are API only.

## 3. New data, jobs and endpoints

**Migration, one file [required for demo]**
- `dev_events` add nullable: `action_id uuid`, `api_key_id uuid`, `http_method text`, `route text` (route template, never the raw path, so user ids stay in their own column), `http_status integer`. Partial index on `action_id`.
- `dev_actions` add nullable: `delivered_at timestamptz`, `settled_at timestamptz`.
- ⚠ Re-run `CREATE OR REPLACE VIEW dev_billable_events` (`SELECT e.*`; the migration's comment demands it). Update `DeviceEventRowSchema`, `EVENT_ROW_FIELDS` and `device-sdk-events-sql.test.ts`. Add new fields to `PRIVATE_EVENT_FIELDS` unless ruled public. `openapi.yaml` is described as frozen in places; stay additive.
- ⚠ INVARIANTS §12: `logDevEvent` is a hot path. A deploy before the migration fails each insert and silently loses rows. Needs apply-first, or the missing-column fallback with a test. Apply by name, byte-exact.

**No migration needed**
- Router trace: extend `RouteDecisionSchema` with an optional `considered: [{device_id, verdict: "chosen"|"skipped"|"refused", reason_code, reason}]`; both columns are jsonb. ⚠ zod strips unknown nested keys in `logDevEvent`, so the contract must change first. Also cover `deviceAction` and `send_to`. Public event exposes it; ruling needed only if reasons should stay private.
- Trace fields on `result`: truncated kept/of.
- Derived: retrying, No answer, Failing.

**New code**
- `features/device-sdk/server/portal-activity.ts`: merged feed + detail (event + action + lens status + deliveries), project-fenced, no content by default. Route ≤80 lines, shared with the page per INVARIANTS §2.
- `src/app/api/developers/webhooks/*`: create, update, delete, rotate, replay, test, reusing `webhooks/api.ts`, gated by `canManageKeys`. Pattern: `src/app/api/developers/keys`.
- Delivery aggregate query (per endpoint, 7 days).
- Client poll: see below.

**Emission fixes**
- `action.failed` and non-G2 `action.completed`: emit after final `updateAction` in `delivery-service.ts` and `action-service.ts`. S-M.
- `device.online/offline`: needs one column (`devices.presence_state`) and a sweep in the existing minute cron, plus a conditional write in `sdkGlassesPort.touch`. M. Not needed for demo unless shown; see Q4.
- `connection.needs_reauth`: nothing sets the status, so this needs a product trigger first. L, later.
- `input.utterance`: L, later.

**Test button.** Avoid a new event name and CHECK change: send a signed `webhook.test` body directly via `transport`, write no outbox row, return the result inline. It would not appear in the event table. Alternative if it must appear: contract + 2 CHECK changes + `WEBHOOK_EVENT_NAMES`. Recommend direct.

**Retention job.** Add purge for `dev_device_messages`, `dev_webhook_outbox`/deliveries/attempts and `dev_actions` beyond idempotency need, in the existing prune cron. Not demo-blocking.

**Can be avoided:** new event, trace or activity tables; realtime publication; a separate queue; a new cron; storing request bodies.

**Live updating [recommendation]** Short poll, not realtime. Client calls `GET /api/developers/activity?after=<cursor>` every 3s while the Activity or Webhooks tab is visible, stopping when hidden, using existing `dev_events_project_env_ts_idx` and `dev_actions_project_env_created_idx`. A new row must also refresh open rows, since a delivery's status changes after creation: re-read the last N actions by `updated_at` (no such index, but the set is bounded by project + env + created_at window).
Why not realtime: all `dev_*` tables are service-role only with no policy, so subscribers would need a new SELECT policy; INVARIANTS §7 charges WAL decode and RLS per write; `dev_events` takes one write per API call. The second-person test is arguably met here (devices and agents change what the viewer sees), but cost and the auth rework argue against it, and 3s reads well on stage. Latency: event appears ≤ flush after response + poll. Webhook rows appear within seconds through the kick.

## 4. Samuel's demo

**Demo flow as I read it [A]:** the desktop app or an agent sends → G2 simulator (Even Hub) shows it → an ask gets answered → Google Home speaks or shows → switch to the portal → logs, devices, webhooks.
The Even Hub simulator is treated as a real `even_g2` device with a token, in the live env [A, from project memory]. The SDK `simulator` adapter is a different thing and test-only.

**Must be true**
1. Portal opens on project "Dopl App", env `live`. Default env fixed.
2. Dopl's desktop-originated sends use the SDK path: flag on, all links migrated. Stale links block this: prod has 4 SDK devices and any unmigrated active link sends everything to prosumer, unlogged.
3. Clean up stale paired devices before the demo. **`device_offline` refusals plus fallback produce "Failed" rows next to delivered messages** (finding 7). Either fix logging or make sure devices are online. Presence window is 60s.
4. Prefer an ask or `deliver` target for the money shot. `glasses_notify` uses device-level actions: one candidate, "explicit device", no routing story. `glasses_show` logs nothing, so avoid or wire it.
5. Migration + router trace + `action_id` shipped. Otherwise the detail shows only ids.
6. Timeline labels match reality (Q2).
7. Activity page reads real rows and polls.
8. Google Home appears in Activity (Q3), or the presenter does not claim it. Today it is absent.
9. Webhooks: one real public endpoint (`url-guard` forbids localhost), created through a real flow with a real secret; default events changed so it actually receives something. Only `action.completed` will fire during an ask. A `connection.created` fires only if a device pairs through hosted Connect during the demo.
10. Demo-time rows only: empty prod means a thin list, which is honest; rehearsal rows cover it.

**Can wait:** `device.*`, `needs_reauth`, `input.utterance` emission; secret rotation UI; custom date range; export beyond page; retention purge; test-button persistence; spark bars; `user_response` latency; response bodies for plain requests.

**Viewer would see as fake if not replaced**
- `_data/activity.ts`: every call, including generated "Larkfield" field-service messages; `DEMO_NOW` freezes time.
- Devices-considered reasons and every timeline millisecond (seeded RNG).
- "Seen by device: the device acknowledged the render".
- Response code block (synthesized in `activity-detail.tsx`).
- `SEED_ENDPOINTS` rates and counts; `barsOf` spark; `whsec_9Kp2mXv7Lq4Rt8Nc3Yb6Hd`.
- Test and Send again buttons (toast only, nothing sent). Pause changes local state only.
- Event sheet payload shape.
- `find-anything` and Issues feeding from `ALL_CALLS`.
- Route labels in seeds that do not exist: `/v1/deliver`, `/v1/connect/sessions`, `/v1/devices/{id}/actions` (real: `/v1/users/{id}/deliver`, `/v1/connect_sessions`, `/v1/devices/{id}/actions/{capability}`).
- Key scopes in `KEY_SCOPES` (`deliver`, `webhooks.write`) differ from real scope names (`actions:write`, `analytics:read`, `connect`). [V for those seen; Keys page mapper owns this.]

## 5. Questions only Samuel can answer

1. **Show message text in Activity?** Only G2 has it stored, indefinitely. *Recommend:* yes for the project's members, read through the lens join, purged at 30 days, labelled absent for other devices; no copying into `dev_events`. Update privacy copy before customers use it.
2. **Timeline wording, given no render ack?** *Recommend:* steps become Accepted, Candidates, Chosen, Rules, Queued, **Picked up by device**, Answered. Skip the plugin ack for now (plugin release, L). Portal must not say "seen" without one.
3. **How does Google Home appear?** It is local-only with no server path. Options: (a) desktop posts a log row to a new authenticated route after each Cast; (b) a real adapter; (c) leave it out and show it separately. *Recommend:* (a) for the demo, honestly labelled "sent from desktop, no acknowledgement". It needs a project key or a signed-in route, and a desktop release. Coordinate with the Devices/Integrations mapper.
4. **`ask.answered`: emit or retire from the picker?** Ruling 2026-10-28 chose `action.completed`, yet the picker preselects it. *Recommend:* keep the ruling, default the picker to `action.completed` + `connection.*`, and mark never-emitted events as "Coming soon" or hide them. Showing unfired events on stage invites a question with a bad answer.
5. **When is an endpoint "Failing"?** *Recommend:* last 3 settled attempts failed, or under 90% over 24h with at least 10 sends. Matches the UI's existing `LOW = 90`.
6. **Should a notify ever be "done"?** Today it stays `delivered`, so never `action.completed`. *Recommend:* treat pickup as terminal for notify and display, emit `action.completed` then. It changes customer-visible semantics, so it needs your word. Worth doing: otherwise a plain message fires no webhook during the demo.
7. **How to treat SDK refusal followed by fallback?** *Recommend:* have the fallback path write a `dev_events` row with a route reason "fallback: prosumer queue", so the log tells the truth. Requires a small logging call outside `withDeveloperKey`; it also touches the one-row-per-call contract.
8. **Which demo receiver URL?** *Recommend:* a small public receiver you control, showing verified signatures. Third-party request bins put your payloads on someone else's server.
9. **Is Dopl's internal project the right demo project?** It reads "0 billable calls" and is excluded from usage everywhere (`dev_billable_events`). *Recommend:* keep it as you described, hide the billable figure on internal projects. Usage mapper should weigh in.

## 6. Build order

1. **Contract + migration:** new `dev_events` and `dev_actions` columns, view rebuild, tests, fallback. Apply to prod first. (S-M)
2. **Write path:** `record` writes method/route/status/key; `deliver` and `deviceAction` annotate `action_id`; lens move stamps `delivered_at`/`settled_at`. (S)
3. **Router trace:** `considered` in `router.ts`, contract, deviceAction. Start early: history cannot be backfilled. (M)
4. **Truth fixes:** fallback log row (Q7), expired derivation, notify terminal (Q6), `action.failed` and non-G2 emits. (M)
5. **Read layer:** `portal-activity.ts`, default env fix, feed merge, detail, deep links. (M)
6. **Activity UI wired:** replace `useCalls`, statuses, timeline labels, polling. Move `find-anything` and Issues off `ALL_CALLS` or coordinate. (M)
7. **Webhook portal routes:** create, pause, delete, replay, direct test. (S-M)
8. **Webhooks UI wired:** real endpoints, aggregates, payload from outbox, real secret, picker defaults. (M)
9. **Google Home row** (Q3), with desktop release. (M)
10. **Rehearsal:** real receiver, clean device list, dress run with live rows. (S)
11. **After demo:** presence events, rotation UI, retention purge, needs_reauth, utterance, plugin ack.
