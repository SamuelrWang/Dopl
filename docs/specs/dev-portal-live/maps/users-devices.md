# Dev portal live-data map: Users and Devices

Read-only mapping, 2026-10-31. Worktree `dev-portal-redesign`. No code, test or server was run. Production was queried for schema and counts only.

**Status legend.** LIVE = LIVE today. DATA = DATA EXISTS, needs query. NEW = NEEDS NEW DATA. DECISION = NEEDS PRODUCT DECISION. CUT = recommend cutting.
**Path legend.** `S/` = `src/features/device-sdk/server/`. `D/` = `src/features/device-sdk/delivery/`. `PG/` = `src/app/playground/developers/`. `C/` = `packages/device-contracts/src/`.
**Evidence.** Everything cites `path › symbol` and is verified unless marked **[assumption]** or **[proposal]**.

## 0. Facts that shape everything

**Production state (counts, 2026-10-31):**

| Object | Count |
|---|---|
| orgs / projects | 1 / 1, the internal "Dopl App" |
| end users | 1, live env |
| SDK devices | 4, all `even_g2`, all live env, all migrated (`legacy_source` set) |
| SDK devices seen in 10 min / 7 days | 1 / 2 |
| SDK devices with firmware | 0 |
| connections | 4 active, 0 `needs_reauth` |
| `context_profiles` rows | **0** |
| `dev_actions` | 2, both `source=action`, `present.notify`, `delivered` |
| `dev_events` | 14, of which 12 `device_offline` and 2 ok. All `present.notify`. Newest 2026-10-30 |
| webhook endpoints / outbox | 0 / 0 |
| test env rows | 0 |
| Desktop devices | 2 active, all still prosumer-shaped, none SDK-owned |

**Code facts:**

1. **No real Users or Devices page exists.** `src/app/developers/` has keys, logs, usage, org, playground and webhooks only. No endpoint lists end users or lists devices: `docs/specs/device-sdk/openapi.yaml` has `GET /devices/{id}` and `GET /users/{id}/connections`, nothing enumerating. Every table below therefore needs a portal read, even where the columns exist.
2. **`dev_end_users` holds only** `id, project_id, env, external_user_id, created_at`. No name, plan, region, preferences or last-active (`20261122100000_device_sdk_tenancy.sql`, confirmed on prod).
3. **Profiles are read and honoured at delivery, but nothing writes them.** `S/delivery-store-supabase.ts › listProfiles` reads them and `D/resolve-profile.ts › resolveProfile` applies them. The only code referencing `context_profiles` is that reader. Prod has 0 rows.
4. **A profile is a strict object.** `C/context.ts › ContextProfileSchema` allows `prompt_append, output{max_lines,max_chars,format,markdown}, allowed_capabilities, display_template, confirmation (per TIER), overflow`, with `match` on `kind/model/posture`. An extra key fails validation and `profileFromRow` **silently skips the whole row**. Adding `priority` to `body` would quietly disable the profile.
5. **A profile replaces, it does not layer.** `resolveProfile` picks one profile and there is no field-level inheritance. The demo's Default → Category → Model → Segment chain must be compiled into full rows at publish time **[proposal]**.
6. **The agent's plain notify path skips enforcement.** `src/features/display/server/sdk-lens.ts:402` sends notices with `dopl.devices.action(...)`. `S/action-service.ts › deviceAction` has no `enforce` call, and only `S/delivery-service.ts › deliver` does. Asks use `users.deliver` (`sdk-lens.ts:268`). All 14 prod events have `intent = null`. **So max lines, max chars and overflow do not affect a Dopl notice today.** `allowed_capabilities` and confirmation do.
7. **Mac delivery is refused by design.** `S/device-adapters.ts › desktopUnavailable` returns `capability_unsupported`. `S/connect/hosted.ts › PAIRING_STYLE` offers only `simulator` and `even_g2`.
8. **Google Home has no adapter.** Registry is `even_g2, desktop, simulator` (`S/device-adapters.ts › wiredDeviceAdapters`). The name appears only in the demo catalog, marketing docs and `SPEC-v1.md:357` (❌ P1). Nothing can reach a Google device today.
9. **The `simulator` adapter is not the Even simulator.** It is test-env only, draws no screen, and completes instantly (`adapters/simulator.ts`). **[assumption]** Samuel's "simulator for Even Realities" is the Even Hub simulator running the Dopl plugin. That would be an ordinary `even_g2` device to the backend, with nothing marking it as simulated.
10. **Internal traffic is hidden twice.** `portal/scope.ts › logProjectIds` drops internal projects unless the filter is on, and `S/usage.ts` reads `dev_billable_events`, which excludes them. Dopl App is internal, so new pages copying either pattern will show **zero** in Samuel's demo.
11. **`dev_events` over-counts.** Polls (`getAction`, reason `poll: …`) and replays (`idempotent replay: …`) log a row with a capability. Refusals appear only here, never in `dev_actions`. Any delivery figure must account for both.
12. **Revoking a connection leaves the device row live.** `S/connect/service.ts › revokeConnection` updates only `connections`. `store.revokeDevice` is called only for pairing cleanup in `hosted.ts`. Fleet reads must join active connections and not trust `devices.revoked_at`. (The prosumer-migration header says the opposite; the code does not do it.)

