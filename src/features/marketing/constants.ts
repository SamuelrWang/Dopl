/** Static copy + data for the landing page. */

export const NAV_LINKS = [
  "Platform",
  "Specialties",
  "Customers",
  "Guides",
  "Insights",
  "Company",
] as const;

export const NAV_PILL = {
  badge: "New",
  label: "The Platform Approach",
} as const;

export const CTA_LABEL = "Get started";

export const HERO = {
  headline: "Where humans and agents build together",
  paragraph:
    "Dopl gives your team and your agents one shared workspace — the knowledge, skills, and tools they need to get real work done.",
} as const;

/** The scroll-driven ontology stack: five layers revealed as you scroll. */
export const ONTOLOGY_SECTION = {
  eyebrow: "THE ONTOLOGY STACK",
  heading: "One stack, from intent to action",
} as const;

export type OntologyLayerId =
  | "humans"
  | "agents"
  | "ontology"
  | "tools"
  | "actions";

export type OntologyLayer = {
  id: OntologyLayerId;
  tag: string;
  title: string;
  blurb: string;
};

export const ONTOLOGY_LAYERS: readonly OntologyLayer[] = [
  {
    id: "humans",
    tag: "01 — Humans",
    title: "You set the intent",
    blurb:
      "Describe the outcome in plain language. Your team stays in command; agents do the legwork.",
  },
  {
    id: "agents",
    tag: "02 — Agents",
    title: "Agents pick up the work",
    blurb:
      "Specialized agents plan, decide, and execute across your tools — in a loop, until it's done.",
  },
  {
    id: "ontology",
    tag: "03 — Ontology",
    title: "Grounded in your world",
    blurb:
      "A living model of your objects, attributes, and methods, so agents reason over your real business — not guesses.",
  },
  {
    id: "tools",
    tag: "04 — Tools",
    title: "Wired into your stack",
    blurb:
      "HubSpot, Salesforce, Slack, Gmail, and more — agents act through the tools you already run on.",
  },
  {
    id: "actions",
    tag: "05 — Actions",
    title: "Real actions, real outcomes",
    blurb:
      "Records updated, messages sent, deals moved — work that shows up in the systems that matter.",
  },
] as const;

export const TRUSTED_LABEL = "TRUSTED BY TEAMS BUILDING WITH AGENTS";

export const LOGOS = [
  "SalvoHealth",
  "Juniper",
  "ViVim",
  "FAM",
  "ADAPTIC HEALTH",
  "Heal",
  "DispatchHealth",
] as const;

export const STATS = [
  { value: "100M+", label: "Agent actions run" },
  { value: "10x", label: "Increase in team capacity" },
  { value: "5x", label: "Return on investment" },
] as const;
