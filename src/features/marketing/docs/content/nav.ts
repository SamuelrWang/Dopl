import { CATEGORY_ROWS } from "./pages-categories";
import type { DocSection } from "./types";

/**
 * The sidebar. On the docs home it lists every section — `item` sections as one row each,
 * `group` sections as a heading with their pages beneath. On any other page it swaps to that
 * page's section alone, under an "All docs" back link. Order here IS the sidebar order.
 *
 * Devices are organised by CATEGORY (a capability group such as display glasses or smart home),
 * never by brand: models live inside their category page. Core holds what every category shares
 * (keys, connecting users, permissions, routing, events, test mode) and category pages link to
 * it instead of repeating it. A row's status badge comes from its page's `status`, so labels never
 * carry "(coming soon)" themselves. A slug removed from here keeps working through a temporary
 * redirect in `next.config.ts › redirects`.
 */
export const DOC_SECTIONS: DocSection[] = [
  {
    id: "quickstart",
    title: "Quickstart",
    home: "item",
    groups: [{ links: [{ label: "Quickstart", slug: "quickstart" }] }],
  },
  {
    id: "devices",
    title: "Devices",
    home: "group",
    groups: [
      {
        links: [
          { label: "All device categories", slug: "devices" },
          ...CATEGORY_ROWS.map((c) => ({ label: c.title, slug: `devices/${c.slug}` })),
        ],
      },
    ],
  },
  {
    id: "core",
    title: "Core",
    home: "group",
    groups: [
      {
        title: "Set up",
        links: [
          { label: "Overview", slug: "overview" },
          { label: "Projects, environments and keys", slug: "concepts/projects-and-keys" },
          { label: "End users and connections", slug: "concepts/users-and-connections" },
          { label: "Connect a device", slug: "guides/connect-a-device" },
        ],
      },
      {
        title: "Send and receive",
        links: [
          { label: "Deliver a message", slug: "guides/deliver-a-message" },
          { label: "Handle answers", slug: "guides/handle-answers" },
          { label: "Capabilities", slug: "concepts/devices-and-capabilities" },
          { label: "Permissions and safety", slug: "concepts/permissions-and-safety" },
          { label: "Context profiles and routing", slug: "concepts/context-profiles-and-routing" },
          { label: "Customize the glasses profile", slug: "guides/customize-the-glasses-profile" },
          { label: "Displays", slug: "concepts/displays" },
          { label: "Build a custom display", slug: "guides/custom-display" },
        ],
      },
      {
        title: "Operate",
        links: [
          { label: "Events and webhooks", slug: "concepts/events-and-analytics" },
          { label: "Test mode", slug: "guides/test-mode" },
        ],
      },
    ],
  },
  {
    id: "api",
    title: "API reference",
    home: "item",
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
          { label: "Create a Connect session", slug: "api-reference/connect-sessions" },
          { label: "Exchange a public token", slug: "api-reference/connections-exchange" },
          { label: "List connections", slug: "api-reference/connections" },
          { label: "Revoke a connection", slug: "api-reference/revoke-connection" },
        ],
      },
      { title: "Context", links: [{ label: "Get context", slug: "api-reference/context" }] },
      {
        title: "Actions",
        links: [
          { label: "Deliver", slug: "api-reference/deliver" },
          { label: "Run a device action", slug: "api-reference/device-actions" },
          { label: "Get an action", slug: "api-reference/actions" },
        ],
      },
      { title: "Devices", links: [{ label: "Get a device", slug: "api-reference/devices" }] },
      { title: "Events", links: [{ label: "List events", slug: "api-reference/events" }] },
    ],
  },
  {
    id: "sdks",
    title: "SDKs and MCP",
    home: "item",
    groups: [
      {
        links: [
          { label: "Hosted MCP", slug: "sdks/hosted-mcp" },
          { label: "Project MCP server", slug: "sdks/project-mcp" },
          { label: "TypeScript SDK", slug: "sdks/typescript" },
        ],
      },
    ],
  },
  {
    id: "security",
    title: "Security",
    home: "item",
    groups: [{ links: [{ label: "Security", slug: "security" }] }],
  },
  {
    id: "pricing",
    title: "Pricing",
    home: "item",
    groups: [{ links: [{ label: "Pricing", slug: "pricing" }] }],
  },
  {
    id: "changelog",
    title: "Changelog",
    home: "item",
    groups: [{ links: [{ label: "Changelog", slug: "changelog" }] }],
  },
];