**Rules for the build (INVARIANTS §2, §3, §12):**
- Reads go in `S/`, obtain their own `supabaseAdmin()`, and filter by project and env. Service role bypasses RLS, so reach comes only from `listPortalProjects`.
- Writes go in `/api/developers/*` with `withUserAuth({ sessionOnly: true })`, roles checked in `S/portal-admin.ts`, and must pass `write-gate-coverage.test.ts`.
- New tables are service-role only (RLS on, no policy, asserted by a `DO` block), additive, no backslashes in SQL, applied by name.
- A column added to a hot-path read needs a missing-column fallback and a test (§12). `listProfiles` and `findEndUser` are hot-path: do not add new columns to their selects.

## 1. Element tables

### 1.1 Users list: `PG/_sections/users.tsx`, `users-table.tsx`, `users-toolbar.tsx`

| Element | Status | Source | Work needed | Size |
|---|---|---|---|---|
| Page shell, Test badge, env | DATA | `portal/scope.ts › parsePortalParams`, `app/developers/_lib/load-portal.ts` | Replace `usePortal` with URL state; include internal projects by default when selected | S |
| Export | LIVE once rows are real | Client CSV, `users-model.ts › usersCsv` | Exports loaded rows only; acceptable until paging is server-side | S |
| Stat: Total users, hint "N Team, N Pro…" | DATA for count, NEW for plan hint | `dev_end_users` count | Drop the plan hint unless plan is added | S |
| Stat: Active 7d, "N today" | DATA | `max(devices.last_seen)` per user | Define active as device seen. Alternative is last `dev_events.ts` | S |
| Stat: Devices per user, "N devices, N online" | DATA | `connections` active join `devices`; online from adapter `health` | Compute online with the adapter window, not a stored flag | S |
| Stat: Users with issues, "relink, stale, low success" | DECISION | Derived, see Q5 | Needs definitions of relink and stale | M |
| Search | DATA | `external_user_id`, `devices.display_name`, `devices.id` | Add name once it exists | S |
| Quick views: All, Online, Needs attention, Inactive | DATA, except attention (DECISION) | As above | Note demo "Online" is "has any online device" | S |
| Filter: Category | DATA | `devices.kind` to category constant | Mapping constant; Home merges `home_hub` and `home_device` | S |
| Filter: Integration | DATA | `devices.adapter_id` | Mapping constant | S |
| Filter: Model | DATA | `devices.model` | Real values are `even_g2`, `simulated_<kind>`; backfill wrote `macos`. Demo ids `g2`, `macos` must map | S |
| Filter: Firmware | NEW, CUT for demo | `devices.firmware`, no writer, 0 prod rows | See 1.4 firmware row | S to cut |
| Filter: Last active | DATA | As Active 7d | Note the label "Over 2 days ago" is keyed `over7` | S |
| Saved views button, seeded views | CUT for demo | No table; `SEED_VIEWS` | Portal state is already linkable through the URL; persist later if wanted | S |
| Filter chips, Clear | LIVE once rows are real | Client state | None | S |
| Empty states | LIVE once rows are real | Client | None | S |
| Column: User initials, name | NEW | No name column | Add `display_name`; fall back to `external_user_id` | S |
| Column: User ID | DATA | `external_user_id` | For Dopl App it is a Dopl user uuid (D1 deliberately broken for internal) | S |
| Column: Devices chips, dot, +N | DATA | `devices` + active `connections`, health | Fleet read | M |
| Column: Active device | DATA | `D/router.ts › activeDevice` rule, most recently seen online | Reuse the rule. Windows: G2 60s, desktop 150s | S |
| Column: Last delivery | DATA | `max(dev_actions.created_at)` | Include both `source` values; prod has only `action` | S |
| Column: Success | DATA, DECISION on formula | Numerator `dev_actions.status in (delivered, done)`; denominator adds refusals from `dev_events` excluding polls and replays | Group-by RPC **[proposal]**. Prod today would read about 14% | M |
| Column: Status | DECISION | Derived | Q5 | S |
| Sort and pager | DATA | Client today | Client is fine at current scale; server paging later | S then M |

