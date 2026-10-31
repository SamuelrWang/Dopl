# Dev portal: making it live

Written 2026-10-31. Goal: replace the hard-coded portal at `/playground/developers` with real data at `/developers`, then run Samuel's demo on it.

Every page was mapped element by element against the code and production. Full tables are in [maps/](maps/). Numbers below were measured on 2026-10-31.

## 1. Where we stand

**The backend is further along than the portal, but the demo's two new devices don't exist yet.**

| Works today | Doesn't exist yet |
|---|---|
| `/v1` API, keys (hashing, reveal once, rotate, revoke) | Mac as an SDK device: production refuses every send (`src/features/device-sdk/server/device-adapters.ts › desktopUnavailable`) |
| Delivery to the Even simulator, logged, proven on production | Google Home adapter, bridge or device row. Only a Cast sender in the desktop repo, tested against a fake socket |
| Routing, rules enforcement on `deliver`, grants | Real Users, Devices, Overview, Issues, Connect pages. No endpoint lists users or devices |
| Webhook sender: signing, 8 retries over about 27 hours, replay, rotation | Stored routing verdicts, delivery timestamps, per-key call counts |
| Hosted Connect screen, built and tested | A run of Connect on production: 0 sessions ever |

**Production holds very little real data:** 1 internal org, 1 project ("Dopl App"), 1 end user, 4 G2 devices (3 stale), 2 keys, 14 events (12 `device_offline`, 2 ok), 0 webhook endpoints, 0 rule rows.

**The redesign itself isn't live.** It's 39+ commits on `ui/dev-portal-redesign`, all fixtures, on a public route. `feat/developers-mcp` (`534d0c4b1`) is a separate unmerged branch.

## 2. Things that will break the demo unless fixed

1. **Dopl App is internal, so real pages show zero.** Usage reads `dev_billable_events`, which excludes internal orgs, and the log filter drops internal projects by default. `refuseInternal` also blocks creating keys and inviting people there.
2. **Portal opens on Test, and all Dopl traffic is Live,** so the first screen is empty.
3. **Sending from the Mac writes no log.** Only `/api/v1` writes `dev_events`. A typed channel message, `glasses_show`, an agent's ordinary reply mirrored to the lens, hosted Connect steps and Google Home all leave no row.
4. **Failed rows sit beside delivered messages.** When an SDK send is refused, `glassesNotify` falls back to the old queue, which logs nothing. Each notify also tries all 4 G2s, so 3 stale ones produce red rows.
5. **Don't restart the simulator.** Re-pairing creates an unmigrated link, then every send silently skips the logs. Fixing it needs an RPC with no script or UI. Its 60-second online window can also lapse if its window stays hidden.
6. **Most numbers on screen are invented, some by formula:** `dailySeries`, the `Math.sin` rate line, week × 3.9, the $249 plan, Starter/Team/Scale prices, the maintenance banner, the Ask answer, test results that always pass, the pairing code, `Send test`.
7. **Some screen copy is false:** "Seen by device" (no acknowledgement exists), "quiet hours always honoured" (not implemented), "Invite sent" (no email is sent), six of thirteen rule fields do nothing at runtime.
8. **Never rotate or revoke the live key on stage.** Glasses delivery depends on it through `DOPL_APP_SDK_KEY`.

## 3. What each page needs

Sizes: S under half a day, M about a day, L two or more days of agent build. Estimates, not including your review.

