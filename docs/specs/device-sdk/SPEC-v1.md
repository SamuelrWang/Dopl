# Dopl Device SDK: Step 0 contracts and feature list

**Frozen v1, 2026-10-27.** Samuel approved D1–D6 as recommended (§7). Any change from here needs an explicit Samuel ruling plus a changelog line at the bottom. Build plan: `PLAN-trackA-docs.md`. The research behind this is in the same folder:

- `web-research-report.md`
- `grok-glasses-signals.md`
- `grok-cross-device-signals.md`

---

## 0. TL;DR

- **The product.** One SDK, sold to agent companies, that lets their agent reach any device: glasses, phones, desktops, smart home, cars and robots. Dopl's hosted cloud handles five jobs:
  1. Connect (pairing plus token vault)
  2. Capabilities (a uniform action model)
  3. Permissions (risk tiers, consent, expiry)
  4. Context routing (developer-customizable profiles per device)
  5. Analytics
- **The market gap is real.** The research found no commercial product that connects agents to devices across classes. Everything that exists covers a single class:
  - Glasses: Extentos, MentraOS
  - Cars: Smartcar
  - Robots: Viam
  - Home: Google Home MCP and Home Assistant MCP

  One very early direct cross-device competitor has surfaced, **Pinout**, announced on X on 2026-10-22.
- **What developers keep asking for:**
  1. Credentials never touch the agent, every call is governed and logged.
  2. Short-lived, scoped permissions that expire.
  3. Independent safety guardrails for physical actions.
  4. Simulators and a test mode.
  5. Adapters that someone else maintains as vendor SDKs churn.
  6. Low context cost: dozens of tool definitions blow up the agent's prompt.
- **About 30% exists today**, all of it single-user and glasses-first:
  - Even G2 adapter
  - Pairing codes
  - Device tokens
  - Display blocks v2
  - Message source stamp
  - One hardcoded glasses reply rule
  - `mcp_tool_calls` logging
- **What's missing is the multi-tenant developer layer.** There are no developer orgs, projects, API keys, end-user namespaces, Connect flow, context profiles, risk-tier policy or developer analytics.
- **The public `/docs` describe a lot that doesn't exist yet**, such as `api.usedopl.com/v1`, `pip install dopl`, the CLI, the Connect link, and phone push and Mac notch listed as "available". Fix this in the docs pass.

---

## 1. Principles (confirm or veto)

| # | Principle | Why |
|---|---|---|
| P1 | **End users never need a Dopl account.** They belong to the developer's app and are identified by `external_user_id`. This works like Plaid, where end users never sign up with Plaid. | Today, claiming a pairing code requires a signed-in Dopl session. That is the biggest structural change. |
| P2 | **The hosted cloud is the source of truth.** Device credentials live only in the Dopl vault, and agent companies hold opaque `connection_id`s. | Plaid/Smartcar pattern; matches @leandrojmartins: "creds never leave gateway". |
| P3 | **There is one device-agnostic capability model**, and every adapter maps onto it. | It's how one SDK can cover every device class. |
| P4 | **Permissions are set per action risk tier, not per device.** Physical actions get confirmation and limits that are enforced outside the model. | Unitree RCEs, Home Assistant locks excluded by default, CarPlay's limits. |
| P5 | **Dopl ships good defaults for routing and output, and developers override everything.** | This is the "we handle it, you customize it" pitch. |
| P6 | **Every call emits one event row from day one.** | Analytics can't be backfilled. |
| P7 | **Four interfaces sit on one API:** REST, TS and Python SDKs, an MCP server, and the Connect widget. | Meta, Snap, Rokid, Mentra and Extentos all ship agent-native and MCP integration paths. |
| P8 | **Brand-free (white-label) by default.** The Connect UI, consent screens and display chrome carry the developer's brand. | This is in your pitch, and Plaid Link-style customization is the expected bar. |

---

## 2. Object model

