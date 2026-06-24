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

/** Stacked deck panels under the hero. Front = active; rest fan to the right. */
export const DECK_PANELS = [
  { id: "human", eyebrow: "01", label: "Human" },
  { id: "agent", eyebrow: "02", label: "Agent" },
  { id: "ontology", eyebrow: "03", label: "Ontology" },
  { id: "tools", eyebrow: "04", label: "Tools" },
  { id: "action", eyebrow: "05", label: "Action" },
] as const;

/** Seconds the top slider takes to cross a panel before auto-advancing. */
export const DECK_DURATION_S = 8;