| Page | Already real | Needs new work | Cut or relabel |
|---|---|---|---|
| **Shell** | Sign-in, org creation, project and env from the URL | Move under `/developers`, project switcher on URL, sign-out (M). Search route that never touches secrets or content (M) | Design Playground from nav |
| **Overview** | Key and connection counts | Metrics RPC, stats, charts, setup steps from real rows (M) | Maintenance banner, "2 fewer" delta. Ask becomes real chips, no free text |
| **Users** | Nothing shown today; data exists | Fleet read and stats RPC (M), `display_name` (S), Send test, Relink, Revoke routes (M) | Plan, region, firmware, saved views, preferences |
| **Activity** | Logs, filters, detail, 30-day retention | New columns (below), router trace, merged feed, 3-second poll while visible (M to L) | "Sent" and "Seen" become "Picked up by device" |
| **Issues** | Raw errors exist | Computed groups with catch-all per error code (M), mute table, revoke route (M) | Persisted issues table not needed |
| **Devices** | Adapter descriptors | Real catalog constants, figures per model (M) | Fake tests, QR and pairing code until wired to Connect (L) |
| **Device: What it receives** | Enforcement on `deliver`, version columns | Draft store, compile to rows, publish, promote (L). Move Dopl notices onto `deliver`, or rule edits do nothing (M) | Priority, Fallback, Inbound template, Allowed intents, Ask options, Timeout, segments |
| **Device: Capabilities** | On/off is enforced | Write through rule versions (M) | Confirmation modes except deny; nothing can complete them |
| **Webhooks** | Sender and read pages | Portal routes for create, pause, delete, replay, direct test (M). Emit more events (below) | Spark bars, invented payload |
| **Usage** | Range reads, but billable only | Activity read that includes internal, RPC, real limits (M) | Plan, price, Next bill, Manage, 90 days until a rollup exists |
| **Connect** | Hosted screen, session API, snippet | Config column, save route, enforcement, test link (M), logo bucket (M), log hosted steps (S) | Draft/Published becomes Save. Mac and preview tiles until they can pair |
| **API keys** | Create, reveal, rotate, revoke, role gates | `name`, `created_by`, `api_key_id`, pass scopes and grace through routes (S to M) | **Undo on revoke, which I added. It restores a possibly leaked credential.** Demo scope names and curl sample are wrong |
| **Team** | Members, roles, invites, accept | `last_active_at` (S), correct permission grid (S) | **Undo on remove.** Viewer role. "Invite sent" becomes copy link |
| **Playground** | One real call, Test only, pasted key | Real `@dopl/sdk` snippets (S), connect to route (S to M), test devices (M), harden sandbox (S to M) | Invented `dopl.deliver` and `content.lines`. Act and read outputs unless simulated values are added |

## 4. Webhooks: what each one contains

Every event: `{ id, type, api_version, timestamp, livemode, data }`, signed with Standard Webhooks. Endpoints must be public HTTPS, so localhost can't be used.

| Event | Fires when | `data` | Emitted today | Plan |
|---|---|---|---|---|
| `connection.created` | Hosted Connect consent | Connection: id, user, status, device, grants | Yes, hosted path only | Keep |
| `connection.revoked` | First revoke | Connection | Yes | Keep |
| `action.completed` | Ask answered or dismissed on G2 | Action: id, device, capability, status, result, error | Asks on G2 only | **Also fire when a notify or display is picked up, and for new devices** |
| `action.failed` | Action fails | Action | **Unreachable** | Emit from `deliver` and `deviceAction` (S to M) |
| `device.online`, `device.offline` | Presence changes | Undefined | No | After demo: needs `devices.presence_state` and a sweep (M) |
| `connection.needs_reauth` | Grant needs reconnect | Connection | No; nothing sets that status | After demo (L) |
| `ask.answered` | Duplicates `action.completed` | Undefined | No | **Remove from picker**, per the 2026-10-28 ruling. The add flow preselects it today |
| `input.utterance` | Voice from device | Undefined | No | After demo (L) |

Also add `external_user_id` to the Action payload: today a developer can't tell whose answer it is without mapping the device.

## 5. Data changes

Additive, applied by name, before the code that writes them. `logDevEvent` is hot path: a missing column silently loses the whole batch, so this needs a fallback and a test (INVARIANTS §12).

| Change | Why |
|---|---|
| `dev_events`: `api_key_id`, `action_id`, `operation`, `http_method`, `route`, `http_status` | Per-key counts, joining a call to its delivery, clean delivery counts, request details. Re-create `dev_billable_events` in the same migration |
| `dev_actions`: `delivered_at`, `settled_at` | Real timeline |
| `route_decision.considered` in existing jsonb | "Devices considered". **Past calls can't be backfilled, so do this early** |
| `dev_api_keys`: `name`, `created_by` | Keys page |
| `dev_end_users.display_name` | Readable names instead of a UUID |
| `dev_org_members.last_active_at` | Team |
| `dev_projects.connect_config` jsonb, `connect_sessions.allowed_adapters` | Connect limits |
| `context_profiles`: `note`, `created_by`; `dev_profile_drafts` | Rule versions and drafts |
| `dev_issue_mutes` | Mute |
| RPCs `dev_portal_metrics`, `dev_portal_device_stats` | One grouped query, replacing up to 60 counts |
| Possibly `dev_device_messages` for a speak kind | Google Home queue; check first |