```
Org (agent company)
 └─ Project
     ├─ Environment: test | live          (separate keys, data, webhooks)
     ├─ API keys: sk_test_… / sk_live_… (secret), pk_… (publishable, Connect only)
     ├─ Context profiles                   (C5)
     ├─ Display templates                  (C6)
     ├─ Webhook endpoints                  (C8)
     └─ End user  (external_user_id = developer's own id)
         └─ Connection  (one user's grant to one device)
             ├─ granted capability scopes + expiry   (C7)
             └─ Device
                 ├─ kind: glasses | phone | desktop | watch | home_hub | home_device | vehicle | robot | …
                 ├─ vendor / model / firmware
                 ├─ adapter_id + adapter version      (C9)
                 └─ capability descriptors            (C3)
```

**Today's code maps onto it like this:**

- `glasses_device_links` and `desktop_devices` become rows of one `devices` table. This also closes finding F-770 (separate tables per device type).
- `mcp_tokens` and `oauth_clients` keep serving the agent-side MCP. Developer API keys are new.
- `glasses_templates` move from per user to per project.

---

## 3. The contracts

### C1. Auth and API keys
- **Secret keys.** `sk_test_*` and `sk_live_*` are for server-to-server use, sent as a Bearer header. Keys are stored hashed and can be rotated with an overlap window.
- **Publishable keys.** `pk_*` keys can only create Connect sessions in the browser or app.
- **MCP path.** It keeps the existing OAuth 2.1 server, extended with *project-scoped* tokens so an agent's MCP calls are attributed to a project and an end user.
- **Key scopes.** Coarse scopes per key: `connect`, `devices:read`, `actions:write`, `analytics:read`.
- **Status: not built.** API keys were dropped in `20260609000000_drop_api_key_auth.sql`; this is a fresh design.

### C2. Connect flow (Plaid-Link style)

**Server calls:**
```
POST /v1/connect_sessions
  { external_user_id, allowed_kinds?: [...], requested_scopes: [...], redirect_uri?, branding? }
  → { connect_token, url, expires_at }

# The developer opens the Connect widget (web, iOS or Android) or the hosted URL.

POST /v1/connections/exchange { public_token } → { connection_id, device }
GET  /v1/users/{external_user_id}/connections
DELETE /v1/connections/{id}          # revoke
```

**Inside the widget:**
1. **Compatibility pre-check.** Show the capabilities this exact model and firmware supports, the way Smartcar does.
2. **Per-adapter pairing.** Each device type pairs its own way:
   - Code pairing for glasses (the G2 flow exists today).
   - Vendor OAuth for Google Home, Tesla or Smartcar.
   - A local-bridge claim for Home Assistant or ROS.
3. **Consent screen.** The user approves the requested scopes, shown by risk tier.

**Webhooks:** `connection.created`, `connection.revoked`, `connection.needs_reauth`, `device.offline`, `device.online`.

**Status: partial.** Pairing codes, device tokens and the poll secret exist (`core/devices/pairing.ts`). Still missing: the Connect widget, the token exchange, the end-user namespace, the consent screen and the pre-check.

### C3. Capability model (device-agnostic)

Every device publishes **capability descriptors**. Agents and SDKs call capabilities, never vendor APIs.

| Family | Capabilities | Risk tier |
|---|---|---|
| `state` | `state.read`, `telemetry.read`, `presence.read` | T0 read |
| `present` | `present.notify`, `present.display` (blocks), `present.speak` (TTS/audio), `present.haptic` | T1 present |
| `ask` | `ask.choice`, `ask.confirm`, `ask.text` (voice) | T1 |
| `capture` | `capture.photo`, `capture.audio`, `capture.video_stream`, `capture.screen` | T2 ambient sensing (bystander risk) |
| `input` | an event stream: voice utterance, tap, gesture, button | T1 |
| `act` | `act.set` (lights, thermostat), `act.media`, `act.navigate`, `act.lock` | T3 reversible / **T4** safety-critical |
| `act.motion` | robot move, gripper, vehicle commands | **T4** |

A descriptor looks like this:
```json
{ "capability": "present.display",
  "limits": { "width_px": 576, "height_px": 248, "max_blocks": 12, "max_text_bytes": 960,
              "charset": "ascii+box", "color": "mono" },
  "latency_class": "interactive", "risk_tier": "T1", "since_adapter": "even_g2@0.3" }
```