### 1.2 User side sheet: `users-sheet.tsx`

| Element | Status | Source | Work needed | Size |
|---|---|---|---|---|
| Name, id | As list | | | |
| Plan, Region in subtitle | NEW / DECISION | No columns | Q3. Hide if null | S |
| Status badge, "Last delivery" | As list | | | |
| Deliveries 7d | DATA | `dev_actions` | Shared read | S |
| Seen 7d | DATA | `dev_actions.status`; `S/glasses/lens-actions.ts › markDelivered` moves queued to delivered when the inbox takes it | "Seen" really means handed to the device inbox. Label accordingly or accept | S |
| Success | DATA | As list | | S |
| Device row: name, active dot | DATA | `devices.display_name` | Prod names come from the prosumer link | S |
| Device row: model | DATA | `devices.model` | Mapping | S |
| Device row: firmware | NEW | See 1.4 | Hide when null | S |
| Device row: state badge, last seen | DATA / DECISION | `last_seen`, adapter health | Q5 | S |
| Latest deliveries: capability, device, status, when | DATA | `dev_actions` | Metadata only. Never read `dev_device_messages.payload` | S |
| Send test | DATA, needs endpoint | Today `PG/_components/test-delivery.ts` fabricates a "seen" call | New session-only portal route calling `S/delivery-service.ts › deliver` with project + env from reach check. The existing playground route is test-key only, so it cannot serve live | M |
| Relink link | DATA, needs endpoint | Today a fake `connect.larkfield.example` URL. Real: `S/connect/service.ts › createConnectSession` | New portal route. Caveat: pairing creates a **new** device row, and the old one stays until cleaned up | M |
| Open full page | DATA | Route | Real route under `/developers/users/[id]` | S |

### 1.3 Full user page: `user-page.tsx`

| Element | Status | Source | Work needed | Size |
|---|---|---|---|---|
| Crumbs, title, online face | DATA | As list | | S |
| Meta: id | DATA | `external_user_id` | | S |
| Meta: plan, region | NEW / DECISION | None | Q3 | S |
| Actions: Relink link, Send test (dialog, device picker, "Let routing choose") | DATA, needs endpoints | As sheet; `target` is a device id or `auto` in `deliver` | Shared with sheet | S after sheet |
| **Devices tab** strip: Devices, Deliveries 7d, Success, Last delivery | DATA | As list | | S |
| Device card: name, state pill, trail | DATA | `devices`, mapping | | S |
| Device card: Simulated pill | DATA, partial | `adapter_id = simulator` only | Even Hub simulator cannot be detected (fact 9) | S |
| Device card: Relink | DATA, needs endpoint | Today flips local state to online, a false outcome | Real session; state changes only when pairing happens | S |
| Device card: Revoke | DATA, needs endpoint | `S/connect/service.ts › revokeConnection` | Portal route, session-only, role-gated. Also decide on revoking device and credential (fact 12) | M |
| Firmware, Last seen, Paired, Deliveries 7d | NEW for firmware; DATA for rest | `last_seen`, `connections.created_at`, `dev_actions` | | S |
| Grant chips, shown % meter, device id | DATA | `connections.granted_scopes` | | S |
| **Deliveries tab**: list + call panel | DATA | `dev_actions` + `dev_events` | Shared with Activity page owner. Row title must not show message text | M |
| **Grants tab**: per capability Granted / Not granted, tier chip | DATA, tier LIVE | `S/grant-store.ts › grantFromRow`, `connect/scopes.ts`; tiers from contracts | Capabilities from `adapter.describe()`, not the catalog | S |
| **Preferences tab**: Tone, Language | CUT | Nothing stores or reads them. Dopl never rewrites (D3), so these could only be guidance | Remove | S |
| Preferences: Quiet hours, Preferred device, Blocked devices | NEW + enforcement / DECISION | No table, not in router | Q4. Hide for demo | L if kept |
| **Webhooks tab** | DATA, poor fit | `dev_webhook_deliveries` has no user column; user sits in `dev_webhook_outbox.payload`. Prod: 0 endpoints | JSON filter, no index. Hide for demo | M |

