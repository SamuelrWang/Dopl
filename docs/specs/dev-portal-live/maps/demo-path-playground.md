# Demo path and Playground: what is real on 2026-10-31

Read-only mapping. Repo state: worktree `dev-portal-redesign` at `f28ba18e3`. Production reads were schema and counts only, plus device ids and timestamps. No message content was read.

**Evidence tags.** [V] verified in code or a production query this session. [D] stated in a repo doc or README, not exercised by me. [A] assumption. [W] web-platform knowledge, not tested.
**Sizes.** S = under half a day. M = about a day. L = two days or more. These are agent-build estimates and do not include Samuel's review.
**Web tools.** WebSearch and WebFetch both work. The search returned nothing current. I re-read two Google pages directly (section 0.4). The Cast facts come from `docs/specs/google-home/RESEARCH.md` (read 2026-10-24) and were not re-read today.

## 0. Answers to the six questions

### 0.1 Dopl desktop as a device: no, not today

- **The adapter is a shell.** `src/features/device-sdk/adapters/desktop.ts › createDesktopAdapter` exists, with only `presence.read` and `present.notify`.
- **Production refuses every send.** `src/features/device-sdk/server/device-adapters.ts › desktopUnavailable` returns `capability_unsupported`: "delivery to an SDK-owned computer is not available". The stated reason is D1: an SDK end user has no Dopl account. That reason does not hold for the Dopl App project, where `external_user_id` is the Dopl user id (`src/features/display/server/sdk-lens.ts`, header). [V]
- **It cannot register.**
  - `connect/hosted.ts › PAIRING_STYLE` lists only `simulator` and `even_g2`, so Connect never offers a desktop.
  - `wiredDeviceAdapters` wires no `pair` port for desktop.
  - The heartbeat writes `desktop_devices` only (`src/features/devices/server/devices-service.ts › heartbeat`). No trigger on that table was found in migrations.
  - The 2 `devices` rows with `adapter_id=desktop` are prosumer backfill (`project_id` null). Their last seen is 2026-10-27. [V]
- **Production counts.** `sdk_desktops = 0`. [V]
- **What a user sees on the Mac today from an SDK delivery: nothing.** They do see the channel message in the Dopl UI. Native banners and toasts exist for channel events (`dopl-desktop-app/main/notification-route.js`), but no SDK path reaches them. [V]

### 0.2 "Send a message from my Mac" and "have the agent send messages"

**What he does today**
1. Types in a Dopl desktop channel.
2. An agent wakes in that channel and calls a tool.

**Which hop is on `/v1`**
- The typed message is a channel post (`channels/server/service.ts › postMessage`). It does not touch `/v1` and writes no `dev_events` row. [V]
- Only the lens copy can reach `/v1`.

**Which agent tools produce a portal log**

| Agent call | Path | Logged under Dopl App? |
|---|---|---|
| `glasses_notify` | `glasses/core/messages/service.ts › glassesNotify` → `notifyOverSdk` → `sdk-lens.ts › devices.action(deviceId, "present.notify", …)` → `/v1/devices/{id}/actions/present.notify` | Yes. One row per migrated device, including offline ones. Proven in production (2 ok rows). |
| `dopl_show` with `target:"glasses"`, `glasses_render`, `glasses_ask` | `display/server/service.ts › showDisplay` → `sdk-seam.ts › sdkPlanOf` → `dopl.show` or `users.deliver` with `target:"glasses"` | Yes in code. **Never exercised in production:** all 14 rows for this project are `present.notify`. [V] |
| `glasses_show` | `glassesShow` → `deps.store.insert` (prosumer queue) | **No.** It reaches the lens with no log. [V] |
| `dopl_show` with default `auto` and a channel, no choice | `wantLens` is false | No lens copy, no log. [V] |
| Ordinary agent reply in a channel | `glasses/core/messages/reply-mirror.ts › replyToGlasses` puts a `show` card on the lens | **Text can appear on the lens with no log row.** Applies when that channel is in the device's scope. [V] |
| `deliver` via `@dopl/sdk/mcp` (`dopl-sdk-mcp`) | `packages/sdk/src/mcp/server.ts` → `users.deliver` | Yes. Takes `target` by device id. **Best fit for the demo.** Also writes one `context` row per send. |

