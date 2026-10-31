# Dev portal: making it live

Written 2026-10-31. Goal: replace the hard-coded portal at `/playground/developers` with real data at `/developers`, then run Samuel's demo on it.

Every page was mapped element by element against the code and production. Full tables are in [maps/](maps/). Numbers below were measured on 2026-10-31.

## Your answers, 2026-10-31

- **The demo is recorded,** at home, so venue risks are gone and retakes are possible.
- **You have a physical Google Home.**
- **Flow:** send a message from Dopl desktop, it shows in the channel. Open the Even simulator, open the chat, and that message is there. Dictate a message from the glasses, and it goes back to the agent.
- **Scope:** not everything has to be live before the demo. **Everything that shows stats must be.**

What changed in this plan as a result:

| Before | Now |
|---|---|
| Mac receives deliveries as a device, with a desktop release | **Cut for the demo.** Mac appears as a connected device and as a message source. No SDK delivery to it |
| Typed message doesn't appear in logs | **Inbound messages get logged,** from both Mac and glasses, since that's the moment you're showing |
| Google Home bridge inside the desktop app | **Small local script on your Mac.** It's a recording, so no desktop build is needed for it |
| Every page wired | **Stats and read views first.** Controls that can't work yet get hidden or disabled, so nothing pretends |

## 1. Where we stand

**The backend is further along than the portal, but the demo's two new devices don't exist yet.**

| Works today | Doesn't exist yet |
|---|---|
| `/v1` API, keys (hashing, reveal once, rotate, revoke) | Mac as an SDK device: production refuses every send (`src/features/device-sdk/server/device-adapters.ts › desktopUnavailable`) |
| Delivery to the Even simulator, logged, proven on production. Channel reading and dictation on the glasses exist | Google Home adapter, bridge or device row. Only a Cast sender in the desktop repo, tested against a fake socket |
| Routing, rules enforcement on `deliver`, grants | Real Users, Devices, Overview, Issues, Connect pages. No endpoint lists users or devices |
| Webhook sender: signing, 8 retries over about 27 hours, replay, rotation | Stored routing verdicts, delivery timestamps, per-key call counts |
| Hosted Connect screen, built and tested | A run of Connect on production: 0 sessions ever |

**Production holds very little real data:** 1 internal org, 1 project ("Dopl App"), 1 end user, 4 G2 devices (3 stale), 2 keys, 14 events (12 `device_offline`, 2 ok), 0 webhook endpoints, 0 rule rows.

**The redesign itself isn't live.** It's 39+ commits on `ui/dev-portal-redesign`, all fixtures, on a public route. `feat/developers-mcp` (`534d0c4b1`) is a separate unmerged branch.

## 2. Things that will break the demo unless fixed

1. **Dopl App is internal, so real pages show zero.** Usage reads `dev_billable_events`, which excludes internal orgs, and the log filter drops internal projects by default. `refuseInternal` also blocks creating keys and inviting people there.
2. **Portal opens on Test, and all Dopl traffic is Live,** so the first screen is empty.
3. **The moments you're showing write no log.** Only `/api/v1` writes `dev_events`. A typed channel message, a dictated glasses message, `glasses_show`, an agent's reply mirrored to the lens, hosted Connect steps and Google Home all leave no row.
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
2. **Google Home go or no-go:** one real speak on your speaker. Discovery run from this session on 2026-10-31 found 0 devices. That doesn't prove much: Mac reported no Wi-Fi association on `en0`, and `bonjour-service` isn't installed in the repo. Check it runs on the speaker's network.
3. **Run `deliver` once on production** with `target` by device id. All 14 rows so far are `present.notify`.
4. **Run real Connect once on production.** 0 sessions ever.
5. Decide stale G2 cleanup.

### Phase 1: real shell and truthful logs
6. Merge `ui/dev-portal-redesign` and move `_design` and pages under `/developers`, keeping data out of the public `/playground` route. Resolve the gap with DESIGN-SYSTEM.md, since `_design` has its own tokens.
7. Migration from section 5, applied first.
8. Internal project included in reads, default env fixed.
9. Logging: write new fields, router trace, `delivered_at`, hosted Connect rows, fallback row, move notices to `deliver`, route `glasses_show` through the SDK.
10. `action.failed`, notify completion, `external_user_id` in payload.

### Phase 2: your demo's devices and messages
11. **Inbound rows (M).** A dictated glasses message (`src/features/glasses/core/voice/handlers.ts`) and a typed Dopl desktop message (`postMessage`) write a `dev_events` row with kind, source device and channel reference, never the text unless ruling 10 says so. Neither writes one today. Also emit `input.utterance` from the glasses path.
12. **Agent replies on the lens get logged (S to M).** `reply-mirror.ts` uses the old queue with no row.
13. **Mac as a connected device (S to M).** Device row, connection and grant under Dopl App, with heartbeat touching `devices.last_seen`. SDK delivery stays refused.
14. **Google Home (M to L).** `google_home` adapter (`home_hub`, `local_bridge`), generic bridge route and token replacing the G2-only lookup in `sdk-glasses-port.ts › deviceFromTokenHash`, and a local script on your Mac running the Cast code. Use intent `message`; `notify` would be refused. Cast gives no answer back, so status ends at delivered.
15. **Real traffic ahead of recording.** Charts need days of data, and today there's one day of it. Send real messages daily once logging ships, so a 14-day chart isn't one bar. No seeded fake rows.