### 1.4 Devices catalog: `devices.tsx`, `devices-card.tsx`, `devices-toolbar.tsx`, `devices-model.ts`

| Element | Status | Source | Work needed | Size |
|---|---|---|---|---|
| Add device button | See 1.5 | | | |
| Stat: Models, "N live, N testing" | NEW | No record of which integrations a project added | Table or derivation, Q6 | S |
| Stat: Connected devices, online, users | DATA | Fleet read | | S |
| Stat: Shown 7d, calls | DATA | Fleet read | Must not use `dev_billable_events` (fact 10) | S |
| Stat: Devices with issues | DECISION | Q5 | | S |
| Search, quick views | LIVE once rows are real | Client | "Testing" needs Q6 | S |
| Category chips, section headings, device totals | LIVE constant | Code constant | Move `CATEGORIES` out of the playground | S |
| Integration, Function filters | LIVE constant | Catalog + contracts | | S |
| Card: name, integration, glyph | LIVE constant | Catalog | Real source: code constant keyed by adapter. Do not build a catalog table | S |
| Card: Live / Testing badge | NEW | Q6 | | S |
| Card: "N need attention" | DECISION | Q5 | | S |
| Card: function chips | LIVE for G2 and macOS | Catalog lists equal adapter descriptors for both | Derive from `adapter.describe()` so they cannot drift; previews stay constants | S |
| Figure: Shown 7d + meter, Users, Online | DATA | Fleet read grouped by adapter + model | | S |
| Foot: "N of M tests passed" | NEW | Client timers only; no persistence | Q6 | M |
| Foot: Spark bars | **Fake** | `devices-model.ts › weekBars` is a hash of the model id | Daily counts per model, or cut | S |
| Foot: "N calls" | DATA | Fleet read | | S |
| Next-action button | Derived | Follows above | | S |
| Add new device card, available models | LIVE constant + Q6 | Catalog minus added | | S |

**Firmware.** `devices.firmware` exists, but `S/connect/hosted.ts › createDevice` never sets it and no code updates it. `dev_events.firmware` copies the null. Nothing under `apps/` reports firmware. Prosumer `desktop_devices` has `os_version` and `app_version`, and the backfill put `os_version` in `firmware`. **[assumption]** Whether Even Hub exposes G2 firmware to the plugin is unchecked. Reporting it means a header on the device routes plus an update beside `S/glasses/sdk-glasses-port.ts › touch`. Size M, not demo-critical.

### 1.5 Add-device popup: `add-device-dialog.tsx`, `add-device-steps.tsx`

| Element | Status | Source | Work needed | Size |
|---|---|---|---|---|
| Step 1 Category tiles, "N available" | LIVE constant + Q6 | Catalog | | S |
| Step 2 Model tiles, function chips, Coming soon | LIVE constant | Catalog | Coming-soon entries are selectable today and fake-pass tests; block them | S |
| Step 3 Simulator / Real hardware | DECISION | Simulator is test-env only | Live env must not offer it (`createAdapterRegistry`) | S |
| Step 4 Hardware: QR, code `K7Q294`, Confirm pairing | **Fake** | Hard-coded; `QrPattern` seeded by model id. Real: `createConnectSession` → hosted `/connect/{token}`; for G2 the code is **entered**, not shown (`PAIRING_STYLE.even_g2 = enter_code`) | Portal route makes a session for a test end user, QR encodes real URL, poll for the connection | M |
| Step 4 Simulator screen and controls | **Fake** | `PG/_components/device-simulator.tsx`: "Nothing leaves the page" | Real sim = test-env Connect device + `/v1` calls. Adapter draws nothing, so the screen must come from the payload | L |
| Step 5 Tests: rows, Run, Run all, n of m | **Fake** | `TestsStep › run`: passes after a 420 ms timer regardless | Real `deviceAction` per capability, read outcome. `input.*` and `capture.*` cannot be tested this way | L |
| Tier chip on test rows | LIVE | `CAPABILITY_RISK_TIER` | | S |
| Step 6 Review, warning | NEW | From above | | S |
| Keep testing / Go live | NEW | No state; Q6. Nothing gates traffic on it | Table; decide if Go live gates anything | S |

### 1.6 Device page, header and Overview: `integration-page.tsx`

