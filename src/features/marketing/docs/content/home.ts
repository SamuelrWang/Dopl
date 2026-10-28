import { CATEGORY_ROWS } from "./pages-categories";
import type { DocIcon, DocSectionId } from "./types";

/**
 * The docs home (`/docs/home`): a banner, three cards, then one list per `group` section.
 * Titles and descriptions are read off the pages themselves (`../components/docs-home.tsx`);
 * only the icon is chosen here.
 */
export const DOCS_HOME_COPY = {
  title: "Welcome to the Dopl Docs",
  subtitle: "Device categories, shared setup and API references for building with Dopl.",
};

export const HOME_CARDS: { slug: string; icon: DocIcon; title: string }[] = [
  { slug: "quickstart", icon: "quickstart", title: "Quickstart" },
  { slug: "api-reference", icon: "api", title: "API Reference" },
  { slug: "security", icon: "security", title: "Security" },
];

export const HOME_LISTS: {
  section: DocSectionId;
  icons: Record<string, DocIcon>;
}[] = [
  {
    section: "devices",
    icons: {
      devices: "desktop",
      ...Object.fromEntries(CATEGORY_ROWS.map((c) => [`devices/${c.slug}`, c.icon])),
    },
  },
  {
    section: "core",
    icons: {
      overview: "route",
      "concepts/projects-and-keys": "security",
      "concepts/users-and-connections": "connect",
      "guides/connect-a-device": "connect",
      "guides/deliver-a-message": "notify",
      "guides/handle-answers": "ask",
      "concepts/devices-and-capabilities": "code",
      "concepts/permissions-and-safety": "security",
      "concepts/context-profiles-and-routing": "route",
      "guides/customize-the-glasses-profile": "glasses",
      "concepts/displays": "show",
      "guides/custom-display": "show",
      "concepts/events-and-analytics": "api",
      "guides/test-mode": "code",
    },
  },
];