- **Evidence.** The HKUST xg.glass survey found that four calls (photo, audio record, display text, audio play) covered every proposed glasses app. Robots, cars and the home add `act` and `telemetry`.
- **Status: partial.** `glasses_capabilities` and the G2 display limits exist. There is no cross-kind schema and no risk tiers.

### C4. Actions API

There are two levels, and developers pick per call.

**Intent level (recommended).** Dopl picks the device using C5:
```
POST /v1/users/{external_user_id}/deliver
  { intent: "message" | "ask" | "notify" | "display",
    content: { text?, blocks?, options? },
    urgency: "low" | "normal" | "high",
    target?: "auto" | device_id | kind,
    profile?: profile_id,
    idempotency_key }
  → { delivery_id, routed_to: { device_id, kind, reason }, status }
```

**Device level (explicit):**
```
POST /v1/devices/{device_id}/actions/{capability}  { args, idempotency_key }
  → { action_id, status: queued | delivered | done | failed | needs_confirmation }
GET  /v1/actions/{id}        # poll
# The result also arrives on the action.completed webhook. ask.* actions hold for up to 200s, like glasses_ask today.
```

**Common rules:**
- Every action is async and idempotent.
- Errors come back in one shape (C10).
- Status for T4 actions passes through `needs_confirmation` (C7).

**Status: partial.** The `show`, `ask` and `notify` semantics exist for glasses via MCP and `/api/displays`. There are no `/v1` REST routes. The `/docs` describe `/users/{id}/show|ask|notify`, so reconcile those names.

### C5. Device context and routing: the differentiator

**Context object.** Returned by the API and injected into MCP tool results:
```json
GET /v1/users/{external_user_id}/context
{ "active_device": { "id": "...", "kind": "glasses", "model": "even_g2", "last_seen_s": 4 },
  "posture": "glanceable",          // glanceable | hands_free | seated | driving | unknown
  "available": [ {kind, id, capabilities[]} ],
  "profile": { "id": "glasses-default", "prompt_append": "...", "output": {...} },
  "source_of_last_message": "glasses" }
```

**Context profile.** Owned by the developer, set per device kind, model or posture:
```json
{ "id": "my-glasses", "match": { "kind": "glasses" },
  "prompt_append": "User is on AI glasses, likely on the move. Reply in ≤5 short plain lines…",
  "output": { "max_lines": 5, "max_chars": 300, "format": "plain", "markdown": false },
  "allowed_capabilities": ["present.*", "ask.*"],
  "display_template": "tpl_brief_card",
  "confirmation": { "T3": "on_device", "T4": "deny" },
  "overflow": "truncate" | "send_to": "phone" | "callback" }
```

**Routing policy (`target: auto`).**
1. Filter devices by presence (seen within N seconds), the required capability and the user's grants.
2. Rank by the developer's rule order (default: the device the last message came from, then the most recently active, then a fallback chain).
3. Apply urgency. `high` may fan out to several devices; `low` waits for the active device.
4. Log the routing decision and its reason (C8).

**Rules:**
- Dopl ships default profiles per kind.
- Developers override per project, and later per end user.
- Profiles are versioned, so analytics can compare them.

**Status: partial, about 15%.** Built so far:
- `metadata.source` stamping (`message-source-stamp.ts`).
- The hardcoded `GLASSES_REPLY_GUIDANCE`, which becomes the default glasses profile.
- `target: auto | channel | glasses` (`display/server/service.ts:53`).

The profile store, editor, override layering and multi-device ranking are all new.

**Open question.** Should Dopl ever *rewrite* content to fit a device (summarize long text for glasses), or only pass the profile to the developer's agent and enforce limits by truncating? This is decision D3 in §7.

### C6. Custom displays

**Block vocabulary v2** is already built: heading, text, fields, list, choice, progress, table, divider, spacer. It becomes the cross-device display language.

**Additions:**
- An `image` block (the docs already claim it exists).
- Per-kind `degrade` rules. The G2 rules exist; phone, watch and car screens are new.
- **Project-scoped templates** with `{{var}}` placeholders.
- `validate_only` preview per device.
- **Custom renderer escape hatch.** A developer can ship their own on-device bundle (for example an Even Hub plugin or a Meta Display web app) under their own brand, and Dopl handles transport and auth. This answers "they build their own display, not a cookie-cutter one".
- **Simulator.** Web preview of every kind's lens or screen. Doubles as the developer-portal playground.

