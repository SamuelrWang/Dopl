import { PROJECT_MCP, TYPESCRIPT_SDK } from "./pages-sdk-client";
import type { DocPage } from "./types";

/**
 * SDKs and MCP, then the Changelog. ⚠ The hosted MCP server is the one LIVE interface (this page
 * was `start-here` until B2; that slug redirects to `overview`). The TypeScript SDK and the
 * project MCP server are A7 work: `coming_soon`, with no install commands until they ship.
 */
export const SDK_PAGES: DocPage[] = [
  {
    slug: "sdks/hosted-mcp",
    section: "sdks",
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
                text: "Once you pair [Even Realities G2 glasses](/docs/devices/display-glasses), the glasses tools (`glasses_show`, `glasses_ask`, `glasses_notify` and the screen tools) appear on your connection.",
              },
            ],
          },
        ],
      },
      { type: "h2", text: "What your agent can do" },
      {
        type: "p",
        text: "With paired glasses, `glasses_show`, `glasses_ask` and `glasses_notify` show cards, ask questions and send notifications on the lens, and `glasses_update` changes a card in place. [Display glasses](/docs/devices/display-glasses) lists each capability with its limits.",
      },
      { type: "h2", text: "Building a product on Dopl" },
      {
        type: "p",
        text: "This server acts for one signed in Dopl user. For software that reaches your own users' devices, the Device SDK adds project keys, a REST API, a TypeScript SDK and a project MCP server. It is live for design partners: Dopl issues your project's keys while the developer portal is being built, and `@dopl/sdk` is available on request, and the [API reference](/docs/api-reference) describes it.",
      },
    ],
  },
  {
    slug: "sdks/typescript",
    section: "sdks",
    group: "SDKs",
    title: "TypeScript SDK",
    description: "A typed client for the Device SDK API, with show, ask and notify helpers",
    status: "beta",
    blocks: TYPESCRIPT_SDK,
  },
  {
    slug: "sdks/project-mcp",
    section: "sdks",
    group: "MCP",
    title: "Project MCP server",
    description: "Three tools that give an MCP agent your project's users and devices",
    status: "beta",
    blocks: PROJECT_MCP,
  },
];

export const CHANGELOG_PAGES: DocPage[] = [
  {
    slug: "changelog",
    section: "changelog",
    group: "Product updates",
    title: "Changelog",
    description: "",
    status: "live",
    blocks: [
      {
        type: "changelog",
        entries: [
          {
            date: "October 28",
            title: "Request log API, playground, usage and webhooks",
            description:
              "Read your request log with [List events](/docs/api-reference/events), scope `analytics:read`. Every list pages with `cursor` and `limit` and returns `data`, `next_cursor` and `has_more`. The developer portal adds a playground that runs calls with your test key, and usage charts. The API reference is now generated from the OpenAPI spec. Asks can skip the 200 second hold: send `Prefer: respond-async` on deliver or a device action, then read the answer with `GET /v1/actions/{id}` or the `action.completed` webhook. Webhooks now send: register endpoints with [Create a webhook endpoint](/docs/api-reference/webhook-endpoints-create); events are signed (Standard Webhooks), retried for about a day, and replayable. Endpoints use port 443 or 8443, and a try with no answer is logged only as a class such as `timeout`",
          },
          {
            date: "October 27",
            title: "Device categories",
            description:
              "Devices are organised by what they can do: [display glasses](/docs/devices/display-glasses), [smart home](/docs/devices/smart-home) and five more categories. Each lists what your agent receives and what it can send, one capability per card, with model support. Shared setup moved to Core, and the Device SDK API is in beta for design partners",
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
