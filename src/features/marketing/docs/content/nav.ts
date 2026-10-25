import type { DocTab } from "./types";

/**
 * The header tabs and each tab's sidebar. Order here IS the sidebar order and the
 * prev/next order. A device that does not work yet says "(coming soon)" in its label —
 * never list one as available.
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
          { label: "Google Home", slug: "devices/google-home" },
          { label: "Apple Watch (coming soon)", slug: "devices/apple-watch" },
          { label: "Cars (coming soon)", slug: "devices/cars" },
          { label: "Meta Ray-Ban (coming soon)", slug: "devices/meta-ray-ban" },
          { label: "Robots (coming soon)", slug: "devices/robots" },
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
              { label: "SDKs", slug: "api-reference#sdks" },
              { label: "CLI", slug: "api-reference#cli" },
              { label: "REST", slug: "api-reference#rest" },
            ],
          },
        ],
      },
      {
        title: "Intents",
        links: [
          { label: "Show", slug: "api-reference/show", method: "POST" },
          { label: "Ask", slug: "api-reference/ask", method: "POST" },
          { label: "Notify", slug: "api-reference/notify", method: "POST" },
        ],
      },
      {
        title: "Devices",
        links: [{ label: "List endpoints", slug: "api-reference/endpoints", method: "GET" }],
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