**Status:** blocks, degrade and templates are built, but only for glasses and only per user. Images, project templates, custom renderers and multi-kind preview are not built.

### C7. Permissions, consent, safety

**Three layers:**
1. **Project requests.** A project requests capability scopes in its config.
2. **End-user grants.** The user grants them per connection on the Connect consent screen. Grants can carry a TTL (an expiry, or "permission half-life").
3. **Policy engine.** It runs on every call, independent of the model. It checks:
   - the grant
   - the risk tier
   - rate and budget
   - the confirmation rule
   - region policy

**Risk tier defaults:**

| Tier | Example | Default |
|---|---|---|
| T0 | read state | allow |
| T1 | display, notify, speak | allow |
| T2 | camera or mic capture | allow only with an explicit grant; adapters must expose bystander indicators |
| T3 | lights, media | allow, with confirmation configurable |
| T4 | locks, vehicle, robot motion | **confirm every call** on a trusted surface, plus hard limits (speed, geofence, time window), plus a safe stop when connectivity drops |

**Also in this contract:**
- An audit log (who, what, which device, which grant, outcome).
- Instant revoke from the developer's API **and** from a Dopl-hosted end-user page, the way Plaid Portal works.

**Status: not built.** What exists today is the Ask/Auto/Full levels for Dopl's own agents, and session-only device management (`session-policy.ts`).

### C8. Events, webhooks, analytics

**Event row.** Written once per SDK, REST or MCP call:
```
event_id, ts, org_id, project_id, env, external_user_id, connection_id,
device_id, device_kind, vendor, model, firmware, adapter_version,
capability, intent, route_decision{target,reason,candidates}, profile_id@version,
risk_tier, confirmation{required,result}, outcome, error_code,
latency_ms{api,device_delivery,user_response}, bytes_in/out, cost_units
```

**Webhooks:**
- `connection.*`
- `device.online` / `device.offline`
- `action.completed` / `action.failed`
- `ask.answered`
- `input.utterance` (device-originated input)

Webhooks are signed, retried, and replayable from the portal.

**Analytics API and portal views:**
- Active users and devices (DAU/MAU by kind)
- Device mix
- Top capabilities and intents
- Error rate by vendor and firmware
- Latency p50/p95
- Routing outcomes (where messages landed, how often fallback fired)
- Profile A/B
- Cost and usage for billing

**Request logs** are retained per plan (Smartcar uses log retention as a pricing lever).

**Status: partial.** `mcp_tool_calls` and `credit_usage_events` exist but key on workspace and user. They have no project, device, latency or outcome fields.

### C9. Adapter contract (internal, Dopl-maintained)

```ts
interface DeviceAdapter {
  id: string; version: string; kinds: DeviceKind[];
  transport: "cloud_oauth" | "phone_bridge_ble" | "on_device_runtime" | "local_bridge" | "os_registry";
  describe(device): CapabilityDescriptor[];          // feeds C2 pre-check + C3
  pair(session): PairingFlow;                        // code | oauth | local claim
  execute(device, capability, args): ActionResult;
  events(device): AsyncIterable<DeviceEvent>;        // input + telemetry
  health(device): { online, last_seen, firmware };
}
```

- **Transports:**
  - Phone bridge over BLE: glasses (Even, Meta DAT)
  - On-device runtime: Even Hub plugin, Mentra app
  - Cloud OAuth: Google Home, Smartcar, Tesla
  - Local bridge: Home Assistant, ROS rosbridge
  - OS registry: App Intents, AppFunctions
- **Version drift is the product.** Adapters are versioned and have contract tests against simulators, and adapter versions show up in analytics.
- **Status:** `GlassesPlatform` (`platforms/types.ts`) with a single `even_g2` entry is the seed. It needs to be generalized beyond glasses.