| Element | Status | Source | Work needed | Size |
|---|---|---|---|---|
| Crumbs, name, glyph | LIVE constant | Catalog | | S |
| Adapter string | LIVE | Real form `even_g2@0.1.0`, `desktop@0.1.0` from adapter; previews are invented | Read from registry | S |
| Live / Testing / Coming soon | NEW | Q6 | | S |
| Model picker | LIVE constant | | | S |
| Test in Playground | DATA | Existing `/developers/playground` is test-key only and takes no `?model` | Link owned by the Playground mapper | S |
| Coming-soon page, planned capabilities | LIVE constant, invented | Preview capability lists are not from adapters | Keep as "planned" or cut | S |
| Stat: Connected users, devices | DATA | Fleet read | | S |
| Stat: Devices online | DATA | Adapter health | | S |
| Stat: Deliveries 7d, seen | DATA | `dev_actions` | | S |
| Stat: Shown rate | DATA, DECISION on formula | As Success | | S |
| Deliveries chart | **Fake** | `dailySeries` distributes a total | Daily group-by. `dev_actions(project_id, env, created_at)` index exists | M |
| Readiness: Capability tests | NEW | Q6 | | S |
| Readiness: Live rules vN, Test rules vN | NEW | Prod has 0 rows; shows Dopl default | Show `even_g2-default v1` when no project row exists | M |
| Edit rules | LIVE | Tab switch | | S |
| Model table: Model, capabilities | LIVE | Adapter | | S |
| Model table: Firmware | NEW | Shows "None seen" honestly | | S |
| Model table: Users, Shown | DATA | Fleet read | | S |
| Latest calls: title, capability, status, when, All calls | DATA | `dev_actions` / `dev_events` | No message text; title = capability + target | S |

### 1.7 "What it receives": `receives.tsx`, `receives-fields.tsx`, `receives-preview.tsx`, `_data/receives.ts`

**Summary.** The enforcement engine is real and tested for `deliver`. The editor's model is richer than the contract. Six of the thirteen fields (Priority, Fallback, Inbound template, Allowed intents, Ask options, Answer timeout) have no runtime meaning, and the Callback URL is a seventh.

