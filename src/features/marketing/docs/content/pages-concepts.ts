import { json, PLANNED } from "./shared";
import type { DocPage } from "./types";

/**
 * Concepts, first half: projects and keys (C1), end users and connections (C2), devices and
 * capabilities (C3), permissions and safety (C7). ⚠ Every value here mirrors
 * `@dopl/contracts/device-sdk`; `content.test.ts` checks the capability tiers against
 * `CAPABILITY_RISK_TIER`. All `coming_soon`: none of it is deployed.
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

/** C7 tier defaults (`capabilities.ts › RISK_TIER_DEFAULT_POLICY`), in reader terms. */
export const TIER_ROWS: string[][] = [
  ["T0", "Read state", "Allowed"],
  ["T1", "Display, notify, speak, ask", "Allowed"],
  ["T2", "Camera or microphone capture", "Only with an explicit grant, and the device must show bystanders that it is capturing"],
  ["T3", "Lights, media, navigation", "Allowed, with confirmation you can require"],
  ["T4", "Locks, vehicle and robot motion", "Confirmed on every call, with hard limits and a safe stop if the connection drops"],
];

export const CONCEPT_PAGES: DocPage[] = [
  {
    slug: "concepts/projects-and-keys",
    tab: "about",
    group: "Concepts",
    title: "Projects, environments and keys",
    description: "How your organization, projects, test and live data, and API keys fit together",
    status: "coming_soon",
    blocks: [
      PLANNED,
      {
        type: "p",
        text: "Your company is an organization in Dopl, and each product you build is a project inside it. A project holds everything the API touches: its keys, its context profiles and display templates, its webhook endpoints and its end users.",
      },
      { type: "h2", text: "Environments" },
      {
        type: "p",
        text: "Every project has a `test` and a `live` environment with separate keys, data and webhooks. Test data never reaches live, so you can build against simulated devices and switch to real ones by changing the key.",
      },
      { type: "h2", text: "API keys" },
      {
        type: "table",
        columns: ["Key", "Where it is used", "What it can do"],
        rows: [
          ["`sk_test_…` and `sk_live_…`", "Your server only", "Every route your key scopes allow"],
          ["`pk_…`", "Your web or mobile app", "Only create Connect sessions"],
        ],
      },
      {
        type: "p",
        text: "Send a secret key as `Authorization: Bearer <key>`. Dopl stores keys hashed, so a key is shown once when you create it, and rotating a key keeps the old one valid for an overlap window so you can deploy without downtime.",
      },
      { type: "h3", text: "Scopes" },
      {
        type: "p",
        text: "Each key carries coarse scopes: `connect`, `devices:read`, `actions:write` and `analytics:read`. A call outside its key's scopes fails with `insufficient_scope`.",
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
    tab: "about",
    group: "Concepts",
    title: "End users and connections",
    description: "Your users stay yours, and each device they link becomes a connection",
    status: "coming_soon",
    blocks: [
      PLANNED,
      {
        type: "p",
        text: "An end user is one of your users, identified by your own ID as `external_user_id`. End users never sign up with Dopl; they belong to your app, the way a bank customer never signs up with the service that links their account.",
      },
      { type: "h2", text: "Connections" },
      {
        type: "p",
        text: "A connection is one user's grant to one device. Your agent holds the opaque `connection_id`, while the device credentials stay in the Dopl vault and never reach your servers or your agent.",
      },
      {
        type: "table",
        columns: ["Status", "Meaning"],
        rows: [
          ["`active`", "The device is reachable within the granted scopes"],
          ["`needs_reauth`", "The vendor needs the user to sign in again before Dopl can reach the device"],
          ["`revoked`", "You or the user revoked it, and nothing reaches the device"],
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
          "Your server creates a Connect session for the user with the scopes your agent needs.",
          "The user opens the Connect flow, which carries your name, logo and accent color, and sees which capabilities their exact device supports.",
          "They pair the device the way that device pairs: a code for glasses, the vendor's sign in for cloud devices, or a local claim for a home hub.",
          "They approve the requested scopes, shown by risk tier, and the flow returns a `public_token` to your app.",
          "Your server exchanges the `public_token` for a `connection_id`.",
        ],
      },
      {
        type: "p",
        text: "[Connect a device](/docs/guides/connect-a-device) walks through it with code. You can revoke a connection at any time, and users will be able to revoke from a page Dopl hosts for them.",
      },
      { type: "h2", text: "Webhooks" },
      {
        type: "p",
        text: "Connections emit `connection.created`, `connection.revoked` and `connection.needs_reauth`, and their devices emit `device.online` and `device.offline`.",
      },
    ],
  },
  {
    slug: "concepts/devices-and-capabilities",
    tab: "about",
    group: "Concepts",
    title: "Devices and capabilities",
    description: "One action model for every device, sorted by risk",
    status: "coming_soon",
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
        text: "A scope can name one capability or a whole family, such as `present.*` or `act.motion.*`. The tiers decide what needs a grant or a confirmation; [Permissions and safety](/docs/concepts/permissions-and-safety) has the rules.",
      },
      { type: "h2", text: "Descriptors" },
      {
        type: "p",
        text: "A descriptor states a capability's limits on that exact device, how fast it answers (`realtime`, `interactive` or `deferred`), its risk tier and the adapter version that added it. This is the Even Realities G2's display:",
      },
      {
        type: "code",
        tabs: [
          {
            label: "present.display",
            code: json({
              capability: "present.display",
              limits: {
                width_px: 576,
                height_px: 248,
                max_blocks: 12,
                max_text_bytes: 960,
                charset: "ascii+box",
                color: "mono",
              },
              latency_class: "interactive",
              risk_tier: "T1",
              since_adapter: "even_g2@0.1.0",
            }),
          },
        ],
      },
      {
        type: "p",
        text: "The Connect flow shows these descriptors to the user before they pair, and a request outside them fails with `capability_unsupported` or `invalid_request` rather than reaching the device. Each [device page](/docs/devices) lists its capability matrix.",
      },
    ],
  },
  {
    slug: "concepts/permissions-and-safety",
    tab: "about",
    group: "Concepts",
    title: "Permissions and safety",
    description: "Scoped grants, risk tiers and confirmation that the model cannot skip",
    status: "coming_soon",
    blocks: [
      PLANNED,
      {
        type: "p",
        text: "Permissions work in three layers. Your project requests capability scopes, the end user grants them per connection on the consent screen, and a policy engine checks every call. The policy engine runs outside any model, so a prompt cannot talk its way past it.",
      },
      { type: "h2", text: "Risk tiers" },
      { type: "table", columns: ["Tier", "Examples", "Default"], rows: TIER_ROWS },
      { type: "h2", text: "What the policy engine checks" },
      {
        type: "list",
        items: [
          "The connection holds a grant for the capability, and the grant has not expired.",
          "The capability's tier is allowed for this project and this profile.",
          "The call fits the project's rate and budget limits.",
          "Any confirmation the tier requires has been given.",
        ],
      },
      {
        type: "p",
        text: "A failed check returns one of `grant_missing`, `grant_expired`, `confirmation_denied` or `rate_limited` in the standard [error shape](/docs/api-reference/errors).",
      },
      { type: "h2", text: "Expiring grants" },
      {
        type: "p",
        text: "A grant can carry an expiry, so access your agent needed for one trip or one task lapses on its own. After expiry the call fails with `grant_expired` until the user grants it again.",
      },
      { type: "h2", text: "Confirmation" },
      {
        type: "p",
        text: "A context profile sets how each tier is confirmed: `none`, `on_device`, `trusted_surface` or `deny`. T4 can never be `none`. A T4 action first returns the status `needs_confirmation` and only runs once the user approves it.",
      },
      { type: "h2", text: "Audit and revoke" },
      {
        type: "p",
        text: "Every call is logged with who made it, what it did, which device and grant it used, and the outcome. You can revoke a connection from the API instantly, and users will be able to revoke from a page Dopl hosts for them.",
      },
    ],
  },
];