**How an agent gets `dopl-sdk-mcp`**
- Through "Use my tools". `dopl-desktop-app/main/operator-tools.js › launchScope` is on for a wide tool profile in a private channel, or in a shared channel with the toggle on.
- So `claude mcp add` on his account should reach an agent in a private channel, because `launch-spec.js` calls `withOperatorTools`. [V for the code path; A that it loads end to end, so test once]
- The package is private and unpublished, so it needs `npm run build -w @dopl/sdk`. [V]

### 0.3 Even Realities simulator: steps and state

**It is running now.** [V]
- Vite PID 17627 with `VITE_GLASSES_API=https://www.usedopl.com` in its process environment, which overrides `.env.local` (that file says `127.0.0.1:3100`).
- Simulator PID 17672, automation port 9898.
- Device `a5a061e6` is live, under the Dopl App project, and its `last_seen` keeps moving (07:20:21 UTC at 07:21:27 UTC).

**Steps from cold** (`~/Downloads/glasses-mcp/plugin`)
1. `VITE_GLASSES_API=https://www.usedopl.com npm run dev`. Without the variable, `.env.local` points it at localhost:3100.
2. `npm run sim` (port 5180, automation 9898).
3. The lens shows a 6-character code. Enter it in Dopl Settings → Glasses.
4. **That creates a new prosumer link that is not migrated.** Then `migrate_prosumer_device(user, project)` must be run on production. I found no script or UI for this: `grep` finds the RPC only in migrations and `sdk-delivery-flag.ts`.
5. Until step 4, `sdk-seam.ts › sdkLensFor` and `sdkNoticesFor` see an unmigrated link, **every send falls back to the prosumer queue, and nothing is logged.** [V]

**Do not restart the simulator before the demo.** The plugin token is kept in simulator memory and does not survive a restart (plugin README). [D] A restart forces steps 3 and 4.

**Working** [V]
- Flag on: `flag_rows=1`.
- 4 active links, 4 migrated, 4 active connections.
- The `even_g2` dispatcher, and the inbox with `markDelivered`.

**Problems**
- 3 of the 4 devices are stale (last seen 10-27, 10-02, 09-30). `notifyOverSdk` tries every device on purpose, so each `glasses_notify` logs 3 `device_offline` errors. Production shows **12 error rows against 2 ok**. On screen the log looks broken. [V]
- `DEVICE_ONLINE_WINDOW_MS` is 60 seconds (`glasses/core/devices/service.ts`). The simulator's WebView pauses timers while its window is hidden (README). [D] Switching away for over a minute may make it `device_offline`.

### 0.4 Google Home: real speech works through Cast, but the SDK has no adapter

**What exists** [V]
- A hand-written Cast sender and a local stdio MCP server, `dopl-desktop-app/main/google-home/mcp-stdio.js` (6 tools). In master since 2026-10-24.
- **Not in any release tag, not loaded by the main process, not injected into agent spawns.**
- Its tests use a fake socket. `docs/specs/google-home/DESIGN.md` says nothing reaches a device, and I found no record of a run against a real speaker.
- The tools are also not on any hosted surface (`docs/INVARIANTS.md` line 1181).

**What does not exist** [V]
- A `google_home` adapter. `wiredDeviceAdapters` holds only `even_g2`, `desktop` and `simulator`.
- Any `home_hub` device: production count is 0.
- A desktop pull loop or a queue for it. DESIGN.md lists this as "Later 1".
- The portal catalog's `google_home@preview` is fixture text.

**Google's limits**
- Assistant SDK: "experimental and non-commercial uses only", and the "Broadcast voice messages" row reads No. [V, re-read today at developers.google.com/assistant/sdk/overview]
- Home MCP: 5 tools (`list_homes`, `list_home_resources`, `list_home_states`, `list_home_history`, `run_home_actions`). Needs Google Home Premium Advanced, a Cloud project and OAuth. **The page says nothing about speech, broadcast or display output.** [V, re-read today]
- Home APIs: Android and iOS SDKs only, no speak primitive. [D, RESEARCH.md]
- Cast: speaks through any audio URL, shows images up to 1280x720, is LAN-only, interrupts playback without resuming, and gives no answer back. [D, RESEARCH.md]