| Element | Status | Runtime truth | Work needed | Size |
|---|---|---|---|---|
| Scope: category, all models | DATA, needs compile | `match.kind`. Home needs two rows (`home_hub`, `home_device`) | Compile on publish | M |
| Scope: this model only | DATA | `match.model` with specificity 4, resolved in `best()` | Must be a full row, not a delta (fact 5) | M |
| Segment picker (`plan:*`, `region:*`) | CUT | `ProfileSubject` has only kind, model, posture. Plan and region do not exist | Removing is S. Building is L (columns, ingest, contract, resolver) | S |
| Draft badge | NEW | No draft store | Draft table **[proposal]** | M |
| Test vN / Live vN | DATA | `context_profiles.env` + `version`, unique per project + env + profile | Write path missing entirely | M |
| Publish to Test | NEW endpoint | Insert `env=test` rows at next version | Session-only route, role gate | M |
| Publish and promote to Live, Promote | NEW endpoint | Insert `env=live` rows with the same version | Same | S after above |
| Versions list: vN, Live, Test tags | DATA | Rows by version | | S |
| Versions: note, author | NEW | No `note`, `created_by` | Two nullable columns; **not** added to the delivery select | S |
| Roll back | NEW endpoint | `best()` takes the highest active version, so older rows must be deactivated, or the old one re-published as a new version (recommended) | Q7 | S |
| Effect visible in logs | LIVE | `dev_events.profile_id`, `profile_version` already written | Calls page can show the rule version | S |
| **Field: Priority** (4 options) | CUT or contract change | Not in contract. `D/router.ts › route` rank is fixed: last source (always null today), recency, fallback chain. `only_if_alone`, `targeted_only` do not exist | Q8 | L if built |
| **Field: Fallback** (none, queue, send to) | CUT or contract change | Not in contract. Offline is a `device_offline` refusal. There is no offline queue and no offline reroute | Q8 | L if built |
| **Field: Agent instructions** | DATA, honoured | `prompt_append`, returned by `GET /users/{id}/context`. **The agent must read it**; `deliver` does not apply it. Note Dopl's own lens path does not necessarily call context **[assumption]** | Wire to `prompt_append` | S |
| **Field: Inbound template** | CUT | `display_template` is in the schema, **used nowhere**. Wrapping text also conflicts with D3 and the page's own "Passed through unchanged" | Q8 | S |
| **Field: Max lines** | DATA, honoured on `deliver` only | `D/enforce.ts › limitsFor`, tightest of profile and adapter. Counts `\n` lines, **not wrapped lines** | Fix notify path (fact 6) | M |
| **Field: Max characters** | DATA, honoured on `deliver` only | Plus byte limits from the descriptor | Same | S |
| **Field: Format** | DATA, guidance only | `output.format` is returned in context; `enforce` ignores it | Keep, labelled honestly | S |
| **Field: Allowed intents** | CUT or map | Not in contract. Closest is `allowed_capabilities` | Merge into Capabilities | S |
| **Field: Ask options** | CUT | Not in contract. Adapter max is 4 (`GLASSES_LIMITS.options`) | Show as floor | S |
| **Field: Answer timeout** | CUT or contract change | Not in contract. Fixed `ASK_HOLD_MAX_S` 200, `SDK_ASK_TTL_S` 600. UI allows up to 600 and seeds 60 and 90 | Q8 | M if built |
| **Field: Overflow = Truncate** | DATA, honoured on `deliver` | Prefix only | | S |
| **Field: Overflow = Send to** | DATA, shape differs | `{send_to: kind}`, a device **kind**, UI picks a model. One hop, then truncates | Map model to kind | S |
| **Field: Overflow = Callback + URL** | DATA, shape differs | No URL exists. `callback` returns limits in the 202 response and marks the action failed | Remove URL field | S |
| Source badge, Override, Edit, Reset | NEW | Editor logic is sound on a stored draft | Move `resolveField` to `portal/` | S |
| "Dopl default" values | **Wrong** | Demo: lens max 10 lines, 200 chars, truncate. Real `DOPL_KIND_PROFILES.glasses`: 5 lines, 300 chars, `send_to: phone`. Desktop: no limits, markdown | Read `D/default-profiles.ts` | S |
| What it may do, "N of M" | DATA | Parse `allowed_capabilities` | | S |
| Floor: Display limit | **Wrong** | Demo G2: 10 lines, 400 chars. Real notify: 4 lines, 400 **bytes**, 64 title; display by blocks and bytes | Read descriptor limits | S |
| Floor: T4 confirmed on every call | **Misleading** | T4 default is denied. If configured it parks at `needs_confirmation` with **no way to complete** | Say "Denied", see Q9 | S |
| Floor: Message text unchanged | True | `sanitizeText` folds glyphs (curly quotes, emoji dropped) | Keep | S |
| Floor: User blocks and quiet hours always honoured | **False** | Neither exists in router or policy | Remove | S |
| Preview screen | **Diverges** | `renderPreview` wraps to a width and **appends "..."**; `D/enforce.ts` adds no ellipsis and counts newlines | Import pure `enforce` and `limitsFor` | M |
| Preview: sample picker, fits N of M | Client | Sample text hard-coded; fine | Replace sample copy (Larkfield-themed) | S |
| Preview: Start simulator, Send test, Voice, calls list | **Fake** | `device-simulator.tsx` | Remove for demo, or reuse real Send test | S to remove |
| Final payload JSON | **Invented** | Keys like `lines`, `fallback`, `timeout_s` are not any real shape | Show `D/intents.ts › argsFor` output | S |

### 1.8 Capabilities tab: `integration-capabilities.tsx`

| Element | Status | Runtime truth | Work needed | Size |
|---|---|---|---|---|
| Tier grouping, tier chip, policy text | LIVE | Contracts. `POLICY_LABEL` T4 text misleads as above | Fix label | S |
| Capability id list | LIVE | Catalog equals adapter for G2 and macOS | Use `describe()` | S |
| On/off switch | DATA, **honoured** | `allowed_capabilities`, checked in `D/router.ts › capabilityOn` and `deviceAction` (`capability_unsupported`). Turning off `present.display` makes `message` fall to notify. Exact ids are allowed by `scopeCovers` | Publishes through rule versions, so instant-looking switch needs a Draft cue. Seed differs: demo T2 off, real defaults allow `capture.*` | M |
| Switch on `input.*` | **No effect** | No delivery path for inbound; grant-side only | Hide switch or mark read-only | S |
| Confirmation mode pill, per capability | Shape mismatch | `confirmation` is keyed by **tier**, not capability. `deny` works. `on_device`, `trusted_surface` store `needs_confirmation`; **no route or code ever completes one** (`grep` across `S/`, `app/api/v1`) | Q9. Irrelevant to G2 and macOS today: all their capabilities are T0 or T1 (`C/capabilities.ts`) | L to build |
| T4 lock | As above | | | S |
| Not published list | LIVE | Contracts minus adapter | | S |

