import { DEVICE_ROWS } from "./pages-devices";
import type { DocTab } from "./types";

/**
 * The header tabs and each tab's sidebar. Order here IS the sidebar order and the
 * prev/next order. A row's status badge comes from its page's `status` (`index.ts ›
 * statusOf`), so labels never carry "(coming soon)" themselves. A slug removed from here keeps
 * working through a temporary redirect in `next.config.ts › redirects`.
 */
export const DOC_TABS: DocTab[] = [
  {
    id: "about",
    label: "Docs",
    slug: "overview",
    groups: [
      {
        title: "Get started",
        links: [
          { label: "Overview", slug: "overview" },
          { label: "Quickstart", slug: "quickstart" },
          { label: "Security", slug: "security" },
          { label: "Pricing", slug: "pricing" },
        ],
      },
      {
        title: "Concepts",
        links: [
          { label: "Projects, environments and keys", slug: "concepts/projects-and-keys" },
          { label: "End users and connections", slug: "concepts/users-and-connections" },
          { label: "Devices and capabilities", slug: "concepts/devices-and-capabilities" },
          { label: "Permissions and safety", slug: "concepts/permissions-and-safety" },
          { label: "Context profiles and routing", slug: "concepts/context-profiles-and-routing" },
          { label: "Displays", slug: "concepts/displays" },
          { label: "Events and analytics", slug: "concepts/events-and-analytics" },
        ],
      },
      {
        title: "Guides",
        links: [
          { label: "Connect a device", slug: "guides/connect-a-device" },
          { label: "Deliver a message", slug: "guides/deliver-a-message" },
          { label: "Customize the glasses profile", slug: "guides/customize-the-glasses-profile" },
          { label: "Build a custom display", slug: "guides/custom-display" },
          { label: "Handle answers", slug: "guides/handle-answers" },
          { label: "Test mode", slug: "guides/test-mode" },
        ],
      },
      {
        title: "Glasses today",
        links: [
          { label: "Show on a device", slug: "use-cases/show" },
          { label: "Ask and get an answer", slug: "use-cases/ask" },
          { label: "Notify", slug: "use-cases/notify" },
        ],
      },
      {
        title: "Devices",
        links: [
          { label: "All devices", slug: "devices" },
          ...DEVICE_ROWS.map((d) => ({ label: d.title, slug: `devices/${d.slug}` })),
        ],
      },
    ],
  },
  {
    id: "api",
    label: "API Reference",
    slug: "api-reference",
    groups: [
      {
        title: "Overview",
        links: [
          { label: "About the Dopl API", slug: "api-reference" },
          { label: "Errors", slug: "api-reference/errors" },
        ],
      },
      {
        title: "Connect",
        links: [
          { label: "Create a Connect session", slug: "api-reference/connect-sessions", method: "POST" },
          { label: "Exchange a public token", slug: "api-reference/connections-exchange", method: "POST" },
          { label: "List connections", slug: "api-reference/connections", method: "GET" },
          { label: "Revoke a connection", slug: "api-reference/revoke-connection", method: "DELETE" },
        ],
      },
      {
        title: "Context",
        links: [{ label: "Get context", slug: "api-reference/context", method: "GET" }],
      },
      {
        title: "Actions",
        links: [
          { label: "Deliver", slug: "api-reference/deliver", method: "POST" },
          { label: "Run a device action", slug: "api-reference/device-actions", method: "POST" },
          { label: "Get an action", slug: "api-reference/actions", method: "GET" },
        ],
      },
      {
        title: "Devices",
        links: [{ label: "Get a device", slug: "api-reference/devices", method: "GET" }],
      },
    ],
  },
  {
    id: "sdks",
    label: "SDKs and MCP",
    slug: "sdks/hosted-mcp",
    groups: [
      {
        title: "MCP",
        links: [
          { label: "Hosted MCP", slug: "sdks/hosted-mcp" },
          { label: "Project MCP server", slug: "sdks/project-mcp" },
        ],
      },
      {
        title: "SDKs",
        links: [{ label: "TypeScript", slug: "sdks/typescript" }],
      },
    ],
  },
  {
    id: "changelog",
    label: "Changelog",
    slug: "changelog",
    groups: [
      {
        title: "2026",
        links: [{ label: "October", slug: "changelog#october" }],
      },
    ],
  },
];