### C10. Errors, versioning, environments
- **Error shape:** `{ error: { type, code, message, device_kind?, retryable, doc_url } }`. Codes include `device_offline`, `capability_unsupported`, `grant_missing`, `grant_expired`, `confirmation_denied`, `rate_limited`, `vendor_error`, `needs_reauth`.
- **API versioning:** dated versions pinned per project, Stripe style. SDKs follow semver.
- **Test mode:**
  - Simulated devices of every kind.
  - Magic IDs that force failure states, like Plaid's sandbox (`sim_device_offline`, `sim_confirm_denied`).
  - Test data that never touches live.

---

## 4. Feature list: status and priority

P0 is needed for the first design partner. P1 is needed to sell broadly. P2 comes later.

| Feature | Contract | Status | Priority |
|---|---|---|---|
| Orgs, projects, test/live environments, API keys | C1 | ❌ | **P0** |
| End-user namespace (`external_user_id`), no Dopl account | C2 | ❌ | **P0** |
| Connect session + widget + exchange (glasses first) | C2 | 🟡 pairing exists | **P0** |
| Unified `devices` table + capability descriptors | C3 | 🟡 | **P0** |
| `/v1` REST: deliver, device actions, context | C4/C5 | ❌ (MCP equivalents exist) | **P0** |
| Context profiles: defaults + project overrides | C5 | 🟡 one hardcoded rule | **P0** |
| Auto routing with logged decision | C5 | 🟡 glasses-vs-channel only | **P0** |
| Event row on every call | C8 | 🟡 `mcp_tool_calls` | **P0** |
| TS SDK + project-scoped MCP server | P7 | 🟡 private packages | **P0** |
| Risk tiers + consent screen + grant TTL | C7 | ❌ | **P0** (light version) |
| Simulator / test mode with simulated devices | C10/C6 | ❌ | **P0** |
| Docs rewrite with built / coming-soon labels | — | 🟡 overstated | **P0** |
| Webhooks (signed, retries, replay) | C8 | ❌ | P1 |
| Developer portal: keys, profiles editor, logs | — | ❌ | P1 |
| Analytics dashboards + API | C8 | ❌ | P1 |
| Project-scoped display templates + image block | C6 | 🟡 | P1 |
| Python SDK | P7 | ❌ | P1 |
| Adapters: Meta DAT, Mentra, Home Assistant, Google Home | C9 | ❌ | P1 |
| Hosted end-user permissions page (revoke) | C7 | ❌ | P1 |
| Custom on-device renderer path | C6 | ❌ | P2 |
| T4 actuation adapters (cars via Smartcar, robots via ROS bridge) | C9/C7 | ❌ | P2 |
| Per-end-user profile overrides, profile A/B | C5 | ❌ | P2 |
| Region policy (EU DMA/Data Act routes) | C7 | ❌ | P2 |
| Self-hosted / VPC option | — | ❌ | P2 |

---

## 5. Device rollout (recommendation)

1. **Glasses: Even G2** (built), then **Meta via DAT 1.0** (biggest install base) and **Mentra** (open, multi-OEM). This is the wedge where you already have depth.
2. **Phone + desktop.** These are the fallback surfaces every routing chain needs (push, notch). Desktop presence exists already.
3. **Smart home via cloud MCPs** (Home Assistant native MCP, Google Home MCP early access). This is the cheapest way to "any device": we wrap their MCPs behind our auth, permissions and analytics, which is mostly adapter work.
4. **Cars via Smartcar as a supplier.** Don't rebuild OEM integrations; wrap them, and bring T4 policy in here.
5. **Robots via a ROS bridge.** Simulator first (MuJoCo / ros-mcp-server), real hardware only with T4 limits.

---

## 6. Research highlights

**Competitors and adjacent players:**
- **Extentos:** vendor-agnostic glasses SDK + MCP + simulator; analytics "soon". Closest in glasses; tiny traction.
- **Pinout** (@mmisbbahh, 2026-10-22): "universal hardware infrastructure for agents… one SDK". Same pitch, very early. Watch it.
- **MentraOS:** open glasses OS + cloud, app store, permissions. OS-shaped, not white-label for agent companies.
- **Smartcar** (cars), **Viam** (robots), **Tuya Claw** (3000+ home categories), **Google Home MCP**, **Home Assistant MCP:** single-class.
- **OEM-owned agent tooling** (Meta starter kit, Snap Lens Studio agents, Rokid AIUI): validates an agent-first developer experience, but every one is single-vendor.