### 1.9 Calls and Users tabs

| Element | Status | Source | Work needed | Size |
|---|---|---|---|---|
| Calls: `CallsBrowser` scoped to model | DATA | `dev_events` + `dev_actions`; filter by `adapter_version` / `model` | Owned by Activity mapper; add model scope | S |
| Users tab: same table, filtered to model | DATA | Fleet read | Reuses 1.1 | S |
| Users tab sheet | As 1.2 | | | |

## 2. New tables, columns, jobs and endpoints

All **[proposal]**. Names are suggestions; none of these exist.

**Required**

| Item | Purpose | Notes |
|---|---|---|
| `S/portal-fleet.ts` read module | Users list, user detail, model figures | Reach via `listPortalProjects`; reads `dev_events`, not billable |
| RPC `dev_portal_device_stats(project, env, since)` | One group-by per device | Same reasoning `S/usage.ts` notes on per-bucket counts. Service role only, invoker |
| Pages `/developers/users`, `/users/[id]`, `/devices`, `/devices/[integration]` | Real routes | Server-read, URL state, skeletons per INVARIANTS §1A |
| Session-only routes: send test, relink session, revoke, publish, promote, rollback, add integration | Writes | Add to `write-gate-coverage.test.ts`. Owner or admin only |
| `dev_end_users.display_name` nullable | Readable name | No hot-path select change needed |
| `context_profiles.note`, `created_by` nullable | Version list | Not in `listProfiles` select |
| `dev_profile_drafts(project_id, category, rules jsonb, updated_by, updated_at)` | Draft store | Layered rules live here; publish compiles to rows |
| `dev_project_integrations(project_id, env, adapter_id, status, added_by, added_at, tests jsonb)` | "Added" and Testing/Live | Avoidable for demo, see below |
| Desktop adapter delivery + `desktop` pairing + a way for the Mac to appear | Fact 7 | Owned elsewhere, but cards depend on it |
| Google Home adapter, OAuth or MCP, pairing | Fact 8 | Largest unknown |

**Likely, after the demo**

- Firmware reporting (1.4).
- A writer for `connections.status = needs_reauth`. Today nothing sets it, and `connection.needs_reauth`, `device.online`, `device.offline` have no emitter.
- A presence job, since online is computed only on read and webhooks need a transition.
- `dev_end_users.metadata jsonb` for plan and region, with `PATCH /v1/users/{id}` or a field on `connect_sessions`, only if segments return.
- Answer route for `needs_confirmation`.

**Avoidable**

- **Catalog table.** Use a code constant keyed by adapter, with `describe()` as capability truth.
- **Separate "device state" column.** Derive online, stale and relink on read.
- **New event or rule-version log.** `dev_events.profile_id` and `profile_version` are already written.
- **New rule engine.** Compile to `context_profiles`; `resolveProfile` and `enforce` are reused unchanged.
- **`dev_project_integrations` for the demo.** Derive "added" from any active connection on that adapter. It loses Testing state and empty cards.
- **Saved views, preferences, segments tables.** Cut.

## 3. Samuel's demo

**Must be true for these pages:**

1. The "Dopl App" project and live env show real rows, with internal traffic **included** (fact 10).
2. One user row with a readable name, not a uuid (`display_name`, set by hand is fine).
3. That user has Mac, Even simulator and Google Home as real `devices` + `connections`. **Today only G2 can exist.** Mac and Google Home need adapters and pairing, or a stated reduction in the demo.
4. Message sent from the Mac gets logged. **Today no inbound path logs anything**: `delivery-service.ts` passes `lastSourceKind: null`, `source_of_last_message: null` ("lands later"), and the Mac's prosumer traffic does not hit `/api/v1`. `dev_events` is written only by `withDeveloperKey`.
5. Agent messages go through `/api/v1` with `DOPL_APP_SDK_KEY` set in the environment used, and the user's `sdk_delivery` flag on (1 user flagged on prod). Otherwise the message takes the prosumer path and **the delivery is not logged in the portal, silently** (`sdk-lens.ts` fallback class).
6. Online dots are right at the moment of switching. G2 window is 60s, desktop 150s, so the plugin must be polling.
7. Devices page cards for the demo's integrations, with real Users, Online, Shown figures. Device detail Overview and Users tabs populated.
8. Old device rows handled. 3 of 4 G2 rows are not recently seen, and the 12 `device_offline` refusals drag success down if inside the 7-day window. See Q10.