| Option | Really speaks? | Under the SDK with logs? | Effort | Failure risk on the day |
|---|---|---|---|---|
| **A. Cast via existing code + new SDK adapter + bridge** | Yes | Yes | **L** (M if the bridge is a sidecar) | Medium. Needs the same LAN, mDNS, and a Mac firewall allowance for the media server. [A] |
| B. Cast via the stdio MCP only | Yes | **No log, no device row** | S | Low technically, but it misses the stated goal |
| C. Local Home Assistant + `tts.speak` | Yes | Only with the same adapter work, plus HA | L | High. A new service to run. Docker on Mac lacks the host networking mDNS relies on. [A] Also conflicts with the no-auto-Docker rule unless he asks. |
| D. Assistant broadcast | Unofficial query workaround only | No | M | **Reject:** non-commercial, and Assistant is being replaced by Gemini |
| E. Home MCP | Not documented | No | M | **Reject for speech:** $20/month, and it controls devices rather than speaking |
| F. Browser-simulated speaker | Browser TTS only | `env=test` through `simulator`, `simulated:true` | S | Low, but not a Google Home. Must be labelled simulated. `_design/ui-output.tsx › SpeakerOutput` already calls `speechSynthesis`. [V] |

**Recommendation: A, with F as the prepared fallback.** First check that the existing Cast code works on his real speaker. That is a 5-minute go or no-go before anyone builds on it.

**Build for A**
- A `google_home` adapter, kind `home_hub`, transport `local_bridge`.
- Per-model descriptors: speaker gets `present.speak`; hub gets `present.speak` and `present.display`.
- A dispatcher that queues the call and returns `queued` with a message id.
- A generic bridge route with a device token. Today's device lookup is hard-locked to G2 (`sdk-glasses-port.ts › deviceFromTokenHash` has `.eq("adapter_id", EVEN_G2_INFO.id)`).
- A pull loop calling `service.js › createGoogleHome`, then ack, which moves the action to delivered or done.
- A device, credential and connection under the Dopl App project.
- Check the `dev_device_messages` schema for whether a speak kind fits. Only `notify` rows exist today. A migration may be needed. [A]

**A contract trap to fix**
- The catalog says the Speaker supports intent `notify`, but `delivery/intents.ts › capabilitiesFor("notify")` is `[present.notify, present.display]`, so a speaker refuses it with `capability_unsupported`. Use intent `message`, which includes `present.speak`.
- `present.speak` is T1, so there is no confirmation dialog. `home_hub-default` caps output at 400 characters and 4 lines. [V]

### 0.5 Playground made real

**Real today** (`/developers/playground`, `src/app/api/developers/playground/route.ts`) [V]
- One real `/v1` call, server-side and in process through `dispatch.ts`, with the same checks and the same event row.
- Returns request, masked key, response and the `dev_events` row.
- **Test env only, by a hard rule.** The caller pastes an `sk_test_` key, which is verified against the project. `sessionOnly`. The key is never stored or echoed.

**The demo Playground (`/playground/developers`) sends nothing.** The file header says so. Everything below is local: [V]
- `play()` is `setTimeout`.
- `responseOf`, `eventsOf` and `readRows` are fixed values.
- `requestOf` shows paths that do not exist (`POST /v1/deliver`, `POST /v1/actions`, `GET /v1/devices/{id}/{capability}`).
- Device ids like `dev_sim_g2` are invented.

**Real call shape. An SDK package exists: `@dopl/sdk`, in `packages/sdk`, private and not on npm (`npm view` returns 404).**

```ts
const dopl = new Dopl({ apiKey });
await dopl.users.deliver(externalUserId, {
  intent: "message",                // or notify | display | ask
  content: { text: "..." },         // or blocks | options; there is no `lines`
  target: "<device uuid>",          // or "auto" | a device kind
  urgency: "normal",
});
// answers { delivery_id, routed_to: { device_id, kind, reason }, status }
await dopl.devices.action(deviceId, "present.notify", { title, body });
await dopl.notify(id, { text, urgency }); await dopl.show(id, { blocks }); await dopl.ask(id, { question, options });
```

`dopl.deliver`, `dopl.act`, `dopl.read`, `content.lines`, the `device` field and the top-level `capability` field are all invented by the demo.

