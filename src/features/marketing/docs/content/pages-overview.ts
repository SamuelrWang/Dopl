import { API, PLANNED } from "./shared";
import type { DocPage } from "./types";

/**
 * Get started: Overview (the docs home), Quickstart, Security, Pricing. ⚠ Overview is `live`, so
 * it may only point readers at what works in production (the hosted MCP server and Even G2) and
 * must describe the Device SDK as planned; `content.test.ts` enforces the wording.
 */
export const OVERVIEW_PAGES: DocPage[] = [
  {
    slug: "overview",
    tab: "about",
    group: "Get started",
    title: "Overview",
    description: "One integration that lets your agent reach your users on any device",
    status: "live",
    blocks: [
      {
        type: "p",
        text: "Dopl connects AI agents to the devices people actually use, starting with smart glasses and growing to phones, computers, the smart home, cars and robots. Your agent sends one request that says what it wants to do, and Dopl decides which of the user's devices should receive it, shapes the output to fit that device and returns the result.",
      },
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
      {
        type: "p",
        text: "The cloud keeps device credentials in its own vault, so your agent only ever holds an opaque connection. Each device publishes the capabilities it supports, and every request is checked against what the user granted before an adapter carries it to the hardware.",
      },
      { type: "h2", text: "What Dopl handles" },
      {
        type: "list",
        items: [
          "**Connect.** Your users pair a device from a flow that carries your brand, and they never need a Dopl account.",
          "**Capabilities.** One action model across every device, so your agent calls `present.display` or `ask.choice` rather than a vendor API.",
          "**Permissions.** Grants are scoped by risk tier and can expire, and physical actions need confirmation enforced outside the model.",
          "**Context and routing.** Each device kind has a profile that tells your agent how to write for it, which you can override, and Dopl routes each request to the right device.",
          "**Analytics.** Every call records which device it reached, why, and how it went.",
        ],
      },
      { type: "h2", text: "What works today" },
      {
        type: "p",
        text: "Agents reach Even Realities G2 glasses today through the [hosted MCP server](/docs/sdks/hosted-mcp): they can show cards, ask questions with options and send notifications on the lens. The Device SDK, which adds project keys, a REST API, typed SDKs and the Connect flow, is in development. Every page in these docs carries a label that says whether it is live, in beta or coming soon.",
      },
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
            description: "Deliver to a simulated device from TypeScript",
            href: "quickstart",
          },
          {
            icon: "route",
            title: "Context profiles and routing",
            description: "How Dopl adapts each reply to the device it lands on",
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
    tab: "about",
    group: "Get started",
    title: "Quickstart",
    description: "Deliver your first message to a simulated device in a few minutes",
    status: "coming_soon",
    blocks: [
      PLANNED,
      {
        type: "p",
        text: "This walkthrough uses a test secret key and a simulated device, so you need no hardware. The examples call the REST API with `fetch`; the typed TypeScript SDK will wrap the same requests.",
      },
      {
        type: "steps",
        items: [
          {
            title: "Create a test key",
            blocks: [
              {
                type: "p",
                text: "Create a project and copy its test secret key. Test keys start with `sk_test_` and only ever touch test data. Keep the key on your server.",
              },
              { type: "code", tabs: [{ label: ".env", code: "DOPL_SECRET_KEY=sk_test_…" }] },
            ],
          },
          {
            title: "Connect a simulated device",
            blocks: [
              {
                type: "p",
                text: "Create a Connect session for one of your users and open the returned `url`. In test mode the Connect flow offers simulated devices of every kind, so you can pair one without hardware.",
              },
              {
                type: "code",
                tabs: [
                  {
                    label: "TypeScript",
                    code: [
                      `const headers = {`,
                      `  Authorization: \`Bearer \${process.env.DOPL_SECRET_KEY}\`,`,
                      `  "Content-Type": "application/json",`,
                      `};`,
                      ``,
                      `const session = await fetch("${API}/connect_sessions", {`,
                      `  method: "POST",`,
                      `  headers,`,
                      `  body: JSON.stringify({`,
                      `    external_user_id: "usr_123",`,
                      `    requested_scopes: ["present.*", "ask.*"],`,
                      `  }),`,
                      `}).then((r) => r.json());`,
                      ``,
                      `console.log(session.url); // open this and pick a simulated device`,
                    ].join("\n"),
                  },
                ],
              },
            ],
          },
          {
            title: "Deliver a message",
            blocks: [
              {
                type: "p",
                text: "Send by intent and leave the target to Dopl. The response says which device received it and why.",
              },
              {
                type: "code",
                tabs: [
                  {
                    label: "TypeScript",
                    code: [
                      `const delivery = await fetch("${API}/users/usr_123/deliver", {`,
                      `  method: "POST",`,
                      `  headers,`,
                      `  body: JSON.stringify({`,
                      `    intent: "message",`,
                      `    content: { text: "Your build finished in 4m 12s" },`,
                      `    urgency: "normal",`,
                      `    target: "auto",`,
                      `    idempotency_key: crypto.randomUUID(),`,
                      `  }),`,
                      `}).then((r) => r.json());`,
                      ``,
                      `console.log(delivery.routed_to); // { device_id, kind, reason }`,
                    ].join("\n"),
                  },
                ],
              },
            ],
          },
          {
            title: "Go further",
            blocks: [
              {
                type: "p",
                text: "Ask a question and handle the answer with [Handle answers](/docs/guides/handle-answers), shape the output per device with [Context profiles and routing](/docs/concepts/context-profiles-and-routing), and force failure states with [Test mode](/docs/guides/test-mode).",
              },
            ],
          },
        ],
      },
    ],
  },
  {
    slug: "security",
    tab: "about",
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
      { type: "h2", text: "Planned for the Device SDK" },
      {
        type: "p",
        text: "Project secret keys that are stored hashed and can be rotated, scoped grants that expire, and confirmation for physical actions enforced outside the model. [Permissions and safety](/docs/concepts/permissions-and-safety) describes the design.",
      },
      { type: "h2", text: "Reporting" },
      { type: "p", text: "Found a vulnerability? Email [security@usedopl.com](mailto:security@usedopl.com)." },
    ],
  },
  {
    slug: "pricing",
    tab: "about",
    group: "Get started",
    title: "Pricing",
    description: "How the Device SDK will be priced",
    status: "coming_soon",
    blocks: [
      {
        type: "quote",
        text: "Device SDK pricing is not set yet. It will be published here before the SDK launches.",
      },
      {
        type: "p",
        text: "Today, glasses tool calls through the hosted MCP server use Dopl credits from your plan, one credit per call.",
      },
      { type: "h2", text: "Enterprise and white-label" },
      {
        type: "p",
        text: "Interested in shipping Dopl under your own brand? Email [sales@usedopl.com](mailto:sales@usedopl.com).",
      },
    ],
  },
];
