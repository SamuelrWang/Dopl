import { PLANNED } from "./shared";
import type { DocBlock, DocPage } from "./types";

/**
 * Get started: Overview (the docs home), Quickstart, Security, Pricing. ⚠ Overview is `live`, so
 * it may only point readers at what works in production (the hosted MCP server and Even G2) and
 * must describe the Device SDK as coming soon; `content.test.ts` enforces the wording. The
 * Quickstart uses `@dopl/sdk` exactly as `packages/sdk/src/client.ts` implements it.
 */

const p = (text: string): DocBlock => ({ type: "p", text });
const ts = (code: string[]): DocBlock => ({ type: "code", tabs: [{ label: "TypeScript", code: code.join("\n") }] });

const QUICKSTART: DocBlock[] = [
  PLANNED,
  p(
    "This walkthrough connects a simulated device for one of your users and reaches it from your server with the TypeScript SDK. It uses a test key, so it needs no hardware and never touches live data."
  ),
  {
    type: "steps",
    items: [
      {
        title: "Get a test key and the SDK",
        blocks: [
          p(
            "Dopl issues your project's keys while the developer portal is being built. Test secret keys start with `sk_test_` and only ever touch test data, so keep yours on your server. `@dopl/sdk` is private during testing and is available to design partners on request from [sales@usedopl.com](mailto:sales@usedopl.com)."
          ),
          { type: "code", tabs: [{ label: ".env", code: "DOPL_SECRET_KEY=sk_test_…" }] },
          ts([
            `import { Dopl } from "@dopl/sdk";`,
            ``,
            `const dopl = new Dopl({ apiKey: process.env.DOPL_SECRET_KEY! });`,
          ]),
        ],
      },
      {
        title: "Create a Connect session",
        blocks: [
          p(
            "A Connect session is a short lived link for one of your users, identified by your own ID. List the scopes your agent needs and where the flow should send the user when it finishes."
          ),
          ts([
            `const session = await dopl.connectSessions.create({`,
            `  external_user_id: "usr_123",`,
            `  requested_scopes: ["present.*", "ask.*"],`,
            `  redirect_uri: "http://localhost:3000/connected",`,
            `});`,
            ``,
            `console.log(session.url); // https://www.usedopl.com/connect/ct_…`,
          ]),
        ],
      },
      {
        title: "Pair a simulated device",
        blocks: [
          p(
            "Open `session.url`. With a test key the hosted page lists a simulated device of every kind. Choose **Simulated glasses**, press **Continue** under the pairing code it shows, then approve the scopes, which are grouped by risk tier. The page returns to your `redirect_uri` with a `public_token` query parameter."
          ),
        ],
      },
      {
        title: "Exchange the token",
        blocks: [
          p("On your server, exchange the `public_token` for a durable connection. Each token works once, within 30 minutes."),
          ts([
            `const { connection_id, device } = await dopl.connections.exchange({ public_token });`,
            ``,
            `console.log(device.kind, device.model); // glasses simulated_glasses`,
          ]),
        ],
      },
      {
        title: "Notify, show and ask",
        blocks: [
          p(
            "Send by intent and leave the device to Dopl. Each helper is one call to Deliver, and the response says which device received it and why."
          ),
          ts([
            `const sent = await dopl.notify("usr_123", { text: "Your build finished in 4m 12s" });`,
            `console.log(sent.routed_to); // { device_id, kind: "glasses", reason: "fallback chain" }`,
            ``,
            `await dopl.show("usr_123", {`,
            `  blocks: [{ id: "title", type: "heading", text: "Deploy ready" }],`,
            `});`,
            ``,
            `const answer = await dopl.ask("usr_123", { question: "Ship it?", options: ["Yes", "No"] });`,
            `if (answer.status === "answered") console.log(answer.answer);`,
            `// { simulated: true, index: 0, label: "Yes" }`,
          ]),
          p(
            "A simulated device answers every question at once and always picks the first option, so tests are deterministic. A real user can take up to 200 seconds, and `ask` waits that long by default."
          ),
        ],
      },
      {
        title: "Read the action",
        blocks: [
          p("Every delivery is stored as an action. Read its status and result at any time with the `delivery_id`."),
          ts([
            `const action = await dopl.actions.get(sent.delivery_id);`,
            ``,
            `console.log(action.status, action.result); // done { simulated: true }`,
          ]),
          p(
            "Next, shape output per device with [Context profiles and routing](/docs/concepts/context-profiles-and-routing) and force failure states with [Test mode](/docs/guides/test-mode)."
          ),
        ],
      },
    ],
  },
];