**Making Run real**
1. **Key.** Never let the key enter the Worker. Two choices:
   - Demo path: keep today's pasted test key, held in the page's memory and sent only to the route. No new risk, size S.
   - Later: no paste. Refactor `withDeveloperKey` so a session-authenticated route can run the handler with a resolved test identity. No raw key ever exists. Size M, and it touches the auth wrapper, so it needs careful review. Raw keys are hashed, so a server cannot look one up. Minting an ephemeral key per run would also clutter the Keys table.
2. **Execution.** Worker stub with the real SDK surface. Each call goes by `postMessage` to the page, then `POST /api/developers/playground`, then the answer returns to the Worker. Today's stub only records and answers `queued`. The 3-second kill must change too, because a call can now wait on the server. An `ask` on the route holds up to 200 seconds, and the Playground route does not send `Prefer: respond-async`.
3. **Harden the sandbox before it goes on an authenticated origin.** `playground-run.ts` blocks network by setting `self.fetch = undefined`. Deleting that property probably restores the prototype's `fetch`, and a same-origin blob Worker would then send session cookies. [W, not executed] Run the Worker inside a `sandbox` iframe without `allow-same-origin`, plus a CSP that blocks `connect-src`. Size S to M.
4. **Devices.** The Dopl App project has a test key but no test devices (all 4 are live). [V] Run needs a one-click "connect a simulated device" built on `connect_sessions` and the Connect page. Size M. For a real transport in test, `even_g2` is offered there in `test` too (`enter_code`). [V in code; never run]

### 0.6 Multiple devices and routing: yes, by id, with caveats

- Target by device id works: `delivery/router.ts › route` filters `c.device.id === target`, then presence, capability, grant. `DeliverTargetSchema` accepts any string. One end user already has 4 devices and 4 connections in production. [V]
- **Do not use `auto` on stage.** `delivery-service.ts › deliver` passes `lastSourceKind: null`, so "reply where the message came from" is not implemented. Ranking falls to most recently seen, which flips with each poll. [V]
- **Do not use `urgency:"high"` for a broadcast shot.** It fans out, but `baseEvent` carries only the primary device, so the log shows one device. The others sit in `action.result.fanout`. Send three calls instead. [V]
- Each device needs a grant covering its capability, or the router returns `grant_missing`. `migrate_prosumer_device` writes one for the G2. New desktop and Google Home rows need their own. [V]

### 0.7 One gap outside my scope that blocks the goal

The real portal has **no devices page**: `src/app/developers/` has keys, logs, org, playground, usage and webhooks only. [V] "The devices are connected" has no real screen. `/developers/logs` does work today.
- **Usage shows zero for this project by design.** `usage.ts` reads `dev_billable_events`, which excludes internal orgs: production count 0, `org_internal=true`. [V] Do not open Usage on stage unless this changes.
- The redesigned `/playground/developers` pages are fixtures. Showing them as evidence of the demo would be false until they are wired.

---

## 1. Hop-by-hop tables

### Flow A: Mac → agent → G2 simulator → log

| # | Step | Today | Evidence | Work needed | Size |
|---|---|---|---|---|---|
| 1 | Simulator online under Dopl App, live | Yes | Device `a5a061e6`, `last_seen` moving; PIDs 17627 and 17672 | Keep it running. Keep the window visible. | none |
| 2 | Message typed in Dopl desktop | Yes | `postMessage`; no `/v1` | Decide whether inbound should log (Q3) | none |
| 3 | Agent wakes | Yes | Channel runtime, existing product | None | none |
| 4 | Agent has a logged tool | Partly | `glasses_notify` proven; `exposure.ts › profileOffersGlasses`; `dopl-sdk-mcp` not installed | Build SDK, mint a new live key, `claude mcp add`, use a private channel | S |
| 5 | Call reaches `/v1` with the project key | Yes for notify; `deliver` unproven live | 2 ok rows; no `deliver` rows in production | One live smoke test of `deliver` with `target` by id | S |
| 6 | `even_g2` queues to `dev_device_messages` | Yes | `even-g2-dispatch.ts`; 2 rows | None | none |
| 7 | Plugin draws it, status `delivered` | Yes | 2 actions at `delivered`; prior production test | None | none |
| 8 | Log row at `/developers/logs` | Yes | 14 rows, env live | Remove stale devices so errors stop (Q5) | S |
| 9 | Device shown as connected | **No** | No real devices page | Real page over `devices` and `connections` | M |

