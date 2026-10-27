import type { DocTab } from "./types";

/**
 * The header tabs and each tab's sidebar. Order here IS the sidebar order and the
 * prev/next order. A row's status badge comes from its page's `status` (`index.ts ›
 * statusOf`), so labels never carry "(coming soon)" themselves.
 */
export const DOC_TABS: DocTab[] = [
  {
    id: "about",
    label: "About",
    slug: "start-here",
    groups: [
      {
        title: "Overview",
        links: [
          { label: "Start here", slug: "start-here" },
          { label: "Security", slug: "security" },
          { label: "Pricing", slug: "pricing" },
        ],
      },
      {
        title: "Use cases",
        links: [
          { label: "Show on a device", slug: "use-cases/show" },
          { label: "Ask and get an answer", slug: "use-cases/ask" },
          { label: "Notify", slug: "use-cases/notify" },
          { label: "Connect your users' devices", slug: "use-cases/connect-devices" },
          { label: "Route to the right device", slug: "use-cases/routing" },
        ],
      },
      {
        title: "Devices",
        links: [
          { label: "Even Realities G2 glasses", slug: "devices/even-realities-g2" },
          { label: "Phone push", slug: "devices/phone-push" },
          { label: "Mac notch", slug: "devices/mac-notch" },
          { label: "Desktop", slug: "devices/desktop" },
          { label: "Apple Watch", slug: "devices/apple-watch" },
          { label: "Cars", slug: "devices/cars" },
          { label: "Meta Ray-Ban", slug: "devices/meta-ray-ban" },
          { label: "Robots", slug: "devices/robots" },
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
          {
            label: "Our interfaces",
            slug: "api-reference#interfaces",
            children: [
              { label: "Hosted MCP", slug: "api-reference#hosted-mcp" },
              { label: "REST", slug: "api-reference#rest" },
              { label: "SDKs", slug: "api-reference#sdks" },
              { label: "Connect widget", slug: "api-reference#connect-widget" },
            ],
          },
        ],
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
        title: "Connect",
        links: [
          { label: "Create a Connect session", slug: "api-reference/connect-sessions", method: "POST" },
          { label: "List connections", slug: "api-reference/connections", method: "GET" },
        ],
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
