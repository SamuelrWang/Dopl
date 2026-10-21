import type { DocPage } from "./types";

const SDK_EXAMPLE = `import { Dopl } from "@dopl/client"

const dopl = new Dopl({ apiKey })
await dopl.show(userId, blocks)
const answer = await dopl.ask(userId, { question, options })
await dopl.notify(userId, { text })`;

export const OVERVIEW_PAGES: DocPage[] = [
  {
    slug: "start-here",
    tab: "about",
    group: "Overview",
    title: "Start here",
    description: "Explore common use cases and integrate Dopl immediately",
    blocks: [
      { type: "h2", text: "Let your agent connect Dopl" },
      { type: "p", text: "Copy this instruction into your agent:" },
      {
        type: "prompt",
        text:
          "Connect yourself to Dopl by following [https://www.usedopl.com/skill.md](https://www.usedopl.com/skill.md). " +
          "Use [https://www.usedopl.com/llms.txt](https://www.usedopl.com/llms.txt) for documentation. Complete the setup " +
          "supported by this environment, guide me through required signup and authorization, then verify the " +
          "connection by listing my devices.",
      },
      { type: "p", text: "The platform-specific instructions below remain available for manual setup." },
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
            description: "Tap your user on the shoulder, wherever they are",
            href: "use-cases/notify",
          },
          {
            icon: "connect",
            title: "Connect your users' devices",
            description: "Let your users link their hardware to your agent",
            href: "use-cases/connect-devices",
          },
          {
            icon: "route",
            title: "Route to the right device",
            description: "Dopl picks the device your user is on right now",
            href: "use-cases/routing",
          },
          {
            icon: "glasses",
            title: "Devices",
            description: "Glasses, phone, Mac notch and desktop today",
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
                text: "You're writing software that uses Dopl: a backend, a SaaS, an agent runtime, a CI script.",
              },
              {
                type: "list",
                ordered: true,
                items: [
                  "Generate an API key from the Developers tab of the [dashboard](/). The key is shown once; store it in a secret manager and never commit it.",
                  {
                    text: "Install for your runtime:",
                    blocks: [
                      {
                        type: "code",
                        tabs: [
                          { label: "TypeScript", code: "npm install @dopl/client" },
                          { label: "Python", code: "pip install dopl" },
                          { label: "CLI", code: "npm install -g @dopl/cli" },
                        ],
                      },
                    ],
                  },
                  {
                    text: "Show, ask and notify:",
                    blocks: [{ type: "code", tabs: [{ label: "TypeScript", code: SDK_EXAMPLE }] }],
                  },
                  "No SDK for your language? Use the [REST API](/docs/api-reference) at `api.usedopl.com` with the same key.",
                ],
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
    blocks: [
      { type: "h2", text: "Access" },
      {
        type: "list",
        items: [
          "Every device link is approved by its owner. An agent never reaches a device the user did not connect.",
          "API keys are shown once, scoped to one project, and revocable from the dashboard.",
          "Hosted MCP connections sign in with OAuth; tokens can be revoked per agent.",
        ],
      },
      { type: "h2", text: "Data" },
      {
        type: "list",
        items: [
          "Content is encrypted in transit (TLS 1.2+) and at rest.",
          "Dopl stores what it needs to deliver and answer an intent, and nothing it renders is used to train models.",
          "Answers go back only to the agent that asked.",
        ],
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
    description: "Pay per connected user, per month",
    blocks: [
      { type: "h2", text: "Plans" },
      {
        type: "table",
        columns: ["Plan", "Price", "Includes"],
        rows: [
          ["Free", "$0", "Up to 10 connected users"],
          ["Usage", "$0.50 per connected user / month", "Every device, unlimited intents"],
          ["Enterprise", "Contact us", "White-label device apps, SSO, SLA"],
        ],
      },
      {
        type: "p",
        text: "A connected user is an end user with at least one linked device during the month. Placeholder pricing — final numbers to come.",
      },
      { type: "h2", text: "Enterprise and white-label" },
      {
        type: "p",
        text: "Ship Dopl's device apps under your own brand. Email [sales@usedopl.com](mailto:sales@usedopl.com).",
      },
    ],
  },
];
