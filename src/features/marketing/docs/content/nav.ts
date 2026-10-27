import type { DocSection } from "./types";

/**
 * The sidebar. On the docs home it lists every section — `item` sections as one row each,
 * `group` sections as a heading with their pages beneath. On any other page it swaps to that
 * page's section alone, under an "All docs" back link. Order here IS the sidebar order. A
 * device that does not work yet says "(coming soon)" in its label — never list one as available.
 */
export const DOC_SECTIONS: DocSection[] = [
  {
    id: "quickstart",
    title: "Quickstart",
    home: "item",
    groups: [{ links: [{ label: "Quickstart", slug: "start-here" }] }],
  },
  {
    id: "api",
    title: "API",
    home: "item",
    groups: [
      { links: [{ label: "About the Dopl API", slug: "api-reference" }] },
      {
        title: "Intents",
        links: [
          { label: "Show", slug: "api-reference/show" },
          { label: "Ask", slug: "api-reference/ask" },
          { label: "Notify", slug: "api-reference/notify" },
        ],
      },
      {
        title: "Devices",
        links: [{ label: "List endpoints", slug: "api-reference/endpoints" }],
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
  {
    id: "use-cases",
    title: "Use cases",
    home: "group",
    groups: [
      {
        links: [
          { label: "Show on a device", slug: "use-cases/show" },
          { label: "Ask and get an answer", slug: "use-cases/ask" },
          { label: "Notify", slug: "use-cases/notify" },
          {
            label: "Connect your users' devices",
            slug: "use-cases/connect-devices",
          },
          { label: "Route to the right device", slug: "use-cases/routing" },
        ],
      },
    ],
  },
  {
    id: "devices",
    title: "Devices",
    home: "group",
    groups: [
      {
        links: [
          {
            label: "Even Realities G2 glasses",
            slug: "devices/even-realities-g2",
          },
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
];
