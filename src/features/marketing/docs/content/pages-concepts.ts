import { json, PLANNED } from "./shared";
import type { DocPage } from "./types";

/**
 * Concepts, first half: projects and keys (C1), end users and connections (C2), devices and
 * capabilities (C3), permissions and safety (C7). ⚠ Every value here mirrors
 * `@dopl/device-contracts` and the built behaviour in `src/features/device-sdk/` (policy:
 * `delivery/policy.ts`; consent: `server/connect/scopes.ts`); `content.test.ts` checks the
 * capability tiers, the tier policy and the rate limit against them. All `coming_soon`: built on
 * master, not deployed.
 */

/** C3: every capability with its default tier (`capabilities.ts › CAPABILITY_RISK_TIER`). */
export const CAPABILITY_ROWS: [family: string, ids: string[], tier: string, what: string][] = [
  ["state", ["state.read", "telemetry.read", "presence.read"], "T0", "Read device state, telemetry and whether the user is present"],
  ["present", ["present.notify", "present.display", "present.speak", "present.haptic"], "T1", "Notify, show display blocks, speak, or buzz"],
  ["ask", ["ask.choice", "ask.confirm", "ask.text"], "T1", "Ask a question and get the answer back"],
  ["input", ["input.utterance", "input.tap", "input.gesture", "input.button"], "T1", "Receive what the user says or does on the device"],
  ["capture", ["capture.photo", "capture.audio", "capture.video_stream", "capture.screen"], "T2", "Capture from cameras, microphones or the screen"],
  ["act", ["act.set", "act.media", "act.navigate"], "T3", "Reversible changes such as lights, media or navigation"],
  ["act", ["act.lock"], "T4", "Locks"],
  ["act.motion", ["act.motion.move", "act.motion.gripper", "act.motion.vehicle"], "T4", "Robot and vehicle motion"],
];

/**
 * C7 per tier: [tier, examples, ticked on the consent screen by default, what happens at call time].
 * The third column is `connect/scopes.ts › defaultGranted`; the fourth is `policy.ts ›
 * confirmationModeFor` with no profile confirmation configured.
 */
export const TIER_ROWS: [tier: string, examples: string, ticked: boolean, atCallTime: string][] = [
  ["T0", "Read state and presence", true, "Allowed"],
  ["T1", "Display, notify, speak, ask", true, "Allowed"],
  ["T2", "Camera, microphone or screen capture", false, "Allowed only when the user ticked it"],
  ["T3", "Lights, media, navigation", false, "Allowed when ticked, unless your profile asks for confirmation or denies the tier"],
  ["T4", "Locks, vehicle and robot motion", false, "Denied by default, even when ticked. With a confirmation mode in your profile, every call returns `needs_confirmation` and does not run"],
];

/** The G2's `ask.choice` descriptor, exactly as `adapters/even-g2.ts › describe` returns it. */
export const G2_ASK_DESCRIPTOR = {
  capability: "ask.choice",
  limits: { question_bytes: 120, option_bytes: 40, min_options: 2, max_options: 4, hold_s: 200 },
  latency_class: "interactive",
  risk_tier: "T1",
  since_adapter: "even_g2@0.1.0",
};

