/** Static copy for the landing page (Lattice reference clone). */

export const BRAND = "Dopl";

export const NAV_LINKS = ["Product", "Services", "Career", "Pricing", "About"] as const;

/**
 * THE LANDING PAGE HAS ONE CALL TO ACTION, AND IT IS THE DOWNLOAD.
 *
 * Dopl is a desktop app. The web app is being retired
 * (docs/migration-research/website-retirement-plan.md), so the public page must
 * stop offering a web sign-in it will shortly not have — every visitor's next
 * step is the same one, and a second button beside it only splits the click.
 *
 * `/login` ITSELF IS NOT GOING ANYWHERE. It is on the retirement plan's KEEP
 * list: the desktop OAuth handoff (`/auth/desktop-start` → the system browser →
 * `dopl://auth`) lands there, and a password reset lands there. What was removed
 * is the LANDING PAGE ADVERTISING it, not the route.
 */
export const DOWNLOAD_LABEL = "Download";

export const MENU_LABEL = "Menu";

export const HERO = {
  /** Rendered as two lines, matching the reference line break. */
  headlineLines: ["Ontologies to Bridge", "Agents and Teams"] as const,
  subhead:
    "We bring ideas to life by combining years of experiences of our very talented team.",
  primaryCta: DOWNLOAD_LABEL,
} as const;

/**
 * The download, as a stable same-origin path.
 *
 * This was a hardcoded github.com URL naming a `Dopl-arm64.dmg` asset that has
 * never existed — electron-builder stamps the version into the file name, so the
 * button 404'd. `src/app/download/route.ts` resolves the real asset out of the
 * release feed and redirects; `src/shared/version/mac-download.ts` is the why.
 */
export const DOWNLOAD_URL = "/download";

export interface DeckPanel {
  id: string;
  eyebrow: string;
  label: string;
  /** Short feature description shown in the expanded panel (rolling out per tab). */
  blurb?: string;
}

/** Stacked deck panels under the hero. Front = active; rest fan to the right. */
export const DECK_PANELS: readonly DeckPanel[] = [
  {
    id: "ontology",
    eyebrow: "01",
    label: "Ontology",
    blurb:
      "Your team's intelligence, structured. Objects, attributes, and edges — one live graph your agents read, write, and act through.",
  },
  {
    id: "knowledge",
    eyebrow: "02",
    label: "Knowledge",
    blurb:
      "What your team knows, as objects in the graph. Agents pull the right doc into context instead of guessing.",
  },
  {
    id: "skills",
    eyebrow: "03",
    label: "Skills",
    blurb:
      "How your team does things — procedures agents load and follow. Written once, versioned, linked into the ontology.",
  },
  {
    id: "chats",
    eyebrow: "04",
    label: "Chats",
    blurb:
      "What your agents have said and decided. Every conversation archived, searchable, and feeding back into the graph.",
  },
  {
    id: "workflows",
    eyebrow: "05",
    label: "Workflows",
    blurb:
      "Multi-step runs your agents execute end-to-end — grounded in the same ontology, so every step knows the context.",
  },
];

/** Seconds the top slider takes to cross a panel before auto-advancing. */
export const DECK_DURATION_S = 8;