**Already built, needs one real run:** reading a channel on the glasses and dictating into it both exist. Check three things:
- Speech-to-text needs `OPENAI_API_KEY` or `GROQ_API_KEY` on production (`src/features/glasses/core/voice/stt.ts`). Not verified.
- **Keep the simulator's current pairing.** A G2 paired through hosted Connect gets "Voice is not available on this device" (`SDK_VOICE_REFUSAL`). Your simulator came through migration, so it can dictate. So **don't show pairing this device through Connect** in the same take.
- The simulator's mic is your Mac's default input.

### Phase 3: wire the pages
16. API keys, then Team (mostly existing routes, fastest wins).
17. Activity with polling, then Webhooks with a public receiver you control.
18. Users and Devices, read side.
19. Overview, Usage, Issues on the shared metrics.
20. Hide or disable what isn't live yet. No fake success messages.
21. What it receives, read-only: real defaults and floors, remove false claims.
22. Delete every fixture import. Add a check that `/developers` can't import `_data`.

### Phase 4: rehearse
23. Full dress run on production. Clean device list, fresh rows, public webhook receiver.
24. Retake anything that goes wrong; it's a recording.

### Phase 5: after the demo
- **Controls:** Send test, Relink, Revoke, Connect save and real test link, Playground on real calls, rules publishing, Add device flow, Mac as a delivery target.

### Phase 6: before any outside customer
- **Publishable key hole:** a public `pk_` key can start a session for any user, and consent activates the connection with no secret-key step, so a stranger's device could receive that user's deliveries. Fix: inert until exchange. Traced to consent, fan-out not fully traced.
- Redirect allowlist. `pk_` keys can't override branding. Webhook management needs a real scope; any secret key can do it today.
- Retention on `dev_actions`, `dev_device_messages` and webhook logs, which have none. Privacy copy.
- Daily rollup before billing or 90-day ranges; 30-day pruning would lose the start of a 31-day month.
- Plans and pricing, presence events, `needs_reauth` writer, render acknowledgement, email invites, firmware reporting, publish the SDK.

## 7. Demo script

Recorded at home, on the speaker's network. Keep the simulator running from before you start.

| # | You do | On screen |
|---|---|---|
| 1 | In Dopl desktop, send a message in a private channel | Message in the channel; agent wakes |
| 2 | Open the Even simulator, open the chat | **Your Mac message appears on the lens** |
| 3 | Dictate a message from the simulator | Transcript in the channel, marked as sent from glasses; agent receives it |
| 4 | Agent replies | Reply on the lens and in the channel |
| 5 | Ask on the glasses, for example "Ship it?" with options, answer it | Ask card; agent reads the answer; webhook fires |
| 6 | "Say it on the Google Home" | Speaker talks in the room |
| 7 | Switch to portal: Activity | Your Mac message, glasses message, lens sends, speaker, in order |
| 8 | Open a row | Timeline, devices considered, rule version, latency |
| 9 | Overview, Devices, Users, Usage | Real counts and charts, with Mac, G2 and Google Home connected |
| 10 | Webhooks | The `action.completed` delivery and its attempts |

The agent should use `deliver` from `dopl-sdk-mcp` with explicit device ids, since `glasses_show` isn't logged until step 9 ships. Avoid `target: auto` and `urgency: high`.

**Remaining risks:** simulator restart loses logging. Its window hidden over 60 seconds shows offline. Electron restart kills channel agents, so don't relaunch mid-take. Numbers will be small and honest: one user, three devices.

## 8. Decisions I need from you

Each has my recommendation, and I'll build to those unless you say otherwise. Items 15 and 16 need your explicit word.

**Still open**
1. **What date is the recording?** Decides how much history the charts can show, and what gets cut.
2. **Should message text show in those inbound rows?** See 10 below. Without text, the row says only "Message from glasses". Recommend showing it for this project.

**Product**
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
- Speech-to-text is configured on production.
- The chat view on the simulator shows a desktop message and takes a dictated reply on today's production build. Code read, not run in this session.
- `dopl-sdk-mcp` loads for an agent through "Use my tools". Code path read, never run.
- The webhook cron runs on production. The outbox has always been empty.
- `/developers` and `/connect` load inside Dopl.app. Using the browser avoids this.
- The Run sandbox can likely be escaped by deleting `self.fetch`. Not tested, so treat it as unsafe until hardened.