export const CONCEPT_PAGES: DocPage[] = [
  {
    slug: "concepts/projects-and-keys",
    section: "core",
    group: "Concepts",
    title: "Projects, environments and keys",
    description: "How your organization, projects, test and live data, and API keys fit together",
    status: "beta",
    blocks: [
      PLANNED,
      {
        type: "p",
        text: "Your company is an organization in Dopl, and each product you build is a project inside it. A project holds everything the API touches: its keys, its context profiles, its end users, their devices and connections, and the event log.",
      },
      { type: "h2", text: "Environments" },
      {
        type: "p",
        text: "Every project has a `test` and a `live` environment with separate keys and data. A test key can never read or write live data, simulated devices exist only in test, and you switch to real devices by changing the key.",
      },
      { type: "h2", text: "API keys" },
      {
        type: "table",
        columns: ["Key", "Where it is used", "What it can do"],
        rows: [
          ["`sk_test_…` and `sk_live_…`", "Your server only", "Every route its scopes allow"],
          ["`pk_…`", "Your web or mobile app", "Only create Connect sessions"],
        ],
      },
      {
        type: "p",
        text: "Send a key as `Authorization: Bearer <key>`. Dopl stores only a hash of each key, so a key is shown once when it is created, and rotating a key keeps the old one working for an overlap window, 24 hours by default, so you can deploy without downtime. While the developer portal is being built, Dopl issues and rotates your project's keys for you.",
      },
      { type: "h3", text: "Scopes" },
      {
        type: "p",
        text: "Each key carries coarse scopes, and a call outside them fails with `insufficient_scope`.",
      },
      {
        type: "table",
        columns: ["Scope", "Routes"],
        rows: [
          ["`connect`", "Create a Connect session, exchange a public token, list and revoke connections"],
          ["`devices:read`", "Get context"],
          ["`actions:write`", "Deliver, run a device action and get an action"],
          ["`analytics:read`", "Reserved for the analytics API"],
        ],
      },
      { type: "h2", text: "Request IDs" },
      {
        type: "p",
        text: "Every response carries a `Request-Id` header. It is the ID of the event Dopl recorded for that call, so quote it when you contact support.",
      },
      { type: "h2", text: "Versions" },
      {
        type: "p",
        text: "The API is versioned by date, and each project is pinned to one version, currently `2026-10-27`, so a change on our side never breaks your integration silently. The SDKs follow semantic versioning.",
      },
    ],
  },
  {
    slug: "concepts/users-and-connections",
    section: "core",
    group: "Concepts",
    title: "End users and connections",
    description: "Your users stay yours, and each device they link becomes a connection",
    status: "beta",
    blocks: [
      PLANNED,
      {
        type: "p",
        text: "An end user is one of your users, identified by your own ID as `external_user_id`. End users never sign up with Dopl. They belong to your app, the way a bank customer never signs up with the service that links their account. Dopl creates the end user the first time you open a Connect session for that ID.",
      },
      { type: "h2", text: "Connections" },
      {
        type: "p",
        text: "A connection is one user's grant to one device. Your server holds the opaque connection ID, while device credentials stay in the Dopl vault and never reach your servers or your agent.",
      },
      {
        type: "table",
        columns: ["Status", "Meaning"],
        rows: [
          ["`active`", "The device is reachable within the granted scopes"],
          ["`needs_reauth`", "The user must reconnect the device before Dopl can reach it"],
          ["`revoked`", "You revoked it, and nothing reaches the device"],
        ],
      },
      {
        type: "p",
        text: "Each connection lists its grants: a capability scope such as `present.*`, when it was granted and when it expires, if ever.",
      },
      { type: "h2", text: "How a user connects" },
      {
        type: "list",
        ordered: true,
        items: [
          "Your server creates a Connect session for the user with the scopes your agent needs. The session's link works for 30 minutes.",
          "The user opens the hosted page, which carries your name, logo and accent color, and chooses a device. Each option shows how many of your requested scopes that device supports.",
          "They pair it the way that device pairs. Even Realities G2 glasses show a code on the lens that the user types into the page; a simulated device shows its code on the page.",
          "They approve the scopes, grouped by risk tier. T0 and T1 scopes start ticked and everything from T2 up starts unticked, and the user can grant any subset.",
          "The page returns to your `redirect_uri` with a one time `public_token`, which your server exchanges for the connection within 30 minutes.",
        ],
      },
      {
        type: "p",
        text: "[Connect a device](/docs/guides/connect-a-device) walks through it with code. Revoking a connection takes effect immediately, and revoking one that is already revoked returns it unchanged.",
      },
      { type: "h2", text: "Webhooks" },
      {
        type: "p",
        text: "Dopl records `connection.created` and `connection.revoked` for every connection today. Delivering them to a URL you register comes with the developer portal, together with `connection.needs_reauth`, `device.online` and `device.offline`.",
      },
    ],
  },
  {
    slug: "concepts/devices-and-capabilities",
    section: "core",
    group: "Concepts",
    title: "Devices and capabilities",
    description: "One action model for every device, sorted by risk",
    status: "beta",
    blocks: [
      PLANNED,
      {
        type: "p",
        text: "Every device has a kind (`glasses`, `phone`, `desktop`, `watch`, `home_hub`, `home_device`, `vehicle` or `robot`), a vendor, model and firmware, and the adapter that reaches it. Instead of vendor APIs, each device publishes capability descriptors, and your agent calls capabilities by ID.",
      },
      { type: "h2", text: "Capabilities and risk tiers" },
      {
        type: "table",
        columns: ["Family", "Capabilities", "Default tier", "What it does"],
        rows: CAPABILITY_ROWS.map(([family, ids, tier, what]) => [
          `\`${family}\``,
          ids.map((id) => `\`${id}\``).join(", "),
          tier,
          what,
        ]),
      },
      {
        type: "p",
        text: "A scope can name one capability or a whole family, such as `present.*` or `act.motion.*`. A family scope counts at the highest tier among its members, so `act.*` is a T4 scope because it includes `act.lock`. [Permissions and safety](/docs/concepts/permissions-and-safety) has the rules for each tier.",
      },
      { type: "h2", text: "Descriptors" },
      {
        type: "p",
        text: "A descriptor states a capability's limits on that exact device, how fast it answers (`realtime`, `interactive` or `deferred`), its risk tier and the adapter version that added it. This is the Even Realities G2's question capability:",
      },
      {
        type: "code",
        tabs: [
          {
            label: "ask.choice",
            code: json(G2_ASK_DESCRIPTOR),
          },
        ],
      },
      {
        type: "p",
        text: "The Connect page checks these descriptors before the user pairs, and Dopl checks them again on every call: a capability the device does not publish fails with `capability_unsupported` rather than reaching the device. Each [device page](/docs/devices) lists its capability matrix.",
      },
    ],
  },
  {
    slug: "concepts/permissions-and-safety",
    section: "core",
    group: "Concepts",
    title: "Permissions and safety",
    description: "Grants from the consent screen, risk tiers and confirmation that the model cannot skip",
    status: "beta",
    blocks: [
      PLANNED,
      {
        type: "p",
        text: "Permissions work in three layers. Your project requests capability scopes when it opens a Connect session, the user grants some or all of them on the consent screen, and a policy engine checks every call against that grant. The policy engine is plain code that runs outside any model, so a prompt cannot talk its way past it.",
      },
      { type: "h2", text: "Risk tiers" },
      {
        type: "table",
        columns: ["Tier", "Examples", "On the consent screen", "At call time"],
        rows: TIER_ROWS.map(([tier, examples, ticked, atCallTime]) => [
          tier,
          examples,
          ticked ? "Ticked by default" : "Unticked until the user ticks it",
          atCallTime,
        ]),
      },
      { type: "h2", text: "What the policy engine checks" },
      {
        type: "list",
        ordered: true,
        items: [
          "The connection is active, not revoked and not expired.",
          "One of its granted scopes covers the capability, at the capability's tier or above.",
          "The tier's confirmation rule in the device's context profile. T4 is denied unless the profile sets a confirmation mode.",
          "The project's rate limit: 600 deliveries and device actions per minute per environment by default.",
        ],
      },
      {
        type: "p",
        text: "A failed check returns `grant_missing`, `grant_expired`, `needs_reauth`, `confirmation_denied` or `rate_limited` in the standard [error shape](/docs/api-reference/errors). Only `rate_limited` is worth retrying.",
      },
      { type: "h2", text: "Confirmation" },
      {
        type: "p",
        text: "A context profile sets how each tier is confirmed: `none`, `on_device`, `trusted_surface` or `deny`. T4 can never be `none`, and a T4 grant on the consent screen only records the user's consent; it never removes the confirmation. When a tier needs confirmation, the call returns the status `needs_confirmation` and the action does not run. Approving it from the device or a trusted surface is not available yet, so today a T4 action never runs.",
      },
      { type: "h2", text: "Audit and revoke" },
      {
        type: "p",
        text: "Every call is logged with the key's project, the device and profile it used, the routing decision, the outcome and its latency. Revoking a connection from the API takes effect on the next call.",
      },
    ],
  },
];