### Flow B: agent → the Mac as a device → log

| # | Step | Today | Evidence | Work needed | Size |
|---|---|---|---|---|---|
| 1 | Mac registered as a device in the project | **No** | `sdk_desktops=0`; no pair port; Connect omits it | A registration path, device row, credential, connection and grant under Dopl App | M |
| 2 | Presence | **No** | Heartbeat writes `desktop_devices` only | Touch `devices.last_seen` on heartbeat or poll, sharing the 150-second window | S |
| 3 | `/v1` routes to it | Partly | The router works; candidates show the row once it exists | Nothing beyond step 1 | none |
| 4 | Dispatch | **No** | `desktopUnavailable` refuses | Replace with a queue dispatcher, at least for internal projects (Q2) | M |
| 5 | Mac receives | **No** | No pull loop | Loop in the desktop main process; requires a build or release (Q4) | M |
| 6 | User sees it | Partly | `notification-route.js` exists but raises only events it can name; in front = toast, elsewhere = banner | Add the event; check the Notifications preference on the demo Mac | S |
| 7 | Log row | Yes once 3 and 4 work | `withDeveloperKey` writes one row per call | None | none |

### Flow C: agent → Google Home → log

| # | Step | Today | Evidence | Work needed | Size |
|---|---|---|---|---|---|
| 1 | Physical speaker reachable from the Mac | **Unknown** | No evidence he owns one on the demo network | Q1; run `node dopl-desktop-app/main/google-home/mcp-stdio.js --discover` | S |
| 2 | Cast speaks | Partly | Code in master; tests are fake-socket only | First real run via `google_home_notify` | S |
| 3 | Device in the project | **No** | `home_hub` count 0; no adapter | Adapter, descriptors, row, credential, connection, grant | M |
| 4 | `/v1` routes with `intent:"message"` | Partly | Router ready; `present.speak` is in the `message` list | Fix the catalog's `notify` intent claim | S |
| 5 | Queue and bridge route | **No** | Device lookup locked to `even_g2` | Generic token route, inbox, ack; possible migration | M |
| 6 | LAN executor | **No** | `createGoogleHome` not wired anywhere | Pull loop calling it, sharing the Flow B loop | M |
| 7 | Status settles | **No** | `lens-actions.ts › markDelivered` is keyed by lens message id | Reuse for ack if the queue is shared | S |
| 8 | Log row | Yes once 3 to 5 work | Same wrapper | None | none |

**Shared build.** Flows B and C are one bridge with two executors. Together they are about L. Flow A alone is S, plus the devices page at M.

---

## 2. Playground element table

Files: `_sections/playground.tsx`, `playground-model.ts`, `playground-run.ts`, `_design/g2-screen.tsx`, `_design/ui-output.tsx`, `_data/catalog.ts`.

