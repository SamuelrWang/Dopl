import { CATEGORY_ROWS } from "./pages-categories";
import type { DocIcon } from "./types";

/**
 * The docs home (`/docs/home`): a hero with a code sample, "Start here" cards, the device
 * categories as tiles, then a short pick of Core pages (the sidebar holds the full list).
 * Card, tile and pick descriptions are read off the pages themselves
 * (`../components/docs-home.tsx`); only titles, icons and the hero live here.
 */
export const DOCS_HOME_COPY = {
  eyebrow: "Dopl Device SDK",
  title: "Reach your users on any device they own",
  subtitle:
    "One API for your agent to show cards, ask questions and send notifications to glasses, phones, computers and more. Start with a simulated device and a test key.",
  sample: [
    `import { Dopl } from "@dopl/sdk";`,
    ``,
    `const dopl = new Dopl({`,
    `  apiKey: process.env.DOPL_SECRET_KEY!,`,
    `});`,
    ``,
    `await dopl.notify("usr_123", {`,
    `  text: "Your build finished",`,
    `});`,
    ``,
    `const answer = await dopl.ask("usr_123", {`,
    `  question: "Ship it?",`,
    `  options: ["Yes", "No"],`,
    `});`,
  ].join("\n"),
};

export const HOME_CARDS: { slug: string; icon: DocIcon; title: string }[] = [
  { slug: "quickstart", icon: "quickstart", title: "Quickstart" },
  { slug: "guides/connect-a-device", icon: "connect", title: "Connect a device" },
  { slug: "guides/deliver-a-message", icon: "notify", title: "Deliver a message" },
  { slug: "sdks/typescript", icon: "code", title: "TypeScript SDK" },
];

/** Every device category, as a tile. "All device categories" is the section's header link. */
export const HOME_DEVICES = CATEGORY_ROWS.map((c) => ({ slug: `devices/${c.slug}`, title: c.title, icon: c.icon }));

/** A pick of Core, not all of it. */
export const HOME_CORE: { slug: string; icon: DocIcon }[] = [
  { slug: "concepts/projects-and-keys", icon: "security" },
  { slug: "concepts/users-and-connections", icon: "connect" },
  { slug: "guides/handle-answers", icon: "ask" },
  { slug: "concepts/context-profiles-and-routing", icon: "route" },
  { slug: "concepts/displays", icon: "show" },
  { slug: "concepts/permissions-and-safety", icon: "security" },
  { slug: "concepts/events-and-analytics", icon: "api" },
  { slug: "guides/test-mode", icon: "code" },
];