**Thesis check (ecosystems open up):**
- **For:**
  - Meta went from closed to DAT 1.0, with display access, in about 12 months.
  - Even Hub, Rokid AIUI and Snap all launched in 2026.
  - The EU DMA and Data Act force interoperability and data access.
  - Reverse engineering is everywhere (G2 protocol, Meta, Unitree, Tesla bypass threats).
- **Against:**
  - Makers open *I/O* but keep *the assistant and distribution* closed.
  - Tesla started charging for API access.
  - GM is closing phone projection.
- **Net:** you win as long as the layer brings the agent company's *own* AI to the device and absorbs vendor churn. That is the pitch.

**Developer quotes worth reusing:**
- "Treat static API keys as compromised… short-lived… least agency." (Anthropic guide via @DataChaz)
- "permission half-life" (@0xRiRoyal)
- "operating limits enforced independently of the model" (@Cr8DigitalAsset)
- "the bottleneck is how much context accessing the tool costs" (@aakashgupta). This argues for a small intent-level API (`deliver`) over dozens of device tools.

---

## 7. Decisions: approved 2026-10-27, all as recommended

| # | Question | Recommendation |
|---|---|---|
| D1 | End users need no Dopl account (P1)? | **Yes.** Without it, this isn't an SDK. |
| D2 | First design-partner device scope? | **Glasses + phone/desktop fallback**, with Home Assistant as the first non-glasses proof of "any device". |
| D3 | Does Dopl rewrite content to fit a device, or only enforce limits? | **Only enforce limits** (truncate, overflow to another device, or callback), and pass the profile to the developer's agent. Their model writes the words. That avoids our LLM cost and keeps their voice. |
| D4 | API naming: `/users/{id}/show\|ask\|notify` (current docs) or `/deliver` + `/actions`? | **`/deliver` with an `intent` field** plus device-level `/actions`. One tool beats dozens for context cost. Keep `show/ask/notify` as SDK helper methods. |
| D5 | Pricing unit? | Hold until discovery calls. The candidates are per connected device per month (Smartcar) or per call. Collect `cost_units` in events now either way. |
| D6 | Use reverse-engineered adapters? | **Official SDKs only** for paying customers. Keep reverse-engineered ones behind an "experimental" flag. |

---

## 8. Discovery call questions (from the research)

1. Which devices do your users own or ask for, and which would you pay to support first?
2. Do you stream device audio and camera to your own model today? What latency, cost and battery budget is acceptable?
3. Who holds users' device credentials in your architecture, and would you let a third party vault them?
4. Which actions must never run without human confirmation?
5. How do you adapt responses per surface today: separate prompts, separate agents, or nothing?
6. Do you want to ship inside each OEM's store, or keep users in your own app with a white-label connect flow?
7. What broke the last time a vendor changed its SDK, firmware or pricing, and what did it cost you?
8. Which pricing model fits: per connected device per month, per call, or a platform fee?
9. Do you need simulators or test devices in CI, and which failure states matter most?
10. Which analytics would change your product decisions?
11. Would you use reverse-engineered adapters, or only official ones?
12. Does EU-only interoperability (DMA, Data Act) matter for your users?

---

## 9. What happens after you approve

1. **Lock the contracts.** Apply your rulings on D1–D6, then freeze C1–C10 as the source of truth. That means an OpenAPI file plus TS types in `packages/contracts`.
2. **Track A, backend P0s, in this order:**
   1. Orgs, projects, keys
   2. Event row
   3. Unified devices table
   4. Connect
   5. Profiles + routing
3. **Track B, docs rewrite** against the frozen contracts, with built / coming-soon labels. It runs in parallel with Track A.
4. **Portal (web)** after the Track A APIs exist: keys, then profile editor, then logs, then analytics.

---

## Changelog
- 2026-10-27 — Frozen v1. D1 no end-user Dopl accounts · D2 glasses + phone/desktop fallback, Home Assistant first non-glasses · D3 enforce limits only, never rewrite · D4 `/deliver` + `/actions`, show/ask/notify = SDK helpers · D5 pricing held, `cost_units` logged · D6 official SDKs only for paying customers, reverse-engineered = experimental flag.