export const OVERVIEW_PAGES: DocPage[] = [
  {
    slug: "overview",
    section: "core",
    group: "Get started",
    title: "Overview",
    description: "One integration that lets your agent reach your users on any device",
    status: "live",
    blocks: [
      p(
        "Dopl connects AI agents to the devices people actually use, starting with smart glasses and growing to phones, computers, the smart home, cars and robots. Your agent sends one request that says what it wants to do, and Dopl decides which of the user's devices should receive it, checks that the user allowed it, holds the output to that device's limits and returns the result."
      ),
      { type: "h2", text: "How it works" },
      {
        type: "flow",
        label: "A request from your agent to a device",
        items: [
          { title: "Your agent", detail: "Sends one intent, such as show, ask or notify" },
          { title: "Dopl cloud", detail: "Checks permissions, picks the device and applies its profile" },
          { title: "Adapters", detail: "Translate the request for each vendor and keep up with their changes" },
          { title: "Devices", detail: "Glasses, desktop and more, each with its own capabilities" },
        ],
      },
      p(
        "The cloud keeps device credentials in its own vault, so your agent only ever holds an opaque connection. Each device publishes the capabilities it supports, and every request is checked against what the user granted before an adapter carries it to the hardware."
      ),
      { type: "h2", text: "What Dopl handles" },
      {
        type: "list",
        items: [
          "**Connect.** Your users pair a device from a hosted page that carries your brand, and they never need a Dopl account.",
          "**Capabilities.** One action model across every device, so your agent calls `present.display` or `ask.choice` rather than a vendor API.",
          "**Permissions.** Users grant capabilities by risk tier, and the most sensitive actions are denied unless confirmed, by rules that run outside any model.",
          "**Context and routing.** Each device kind has a profile that tells your agent how to write for it, which can be customized per project, and Dopl routes each request to the right device.",
          "**Analytics.** Every call records which device it reached, why, and how it went.",
        ],
      },
      { type: "h2", text: "What works today" },
      p(
        "Agents reach Even Realities G2 glasses today through the [hosted MCP server](/docs/sdks/hosted-mcp): they can show cards, ask questions with options and send notifications on the lens. The Device SDK, which adds project keys, a REST API, a TypeScript SDK, a project MCP server and the Connect flow, is live for design partners: Dopl issues your project's keys while the developer portal is being built, and `@dopl/sdk` is available on request. Every page in these docs carries a label that says whether it is live, in beta or coming soon."
      ),
      {
        type: "cards",
        items: [
          {
            icon: "connect",
            title: "Hosted MCP",
            description: "Connect your agent and reach paired glasses today",
            href: "sdks/hosted-mcp",
          },
          {
            icon: "code",
            title: "Quickstart",
            description: "Reach a simulated device from TypeScript",
            href: "quickstart",
          },
          {
            icon: "route",
            title: "Context profiles and routing",
            description: "How Dopl picks a device and holds each reply to its limits",
            href: "concepts/context-profiles-and-routing",
          },
          {
            icon: "glasses",
            title: "Devices",
            description: "Every supported device, its capabilities and its status",
            href: "devices",
          },
        ],
      },
    ],
  },
  {
    slug: "quickstart",
    section: "quickstart",
    group: "Get started",
    title: "Quickstart",
    description: "Connect a simulated device and reach it from TypeScript in a few minutes",
    status: "beta",
    blocks: QUICKSTART,
  },
  {
    slug: "security",
    section: "security",
    group: "Get started",
    title: "Security",
    description: "How Dopl protects your users and their devices",
    status: "live",
    blocks: [
      { type: "h2", text: "Access" },
      {
        type: "list",
        items: [
          "Glasses pair only through a code their owner enters while signed in to Dopl, and the owner can unpair them at any time.",
          "Hosted MCP connections sign in with OAuth, and each connected agent app can be disconnected from Settings.",
          "The glasses tools appear only on connections belonging to a user who has paired glasses.",
        ],
      },
      { type: "h2", text: "Data" },
      {
        type: "list",
        items: [
          "Data is encrypted in transit with TLS and at rest by Dopl's database provider.",
          "Dopl does not use your content, or the inputs and output of your agents, to train models. See the [Privacy Policy](/privacy).",
        ],
      },
      { type: "h2", text: "Coming with the Device SDK" },
      p(
        "Project keys that are stored hashed, shown once and rotated with an overlap window; connections that hold only the scopes a user approved; safety critical actions denied unless confirmed; and an event for every call. [Permissions and safety](/docs/concepts/permissions-and-safety) describes how it works."
      ),
      { type: "h2", text: "Reporting" },
      p("Found a vulnerability? Email [security@usedopl.com](mailto:security@usedopl.com)."),
    ],
  },
  {
    slug: "pricing",
    section: "pricing",
    group: "Get started",
    title: "Pricing",
    description: "How the Device SDK will be priced",
    status: "coming_soon",
    blocks: [
      {
        type: "quote",
        text: "Device SDK pricing is not set yet. It will be published here before the SDK launches.",
      },
      p("Today, glasses tool calls through the hosted MCP server use Dopl credits from your plan, one credit per call."),
      { type: "h2", text: "Enterprise and white-label" },
      p("Interested in shipping Dopl under your own brand? Email [sales@usedopl.com](mailto:sales@usedopl.com)."),
    ],
  },
];