**Not needed:** a catalog table, a device state column, an issues table, a new event store, realtime, a new cron, or a separate Supabase project. Use a 3-second poll while the tab is visible; `dev_*` tables are service-role only, and realtime has been expensive here.

## 6. Roadmap

### Phase 0: answer unknowns first (S each, before building on them)
1. Your rulings in section 8.
2. **Google Home go or no-go:** run `node dopl-desktop-app/main/google-home/mcp-stdio.js --discover`, then one real speak on your speaker. Never yet run on real hardware.
3. **Run `deliver` once on production** with `target` by device id. All 14 rows so far are `present.notify`.
4. **Run real Connect once on production.** 0 sessions ever.
5. Decide stale G2 cleanup.

### Phase 1: real shell and truthful logs
6. Merge `ui/dev-portal-redesign` and move `_design` and pages under `/developers`, keeping data out of the public `/playground` route. Resolve the gap with DESIGN-SYSTEM.md, since `_design` has its own tokens.
7. Migration from section 5, applied first.
8. Internal project included in reads, default env fixed.
9. Logging: write new fields, router trace, `delivered_at`, hosted Connect rows, fallback row, move notices to `deliver`, route `glasses_show` through the SDK.
10. `action.failed`, notify completion, `external_user_id` in payload.

### Phase 2: the two new devices
11. Generic bridge route and token, replacing the G2-only lookup in `sdk-glasses-port.ts › deviceFromTokenHash`.
12. **Mac:** device row, credential, grant, presence, a real dispatcher for internal projects, pull loop in the desktop app, native banner.
13. **Google Home:** `google_home` adapter (`home_hub`, `local_bridge`), Cast executor sharing the same loop. Use intent `message`; the demo's `notify` would be refused. Cast gives no answer back, so status ends at delivered.
14. Local desktop build pointed at `www.usedopl.com`. Exception to the Electron-with-local-API rule, and you launch it.

Mac and Google Home share one bridge, so together they're about L, not 2L.

### Phase 3: wire the pages
15. API keys, then Team (mostly existing routes, fastest wins).
16. Activity with polling, then Webhooks with a public receiver you control.
17. Users and Devices, read side. Then Send test, Relink, Revoke.
18. Overview, Usage, Issues on the shared metrics.
19. Connect config and real test link. Playground on real calls.
20. What it receives: real defaults and floors first, then publishing.
21. Delete every fixture import. Add a check that `/developers` can't import `_data`.

### Phase 4: rehearse
22. Full dress run on production. Clean device list, fresh rows, public webhook receiver.
23. Backup recording of the real speaker.

### Phase 5: before any outside customer (not needed for the demo)
- **Publishable key hole:** a public `pk_` key can start a session for any user, and consent activates the connection with no secret-key step, so a stranger's device could receive that user's deliveries. Fix: inert until exchange. Traced to consent, fan-out not fully traced.
- Redirect allowlist. `pk_` keys can't override branding. Webhook management needs a real scope; any secret key can do it today.
- Retention on `dev_actions`, `dev_device_messages` and webhook logs, which have none. Privacy copy.
- Daily rollup before billing or 90-day ranges; 30-day pruning would lose the start of a 31-day month.
- Plans and pricing, presence events, `needs_reauth` writer, render acknowledgement, email invites, firmware reporting, publish the SDK.

## 7. Demo script once built

Assumes Phases 1 to 4 are done. The agent uses `deliver` from `dopl-sdk-mcp` with explicit device ids, added through "Use my tools" in a private channel. Avoid `target: auto` (it picks the most recently seen device) and `urgency: high` (logs only the primary device).

