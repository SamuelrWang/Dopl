/**
 * Copy for the Dopl Devices SDK landing page (`/devices`).
 *
 * Source: Dopl KB `dopl-development` › "SDK Split/Plans/Dopl Devices SDK - Landing Page Outline".
 * Every `heading` and `line` is VERBATIM from that outline, sections 1 to 12, in its order. Tile
 * titles follow the outline's bullets; tile bodies are one plain sentence each.
 *
 * ⚠ Page rules (outline): the page reads as a complete production platform, so no BUILT/ROADMAP
 * tags are rendered; no invented stats or numbers; no logos, quotes or testimonials; no em or en
 * dashes anywhere in this file's strings (the page test checks).
 */

/** "Get a key" opens the portal's key page; a signed-out visitor is bounced through sign-in and
 *  lands back on it (the proxy carries `redirectTo`). */
export const GET_KEY_HREF = "/developers/keys";
/** Bare `/docs` is a `next.config.ts` redirect to the docs home. */
export const DOCS_HREF = "/docs";
export const PRICING_HREF = "/pricing";

export const INSTALL_COMMAND = "npm install @dopl/devices";

export const CTA = { key: "Get a key", docs: "Read the docs" } as const;

export const HERO = {
  eyebrow: "Dopl Devices SDK",
  heading: "One SDK. Every device your users wear, carry or live with.",
  line: "Send a message, ask a question or run an action. Dopl picks the right device and tells you why.",
} as const;

export const PROBLEM = {
  eyebrow: "The problem",
  heading: "Every device speaks a different language.",
  line: "Glasses, phones, watches and speakers each need their own pairing, auth and delivery code. You should write it once.",
  beforeTitle: "Without Dopl",
  beforeRows: [
    { device: "Glasses", parts: ["Pairing", "Auth", "Delivery"] },
    { device: "Phone", parts: ["Pairing", "Auth", "Delivery"] },
    { device: "Watch", parts: ["Pairing", "Auth", "Delivery"] },
    { device: "Speaker", parts: ["Pairing", "Auth", "Delivery"] },
  ],
  afterTitle: "With Dopl",
  afterNote: "One call. Dopl handles pairing, auth and delivery for every device.",
} as const;

export const VERBS = {
  eyebrow: "What Dopl Devices does",
  heading: "Deliver, ask, act.",
  line: "Say what you mean. Dopl reads the user's context and routes it to the device that fits right now.",
  tiles: [
    {
      title: "Deliver",
      body: "Deliver by intent. Dopl routes to a device automatically and returns the reason it chose that one.",
      call: "dopl.users.deliver()",
    },
    {
      title: "Ask",
      body: "Ask a question on the user's device and get their answer back in the same round trip.",
      call: "dopl.ask()",
    },
    {
      title: "Act",
      body: "Run a device action by capability, so your code never depends on which hardware is on the other end.",
      call: "dopl.devices.action()",
    },
  ],
} as const;

export const GUIDANCE = {
  eyebrow: "Device guidance",
  heading: "Route to the person. Guide the agent before it writes.",
  line: "Dopl finds the device your user is on and hands your agent the rules for it. Change the rules for your app, for each user, or for one message, and preview before you ship.",
  panels: {
    route: {
      title: "Route to the person, not the device",
      body: "Dopl picks the device the user is on now and returns why, on every delivery.",
    },
    guide: {
      title: "Guidance before the agent writes",
      body: "Each device kind has rules for prompt, length, format, allowed actions and confirmation.",
    },
    layers: {
      title: "Layered customization",
      body: "Start from the Dopl default, then set rules for your project, each user and a single message.",
    },
  },
  /** Real router output (`delivery/router.ts`) and the real glasses default profile
   *  (`delivery/default-profiles.ts`). Config values, not stats. */
  routeReason: "most recently active eligible device",
  guideRows: [
    ["format", "\"plain\""],
    ["max_lines", "5"],
    ["max_chars", "300"],
    ["overflow", "send_to: \"phone\""],
  ],
  /** The same reply, rendered for three surfaces. */
  reply: "Build passed. Deploy to production?",
  surfaces: ["Glasses", "Phone", "Desktop"],
  layers: ["Dopl default", "Your project", "Each user", "This message"],
} as const;

