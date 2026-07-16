/** Static copy for the landing page (Lattice reference clone). */

export const BRAND = "Dopl";

export const NAV_LINKS = ["Product", "Services", "Career", "Pricing", "About"] as const;

export const LOGIN_LABEL = "Login";

export const MENU_LABEL = "Menu";

export const HERO = {
  /** Rendered as two lines, matching the reference line break. */
  headlineLines: ["Ontologies to Bridge", "Agents and Teams"] as const,
  subhead:
    "We bring ideas to life by combining years of experiences of our very talented team.",
  primaryCta: "Login",
  secondaryCta: "Download",
} as const;

/**
 * Stable public URL of the notarized macOS desktop DMG. Served from the latest
 * GitHub release; the version-less asset name keeps this link valid across builds.
 */
export const DOWNLOAD_URL =
  "https://github.com/SamuelrWang/Dopl/releases/latest/download/Dopl-arm64.dmg";

export interface DeckPanel {
  id: string;
  eyebrow: string;
  label: string;
  /** Short feature description shown in the expanded panel (rolling out per tab). */
  blurb?: string;
}

/** Stacked deck panels under the hero. Front = active; rest fan to the right. */
export const DECK_PANELS: readonly DeckPanel[] = [
  { id: "human", eyebrow: "01", label: "Humans" },
  { id: "agent", eyebrow: "02", label: "Agents" },
  {
    id: "ontology",
    eyebrow: "03",
    label: "Ontology",
    blurb:
      "Skills, knowledge, and chats compose into one live graph — the shared ontology your agents read, write, and act through.",
  },
  { id: "tools", eyebrow: "04", label: "Tools" },
  { id: "action", eyebrow: "05", label: "Actions" },
];

/** Seconds the top slider takes to cross a panel before auto-advancing. */
export const DECK_DURATION_S = 8;

