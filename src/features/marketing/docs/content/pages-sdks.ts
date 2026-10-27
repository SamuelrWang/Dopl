import { PLANNED } from "./shared";
import type { DocPage } from "./types";

/**
 * SDKs and MCP, then the Changelog. ⚠ The hosted MCP server is the one LIVE interface (this page
 * was `start-here` until B2; that slug redirects to `overview`). The TypeScript SDK and the
 * project MCP server are A7 work: `coming_soon`, with no install commands until they ship.
 */
export const SDK_PAGES: DocPage[] = [
  {
    slug: "sdks/hosted-mcp",
    tab: "sdks",
    group: "MCP",
    title: "Hosted MCP",
    description: "Connect any MCP host to Dopl and reach paired glasses today",
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
                text: "Connect your MCP host to the hosted MCP server at `https://www.usedopl.com/api/mcp`. Pick your tool:",
              },
              { type: "connect" },
              {
                type: "p",
                text: "Using a host that is not listed? Any MCP-aware host with remote-server OAuth works.",
              },
            ],
          },
          {
            title: "Pair glasses",
            blocks: [
              {
                type: "p",
                text: "Once you pair [Even Realities G2 glasses](/docs/devices/even-realities-g2), the glasses tools (`glasses_show`, `glasses_ask`, `glasses_notify` and the screen tools) appear on your connection.",
              },
            ],
          },
        ],
      },
      { type: "h2", text: "What your agent can do" },
      {
        type: "cards",
        items: [
          {
            icon: "show",
            title: "Show on a device",
            description: "Put a card, list or status on your user's glasses",
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
            icon: "glasses",
            title: "Even Realities G2",
            description: "What the glasses support and how they pair",
            href: "devices/even-realities-g2",
          },
        ],
      },
      { type: "h2", text: "Building a product on Dopl" },
      {
        type: "p",
        text: "This server acts for one signed in Dopl user. For software that reaches your own users' devices, the Device SDK adds project keys, a REST API, typed SDKs and a project MCP server; it is in development, and the [API reference](/docs/api-reference) describes its planned contract.",
      },
    ],
  },
  {
    slug: "sdks/typescript",
    tab: "sdks",
    group: "SDKs",
    title: "TypeScript SDK",
    description: "A typed client for the Device SDK API",
    status: "coming_soon",
    blocks: [
      PLANNED,
      {
        type: "p",
        text: "The TypeScript SDK will be a typed client for every route in the [API reference](/docs/api-reference), with the request and response types taken from the same contract. A Python SDK follows.",
      },
      { type: "h2", text: "Helpers" },
      {
        type: "p",
        text: "On top of [Deliver](/docs/api-reference/deliver), the SDK adds `show`, `ask` and `notify`, which call Deliver with the matching intent. They are methods, not separate routes, so the API keeps one way to deliver.",
      },
      { type: "h2", text: "Until it ships" },
      {
        type: "p",
        text: "Every guide shows the plain HTTP request, so you can call the API with `fetch` as soon as it is live, the way the [Quickstart](/docs/quickstart) does.",
      },
    ],
  },
  {
    slug: "sdks/project-mcp",
    tab: "sdks",
    group: "MCP",
    title: "Project MCP server",
    description: "Three tools that give an MCP agent your project's devices",
    status: "coming_soon",
    blocks: [
      PLANNED,
      {
        type: "p",
        text: "The project MCP server is scoped to one project key, so an agent connected to it acts for your product and your end users rather than for one Dopl account.",
      },
      {
        type: "table",
        columns: ["Tool", "What it does"],
        rows: [
          ["`deliver`", "Deliver by intent, routed by Dopl, like [Deliver](/docs/api-reference/deliver)"],
          ["`context`", "Read a user's device context and matched profile, like [Get context](/docs/api-reference/context)"],
          ["`actions`", "Run or read one capability on one device, like [Run a device action](/docs/api-reference/device-actions)"],
        ],
      },
      {
        type: "p",
        text: "Three tools instead of one per device or capability keeps the tool definitions small, so connecting Dopl costs your agent very little context. The server also adds the user's context to its tool results, so the agent always knows which device it is writing for.",
      },
      {
        type: "p",
        text: "The [hosted MCP server](/docs/sdks/hosted-mcp) for individual Dopl users stays as it is.",
      },
    ],
  },
];

export const CHANGELOG_PAGES: DocPage[] = [
  {
    slug: "changelog",
    tab: "changelog",
    group: "Product updates",
    title: "Changelog",
    description: "",
    status: "live",
    blocks: [
      {
        type: "changelog",
        entries: [
          {
            date: "October 27",
            title: "New docs structure",
            description:
              "An overview of how Dopl works, concept pages for the Device SDK, guides, a page per device with its capability matrix, and a full API reference. Every page says whether it is live, in beta or coming soon",
          },
          {
            date: "October 20",
            title: "Developer docs",
            description: "Start here, use cases, devices and the API reference",
          },
        ],
      },
    ],
  },
];