export const HOW = {
  eyebrow: "How it works",
  heading: "Connect once. Deliver anywhere.",
  line: "Your users pair their devices on a page we host. You call one API from then on.",
  steps: [
    {
      title: "Connect",
      body: "Your user pairs devices and grants scopes on the hosted Connect page, with a clear consent screen.",
    },
    {
      title: "Context",
      body: "Read where the user is, which devices are reachable, and the device guidance for each.",
    },
    {
      title: "Deliver",
      body: "Make one call. Dopl routes it, and a webhook tells you what happened.",
    },
  ],
} as const;

export const CODE = {
  eyebrow: "Code",
  heading: "Ten lines to your first delivery.",
  line: "Typed client, helpers for show, notify and ask, and a simulator so you need no hardware to start.",
  simulatorNote: "The simulator includes device ids that force failures, so you can test your error handling.",
} as const;

export const PRODUCTION = {
  eyebrow: "Built for production",
  heading: "The hard parts are already done.",
  line: "Retries that never double send, errors you can act on, and events you can trust.",
  tiles: [
    { title: "Idempotency keys", body: "Every write takes an idempotency key, so a retry returns the first result instead of sending twice." },
    { title: "Typed errors", body: "Every error carries a code, whether it is retryable, a doc link and the request id." },
    { title: "Webhooks", body: "Events are signed to the Standard Webhooks spec and retried until your endpoint accepts them." },
    { title: "Events and logs API", body: "Read every delivery, action and routing decision through the API." },
    { title: "Runs everywhere", body: "Node, Deno, Bun, edge and the browser, with publishable keys limited to Connect." },
    { title: "MCP server", body: "Give your agents an MCP server so they can deliver and ask on their own." },
    { title: "CLI", body: "Log in, tail your logs and trigger test events from the terminal." },
  ],
} as const;

export const COVERAGE = {
  eyebrow: "Device coverage",
  heading: "One API across device kinds.",
  line: "Add a new kind of device and your code does not change.",
  kinds: [
    { id: "glasses", title: "Smart glasses" },
    { id: "phone", title: "Phones" },
    { id: "watch", title: "Wearables and watches" },
    { id: "home", title: "Smart home and speakers" },
    { id: "desktop", title: "Desktop" },
  ],
} as const;

export const PORTAL = {
  eyebrow: "Developer portal",
  heading: "See every request, every device, every reply.",
  line: "Keys, logs, usage and a live playground in one place.",
  tiles: [
    { title: "Keys", body: "Test and live keys, scoped keys, and publishable keys for Connect.", sample: ["sk_test_…", "sk_live_…", "pk_…"] },
    { title: "Request logs", body: "Every request with its status, device and routing reason.", sample: ["POST /users/{id}/deliver", "GET /users/{id}/context"] },
    { title: "Usage", body: "See how your project uses the API in test and live mode." },
    { title: "Playground", body: "Send a delivery to a simulated device and preview the device guidance." },
    { title: "Orgs, teams and roles", body: "Invite your team and decide who can see keys and logs." },
  ],
} as const;

export const TRUST = {
  eyebrow: "Trust and security",
  heading: "Your users stay in control.",
  line: "Every device connection is consented, scoped and revocable. Every webhook is signed.",
  items: [
    "Keys are never logged, and secret keys are kept apart from publishable keys.",
    "Every device connection has its own user consent and can be revoked.",
    "Every webhook is signed.",
    "The client is open source under Apache-2.0.",
    "A hosted global API with regions and a public status page.",
    "A compliance page that sets out our security posture.",
  ],
} as const;

export const PRICING = {
  eyebrow: "Pricing",
  heading: "Free to build. Pay when you ship.",
  line: "Test mode costs nothing. See plans for live usage.",
  link: "See plans",
} as const;

export const SUPPORT = {
  eyebrow: "Support",
  heading: "Help when you need it.",
  items: [
    { title: "Docs", body: "Guides, concepts and the full API reference.", href: DOCS_HREF },
    { title: "GitHub issues", body: "Report a bug or ask for a feature in the open." },
    { title: "Email support", body: "Write to the team that builds the SDK." },
    { title: "Community", body: "Talk with other developers building on Dopl." },
  ],
} as const;

export const GET_STARTED = {
  heading: "Start in test mode in minutes.",
  line: "No hardware, no card. Just a test key and the simulator.",
} as const;