| Element | Status | Source | Work | Size |
|---|---|---|---|---|
| Category and model pickers | DATA EXISTS | `_data/catalog.ts`; real adapters are `even_g2`, `desktop`, `simulator` | Mark or hide the `@preview` models (Q6) | S |
| Capability chips | DATA EXISTS | `adapter.describe`; the simulator's `KIND_CAPABILITIES` differs from the catalog | Derive from the adapter | S |
| Message and answers fields | LIVE today (input only) | Local state | Build `content.text` and `content.options` as `{label}` | S |
| Code editor + Copy | LIVE today (local) | `CodeEditor` | None | none |
| Generated snippet | NEEDS NEW DATA | `snippetOf` invents the API | Rewrite to real `@dopl/sdk` calls | S |
| Run | NEEDS NEW DATA | `runSnippet` stub | Section 0.5 steps 1 to 3 | M |
| Target: Simulator | DATA EXISTS | `simulator` adapter, test env; returns `{simulated:true}` | Needs a test device, section 0.5 step 4 | M |
| Target: Real device | NEEDS PRODUCT DECISION | Route refuses live keys by rule | Q7 | S to M |
| Device picker + Online badge | DATA EXISTS | `devices`, adapter `health`; demo reads `useUsers` fixture | Real read | S |
| Status pill (Queued/Sent/Seen/Answered) | NEEDS NEW DATA | Real statuses: `queued`, `delivered`, `done`, `failed`, `needs_confirmation` | Map labels; poll `GET /v1/actions/{id}` | S |
| Output: G2 lens | DATA EXISTS | `g2-screen.tsx` wraps text itself; real layout is `platform.compileScreen` | Label as a preview, or return compiled output | S to M |
| Output: panel | DATA EXISTS | `PanelScreen`, hard-coded app "Larkfield Assist" | Remove the fixture name | S |
| Output: speaker | LIVE today (browser TTS) | `SpeakerOutput` → `speechSynthesis` | Label as simulated | S |
| Output: haptic | CUT for the demo | `HapticOutput`, no real device | Keep for simulator only, or cut | none |
| Output: act, read, capture | NEEDS NEW DATA or CUT | `changeOf`, `readRows` are fake; simulator returns only `{simulated:true}` | Add sample values to the simulator, or cut | M |
| Ask answer buttons | NEEDS PRODUCT DECISION | Simulator auto-answers the first option; the buttons cannot drive it | Cut, or add a test-only "answer" endpoint | S to M |
| T3/T4 confirm dialog | DATA EXISTS | Real policy returns `needs_confirmation`; dialog is local | Drive from the response | S |
| Request tab | LIVE today in the real route; fake in demo | `PlaygroundRun.request` | Show the real run | S |
| Response tab | LIVE today in the real route; fake in demo | `PlaygroundRun.response` | Show the real run | S |
| Events tab | LIVE today in the real route; fake in demo | `PlaygroundRun.event` is one `dev_events` row; `action.queued`/`ask.answered` are invented | Show the row; webhook events are a separate surface | S |
| Console log lines | LIVE today (local) | Worker `console` | Keep through the Worker | S |
| Test badge and env lock | LIVE today | `page.tsx` | Keep | none |

---

## 3. Recommended demo script

This assumes Flow A, B and C are built, the stale devices are gone, and Dopl App is the selected project. Fallbacks are in section 4.

**Before going on**
- Simulator visible beside the Dopl window.
- Portal open on `/developers/logs` for Dopl App, env live.
- Run one rehearsal send to all three devices within 10 minutes of starting.

| # | He does | On screen |
|---|---|---|
| 1 | Opens the Dopl desktop app, private channel "Demo", with the agent ready | Channel view; simulator beside it at Home |
| 2 | Types: "Tell me on my Mac that the build finished" | His message in the channel; agent activity |
| 3 | Agent calls `deliver`, target = Mac device id | Mac banner or Dopl toast; agent replies with `routed_to` |
| 4 | Types: "Now put it on my glasses" | **Lens card in the G2 simulator** |
| 5 | Types: "Ask me on the glasses whether to ship" | Ask card on the lens with options. He clicks an option in the simulator; the agent reads the answer. |
| 6 | Types: "Say it on the Google Home" | **Speaker speaks in the room** (Nest Hub: card too) |
| 7 | Switches to the portal, Logs | Newest rows: `present.speak` (home hub), `ask.choice` and `present.display` (glasses), `present.notify` (desktop), each `ok`, env live, with latency |
| 8 | Opens one row | `route_decision` with target id and reason, profile, risk tier, latency. No message content, by design. |
| 9 | Opens Devices | Mac, G2 and Google Home listed with Online state and last seen |
| 10 | Optional: Playground, Test env, runs a snippet with `dopl.users.deliver` | Real request, response and event row. Clearly labelled Test. |

**Say out loud:** the row also shows a `context` read beside each delivery. That is the MCP `deliver` tool reading context, not a duplicate send.

---

## 4. Top demo-day risks and fallbacks

