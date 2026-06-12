/**
 * Landing page design tokens + section data.
 *
 * Palette translates the app's dark/cyan-blue identity (see globals.css
 * --accent-* tokens) into an alternating light/dark marketing rhythm.
 */

export const MARKETING = {
  /** Light "ice" sections — cool white. */
  ice: "#f2f5fa",
  /** Dark "ink" sections. */
  ink: "#0b0e14",
  /** Slightly lifted card surface on ink. */
  inkCard: "#12161f",
  /** Deep blue full-bleed band. */
  deep: "#0e2240",
  /** Soft blue band (light accent strip). */
  soft: "#dce7f8",
  /** Primary accent — matches app --accent-primary family. */
  accent: "#4a9eff",
  /** Stronger glow accent — matches app --accent-glow family. */
  glow: "#3d7bff",
  /** Link blue — matches app --link (light theme). */
  link: "#2f6fed",
  /** Text on light surfaces. */
  inkText: "#10131a",
  /** Muted text on light surfaces. */
  mutedText: "#5b6573",
} as const;

/** Agent tools shown in the marquee ribbon. Monogram chips until real logos land. */
export const AGENT_TOOLS = [
  { name: "Claude Code", mark: "C" },
  { name: "Codex", mark: "X" },
  { name: "Cursor", mark: "Cu" },
  { name: "Gemini CLI", mark: "G" },
  { name: "Copilot", mark: "Co" },
  { name: "Windsurf", mark: "W" },
  { name: "Goose", mark: "Go" },
  { name: "claude.ai", mark: "ai" },
] as const;

/** Messy "scattered context" phrases — hero ribbon input side. */
export const RIBBON_IN = [
  "how do we deploy again?",
  "ask Sarah about the API",
  "what's our brand voice?",
  "where's the onboarding doc?",
  "paste the style guide… again",
];

/** Completed agent actions — hero ribbon output side. */
export const RIBBON_OUT = [
  "✓ PR opened",
  "✓ report drafted",
  "✓ campaign shipped",
  "✓ docs updated",
  "✓ leads enriched",
];

export interface TeamPreview {
  id: string;
  label: string;
  skills: string[];
  knowledge: string[];
}

/** Teams selector — chips + the resources each team's agents receive. */
export const TEAMS: TeamPreview[] = [
  {
    id: "engineering",
    label: "Engineering",
    skills: ["Code review", "Release notes", "Incident triage"],
    knowledge: ["Architecture docs", "API reference", "Runbooks"],
  },
  {
    id: "marketing",
    label: "Marketing",
    skills: ["Campaign brief", "SEO audit", "Social calendar"],
    knowledge: ["Brand voice", "Personas", "Past campaigns"],
  },
  {
    id: "sales",
    label: "Sales",
    skills: ["Lead enrichment", "Outreach draft", "Call summary"],
    knowledge: ["ICP definition", "Pricing sheet", "Battle cards"],
  },
  {
    id: "ops",
    label: "Ops",
    skills: ["Weekly report", "Vendor compare", "SOP writer"],
    knowledge: ["Process docs", "Tool inventory", "Policies"],
  },
  {
    id: "support",
    label: "Support",
    skills: ["Ticket triage", "Macro drafts", "Escalation memo"],
    knowledge: ["Product FAQ", "Known issues", "Tone guide"],
  },
];

export interface FeatureBlock {
  id: string;
  eyebrow: string;
  title: string;
  body: string;
  mock: "skills" | "knowledge" | "workflows" | "admin";
}

export const FEATURE_BLOCKS: FeatureBlock[] = [
  {
    id: "skills",
    eyebrow: "Skills library",
    title: "Skills your whole team shares",
    body: "Package the prompts and procedures that work into named skills. Every agent on the team gets the same playbook, instantly.",
    mock: "skills",
  },
  {
    id: "knowledge",
    eyebrow: "Knowledge bases",
    title: "Everything your agents should know",
    body: "Docs, decisions, and tribal knowledge live in one place — loaded into every session so nobody re-explains the basics.",
    mock: "knowledge",
  },
  {
    id: "workflows",
    eyebrow: "Workflows",
    title: "Multi-step work, mapped out",
    body: "Chain skills and knowledge into workflows agents can follow end to end — not just answers, finished work.",
    mock: "workflows",
  },
  {
    id: "admin",
    eyebrow: "Central management",
    title: "One place to run it all",
    body: "Distribute resources by team, manage access, and update a skill once to update it everywhere.",
    mock: "admin",
  },
];

export const SKILL_PILLS = [
  "Cold outreach writer",
  "Code review assistant",
  "Ticket triager",
  "Weekly report",
  "SEO audit",
  "Release notes",
  "Call summary",
];

export const KNOWLEDGE_PILLS = [
  "Brand voice",
  "API reference",
  "Onboarding guide",
  "Pricing sheet",
  "Architecture docs",
  "Process SOPs",
  "Known issues",
];