| # | You do | On screen |
|---|---|---|
| 1 | Open Dopl desktop, private channel, simulator visible beside it | Channel and lens |
| 2 | "Tell me on my Mac the build finished" | Mac banner |
| 3 | "Put it on my glasses" | Lens card in the simulator |
| 4 | "Ask me on the glasses whether to ship", answer in simulator | Ask card; agent reads the answer; webhook fires |
| 5 | "Say it on the Google Home" | Speaker talks in the room |
| 6 | Switch to portal: Activity | New rows appear within seconds, one per device |
| 7 | Open a row | Timeline, devices considered and why, rule version, latency |
| 8 | Open Devices, then Users | Mac, G2, Google Home online; you as the user |
| 9 | Open Webhooks | The `action.completed` delivery, with attempts and signature verified on your receiver |

Top risks: venue Wi-Fi blocks Cast (use a travel router or record at home); simulator restart loses logging; agent picks an unlogged tool (name the tool in the prompt); Do Not Disturb hides the banner; Electron restart kills channel agents.

## 8. Decisions I need from you

Each has my recommendation. The first four change the plan most.

**Clarifying**
1. **When is the demo, and is it live or recorded?** No date means I can't say what to cut. Recommend recording at home on your own Wi-Fi.
2. **Do you have a physical Google Home or Nest?** If not, it's a labelled browser speaker, and the shot is much weaker.
3. **"Send a message from my Mac": which do you mean?** I read it as you typing in Dopl and the agent sending to devices. Recommend the typed message itself doesn't appear as a delivery, since it isn't one, and the agent's sends do. If you want it logged too, it's extra.
4. **Do you want everything in this plan before the demo?** Recommend no: demo needs Phases 0 to 4, with What it receives publishing and Add device flow read-only if short on time. If time runs out, cut rules publishing and the Add device flow first, then Mac as a listed device. Glasses and the speaker are the shots to keep.

**Product**
5. **Mac as a real SDK device for internal projects only?** Yes. Outside SDK users have no Dopl account, so the refusal still applies to them.
6. **Usage for an internal project?** Show real activity labelled "Internal, not billed". Don't flip the flag; billing stays correct.
7. **Plan, prices, Next bill, Manage?** Cut. Pricing is held (spec D5), and invented prices on a shown screen are a risk. This removes plan cards you just asked me to add.
8. **"Shown" or "Delivered"?** "Delivered", meaning taken by the device. Nothing reports a real render. Timeline says "Picked up by device".
9. **Should a notify count as finished once picked up?** Yes, and fire `action.completed`. Changes customer-visible behaviour, and otherwise plain messages fire no webhook.
10. **Show message text in Activity?** Yes for project members, only where it's stored (G2 today), purged at 30 days. Update privacy copy first.
11. **Cut Undo on revoke and remove?** Yes, both. Security problem, and the real code has no un-revoke.
12. **Cut non-working rule fields** (Priority, Fallback, Inbound template, Allowed intents, Ask options, Timeout, segments)? Yes for now. Fallback is the most valuable to build next. Inbound template should go for good, since Dopl never rewrites messages.
13. **Ask box?** Real question chips answered from live data, no free text. The web app has no model client today.
14. **Internal org permissions?** Owner may create and revoke keys and edit Connect. Invites stay blocked, since that org logs every Dopl user's device traffic.

**Production**
15. **Stale G2s: remove or use?** Remove 3 of 4 before the demo, keeping `a5a061e6`. Unpairing is permanent, so it's your call. Alternatively click Revoke on stage once that route exists.
16. **May I push and apply migrations to production when ready?** Logs on `www.usedopl.com` need it. Recommend yes per step, on your word each time.
17. **Project name?** You said "Dopl"; it's "Dopl App". Keep it, since a rename can make the seed script create a duplicate.

Smaller rulings with defaults are in each file in [maps/](maps/). Unless you say otherwise I'll take those defaults.

## 9. Assumptions not yet proven

- The Cast code works on real hardware.
- `dopl-sdk-mcp` loads for an agent through "Use my tools". Code path read, never run.
- The webhook cron runs on production. The outbox has always been empty.
- `/developers` and `/connect` load inside Dopl.app. Using the browser avoids this.
- The Run sandbox can likely be escaped by deleting `self.fetch`. Not tested, so treat it as unsafe until hardened.