**Can wait:** firmware, plan, region, segments, preferences, saved views, per-user webhooks, confirmation modes, Keep testing / Go live gating, real capability test runner, real in-browser simulator, server paging, presence webhooks, rule versioning UI if Samuel does not intend to show it.

**Still fake if left as is. A viewer would see:**
- Larkfield Assist branding, 29 invented users, `tech_1042` ids, `connect.larkfield.example` relink URL.
- Send test that says "Sent" and logs a "seen" call without sending anything.
- Relink flips a device to online with nothing happening.
- Spark bars from a hash of the model id; Deliveries chart from a spread total.
- Add-device: QR, `K7Q294`, tests that always pass.
- "Dopl default" and floor values that disagree with the runtime.
- "User blocks and quiet hours always honoured", which is false.
- Preview with an ellipsis that runtime never adds.
- Rule edits that do nothing to a Dopl notice (fact 6), which is the sharpest risk if he demonstrates a rule live.

**Recommended demo rule story:** show default rules read-only unless the notify path is fixed. If he wants a live rule change: set Max lines, publish, and show `profile_id` and version in the log.

## 4. Questions only Samuel can answer

| # | Question | Recommendation |
|---|---|---|
| Q1 | Mac and Google Home in the demo: real adapters first, or reduce the demo? | Decide this first, it sizes everything. Mac via SDK adapter is plausible. Scope Google Home separately; nothing exists |
| Q2 | Is "Even simulator" the Even Hub simulator with the plugin, on live env? | Yes, treat as ordinary `even_g2`, drop the Simulated pill for it |
| Q3 | Plan and region on end users? | Cut for now. Dopl App has no plans to report per end user anyway. Add `metadata` later if a customer asks |
| Q4 | Preferences tab? | Cut Tone and Language. Hide the rest until enforcement exists; remove the "always honoured" floor |
| Q5 | Define stale and needs relink | Needs relink = connection `needs_reauth`, expired, or device token revoked. Stale = active connection, not seen for 14 days. Offline otherwise. Both derived |
| Q6 | How does an integration get "added"? Does Go live gate traffic? | Add a table, no gating for now: any adapter stays usable. Honest label: "Added", with Testing/Live as the developer's own marker. For the demo, derive it |
| Q7 | Rollback semantics | Re-publish the old rules as a new version, so history stays linear and `dev_events` versions are unambiguous |
| Q8 | Priority, Fallback, Timeout, Inbound template: build or cut? | Cut all four for the demo. Fallback is the most valuable one to build next. Inbound template should go permanently; it contradicts D3 |
| Q9 | Confirmation modes | Show only for T3/T4 and only `deny` until an answer route exists. Say T4 is "Denied" |
| Q10 | Clean old G2 rows and events before the demo? | Revoke unused connections through the normal path. **Do not delete event rows**; choose a fresh window or let them age |
| Q11 | Should rules apply to device-level actions? | Yes for `present.*`, or move Dopl notices to `deliver`. The second is smaller and keeps explicit-device semantics clean |
| Q12 | Keep the project internal, named "Dopl App", in the demo? | Keep internal so billing stays right. Rename display to "Dopl" if he wants the wording from his script |
| Q13 | Segments permanently? | Cut from the UI. Revisit with Q3 |

## 5. Suggested build order

1. **Decide Q1, Q2, Q5, Q8.** These remove the most work.
2. **Foundation:** move `catalog.ts` constants to `src/features/device-sdk/portal/`, deriving capabilities and limits from adapters. Add `S/portal-fleet.ts` and the stats RPC. Migration for `display_name`.
3. **Users list + sheet + user page, read-only:** Devices and Grants tabs. Hide Preferences, Webhooks, Views, plan, region, firmware. First visible result, works with today's single G2.
4. **Devices catalog + device page Overview, Users, Calls:** real figures and chart, spark cut or real.
5. **Write actions:** Send test, Relink, Revoke, through session-only routes. Real log rows appear from this step on.
6. **Dependencies owned elsewhere:** Mac adapter and logged inbound, Google Home. Re-check cards once these land.
7. **Honesty pass on rules, read-only:** real defaults and floors, preview using real `enforce`, remove false floor, Capabilities reading the resolved profile.
8. **Rule writing:** draft table, compile, publish to Test and Live, roll back, switches. Fix notify path (Q11) in the same step or rules will not visibly work.
9. **Add-device popup:** real Connect session and QR, then capability tests. Add `dev_project_integrations`.
10. **After the demo:** firmware, needs-reauth writer, presence job and webhooks, confirmation answers, server paging.
