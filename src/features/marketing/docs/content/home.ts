import type { DocIcon, DocSectionId } from "./types";

/**
 * The docs home (`/docs/home`): a banner, three cards, then one list per `group` section.
 * Titles and descriptions are read off the pages themselves (`../components/docs-home.tsx`);
 * only the icon is chosen here.
 */
export const DOCS_HOME_COPY = {
  title: "Welcome to the Dopl Docs",
  subtitle: "Guides, device pages and API references for building with Dopl.",
};

export const HOME_CARDS: { slug: string; icon: DocIcon; title: string }[] = [
  { slug: "start-here", icon: "quickstart", title: "Quickstart" },
  { slug: "api-reference", icon: "api", title: "API Reference" },
  { slug: "security", icon: "security", title: "Security" },
];

export const HOME_LISTS: {
  section: DocSectionId;
  icons: Record<string, DocIcon>;
}[] = [
  {
    section: "use-cases",
    icons: {
      "use-cases/show": "show",
      "use-cases/ask": "ask",
      "use-cases/notify": "notify",
      "use-cases/connect-devices": "connect",
      "use-cases/routing": "route",
    },
  },
  {
    section: "devices",
    icons: {
      "devices/even-realities-g2": "glasses",
      "devices/phone-push": "phone",
      "devices/mac-notch": "notch",
      "devices/desktop": "desktop",
      "devices/google-home": "speaker",
      "devices/apple-watch": "watch",
      "devices/cars": "car",
      "devices/meta-ray-ban": "glasses",
      "devices/robots": "robot",
    },
  },
];
