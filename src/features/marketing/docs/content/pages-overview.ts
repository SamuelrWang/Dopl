import type { DocPage } from "./types";

export const OVERVIEW_PAGES: DocPage[] = [
  {
    slug: "start-here",
    tab: "about",
    group: "Overview",
    title: "Start here",
    description: "Explore common use cases and integrate Dopl immediately",
    status: "live",
    blocks: [
      { type: "h2", text: "Let your agent connect Dopl" },
      { type: "p", text: "Copy this instruction into your agent:" },
      {
        type: "prompt",
        text:
          "Connect yourself to Dopl's hosted MCP server at `https://www.usedopl.com/api/mcp`. Guide me through " +
          "signing in with OAuth, then verify the connection by calling `dopl_get_map`.",
      },
      { type: "p", text: "Or follow the steps below to set it up yourself." },
      { type: "h2", text: "Common use cases" },
      {
        type: "cards",
        items: [
          {
            icon: "show",
            title: "Show on a device",
            description: "Put a card, list or status on your user's screen",
            href: "use-cases/show",
          },
          {
            icon: "ask",
            title: "Ask and get an answer",
            description: "Your agent asks a question and gets the user's pick back",
            href: "use-cases/ask",
          },
          {
            icon: "notify",
            title: "Notify",
            description: "Tap your user on the shoulder",
            href: "use-cases/notify",
          },
          {
            icon: "connect",
            title: "Connect your users' devices",
            description: "Planned: let your users link their hardware to your agent",
            href: "use-cases/connect-devices",
          },
          {
            icon: "route",
            title: "Route to the right device",
            description: "Planned: Dopl picks the device your user is on right now",
            href: "use-cases/routing",
          },
          {
            icon: "glasses",
            title: "Devices",
            description: "Every supported device and where it stands",
            href: "devices/even-realities-g2",
          },
        ],
      },
      { type: "h2", text: "Using Dopl" },
      {
        type: "steps",
        items: [
          {
            title: "Sign up",
            blocks: [
              {
                type: "p",
                text: "Sign up at [usedopl.com/signup](/signup) and complete onboarding in the [dashboard](/).",
              },
            ],
          },
          {
            title: "Connect an agent to Dopl",
            blocks: [
              {
                type: "p",
                text: "If an MCP host operates Dopl for you, connect it to the hosted MCP server at `https://www.usedopl.com/api/mcp`. Pick your tool:",
              },
              { type: "connect" },
              {
                type: "p",
                text: "Using a host that is not listed? Any MCP-aware host with remote-server OAuth works.",
              },
            ],
          },
          {
            title: "Or build with Dopl",
            blocks: [
              {
                type: "p",
                text: "The Device SDK, for software that uses Dopl from a backend, a SaaS product, an agent runtime or a CI script, is in development. It adds project API keys, a REST API, typed SDKs and a Connect widget your users open from your product.",
              },
              {
                type: "p",
                text: "The [API reference](/docs/api-reference) describes its planned contract. Until it ships, connect through the hosted MCP server above.",
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
    group: "Overview",
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
        text: "Project secret keys that are stored hashed and can be rotated, scoped grants that expire, and confirmation for physical actions enforced outside the model.",
      },
      { type: "h2", text: "Reporting" },
      { type: "p", text: "Found a vulnerability? Email [security@usedopl.com](mailto:security@usedopl.com)." },
    ],
  },
  {
    slug: "pricing",
    tab: "about",
    group: "Overview",
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