| # | Risk | Evidence | Prevention | Fallback on stage |
|---|---|---|---|---|
| 1 | Conference or guest Wi-Fi blocks mDNS or isolates clients, so Cast fails | Cast is LAN-only [D]; venue unknown [A] | Bring a travel router; put Mac and speaker on it; test on site | Option F, labelled simulated, or a pre-recorded clip of the real speaker |
| 2 | Simulator restarted, re-paired and unmigrated: lens works but **no logs** | `sdkLensFor`, plugin README | Do not restart. If needed, migrate on production right after pairing | Dry-run query for the link count beforehand; prepare the RPC call in advance with his go-ahead |
| 3 | Simulator window hidden over 60 seconds: `device_offline` | 60-second window; README | Keep it visible on a second display. Rehearse the window switch. | Bring it forward and wait one poll (25 seconds max) |
| 4 | Stale devices fill the log with red | 12 errors vs 2 ok | Unpair the 3 stale devices; use `deliver` by id rather than `glasses_notify` | Filter Logs by device or outcome |
| 5 | Agent uses `glasses_show` or just replies: lens shows it, log does not | Section 0.2 | Pin the tool in the prompt: "use `deliver` with these device ids"; rehearse | Re-send with the explicit instruction |
| 6 | `deliver` to the G2 fails live: `present.display` over SDK has never run in production | 14 rows, all `present.notify` | Smoke test before the day | Use `intent:"notify"` → `present.notify` (proven) |
| 7 | Mac firewall blocks the media server, or `say` fails; speaker stays silent | `media-server.js`, `render.js`; never run on real hardware | First real run this week; allow the prompt | Same as risk 1 |
| 8 | Speaker plays something when called: Cast interrupts and does not resume; volume is whatever it was | DESIGN.md | Set the volume beforehand | None needed |
| 9 | Desktop banner suppressed by focus or Do Not Disturb | `notification-route.js` focus rule, preferences | Check Notifications settings; show the toast in the foreground | Point to the toast |
| 10 | Long `ask` holds on stage: `ask` holds up to 200 seconds without `Prefer: respond-async` | `delivery-routes.ts`; `server.ts` sends no Prefer (from reading) [A] | Answer promptly in the simulator | Skip step 5 |
| 11 | Live key leaks in terminal or MCP config on a shared screen | Key passed by env to `dopl-sdk-mcp` | New key for the demo; revoke after; never show config | Revoke immediately |
| 12 | Opening Usage shows zero | Billable view excludes internal | Skip Usage, or see Q8 | Say it excludes internal traffic |
| 13 | Electron restart mid-demo kills channel agents | Memory note, 2026-09-13 | Do not relaunch once the demo starts | Launch a new agent |

---

## 5. Questions only Samuel can answer

| # | Question | Recommendation |
|---|---|---|
| Q1 | Do you have a physical Google Home or Nest on the demo network, and where is the demo: home, recorded or a venue? | **Record at home on your own Wi-Fi if you can.** That removes the top risk. If live at a venue, bring a travel router. |
| Q2 | Should the Mac be a real SDK device, reversing the D1 refusal for internal projects only? | **Yes, for the Dopl App project only.** Keep the refusal for outside SDK customers, because the D1 reason still applies to them. |
| Q3 | Should the typed Mac message itself appear in the logs? | **No.** It is not a delivery. Show the agent's sends. Say it plainly in the narration. Logging inbound means implementing `input.utterance` events, which is a separate build. |
| Q4 | Is the demo on a new desktop release, or a local desktop build pointed at production? This needs an exception to the standing "Electron with local API" rule, and you launch it. | **Local build against `www.usedopl.com` for the demo**, with a sidecar-free loop in main. Release later, once it has soaked. |
| Q5 | May the 3 stale glasses devices be removed from production? Unpairing is permanent. | **Yes**, via Settings → Glasses, keeping `a5a061e6`. Separately, consider having `notifyOverSdk` skip devices already known to be offline. |
| Q6 | Should the Playground show adapters that do not exist (Meta, Mentra, iOS, CarPlay, Home Assistant)? | **Show them as simulator-only in the test env**, or hide them for the demo. Never imply a real device. |
| Q7 | Should the Playground's "Real device" tab be able to send live? The route refuses live keys by design today. | **Keep the live lock.** Change the tab to "paired test device" and pair a second simulator in test. Show live traffic through the Mac flow and Logs. |
| Q8 | Should internal traffic show on Usage for the Dopl App project? | **No.** Leave billing truth alone and skip the page on stage. |
| Q9 | May the server work be pushed and deployed to production, and migrations applied, before the demo? Logs on `www.usedopl.com` need it. | **Yes for the adapter and bridge**, on a branch merged by your word. Without this, only Flow A can be logged. |
| Q10 | If time runs short, what is the cut order? | **Keep A, then C, then B.** The Mac is already visibly the origin of the demo, so it loses the least if it is not a listed device. Glasses and a speaking Google Home are the memorable shots. |
