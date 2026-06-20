/**
 * Survey question data + MCP server constants for the post-signup onboarding
 * flow. Pure data — no React, no server code. The paste-in bootstrap prompt +
 * card template live in `./bootstrap-prompt.ts`.
 *
 * Copy here must stay MODEL-AGNOSTIC: no "Claude", "Codex", "Cursor", etc. The
 * MCP connect step addresses "your AI agent" only.
 */

export interface SurveyOption {
  value: string;
  label: string;
}

export type EntityType = "solo" | "team" | "company";

/** Top-level identity selector (single choice) — drives the descriptor
 *  question + whether the size slider shows. */
export const ENTITY_OPTIONS: { value: EntityType; label: string }[] = [
  { value: "solo", label: "Just me" },
  { value: "team", label: "A team" },
  { value: "company", label: "A company" },
];

/** Descriptor question label per identity. */
export const DESCRIPTOR_QUESTION: Record<EntityType, string> = {
  solo: "Which best describes you?",
  team: "What does your team work on?",
  company: "What industry are you in?",
};

/** Multi-select descriptor options per identity (3 rows worth). */
export const DESCRIPTOR_OPTIONS: Record<EntityType, SurveyOption[]> = {
  solo: [
    { value: "founder", label: "Founder" },
    { value: "software-engineer", label: "Software Engineer" },
    { value: "designer", label: "Designer" },
    { value: "student", label: "Student" },
    { value: "indie-hacker", label: "Indie Hacker" },
    { value: "researcher", label: "Researcher" },
    { value: "product-manager", label: "Product Manager" },
    { value: "data-scientist", label: "Data Scientist" },
    { value: "consultant", label: "Consultant" },
    { value: "content-creator", label: "Content Creator" },
    { value: "operations", label: "Operations" },
    { value: "hobbyist", label: "Hobbyist" },
  ],
  team: [
    { value: "engineering", label: "Engineering" },
    { value: "product", label: "Product" },
    { value: "design", label: "Design" },
    { value: "data", label: "Data" },
    { value: "marketing", label: "Marketing" },
    { value: "sales", label: "Sales" },
    { value: "operations", label: "Operations" },
    { value: "research", label: "Research" },
    { value: "founders", label: "Founders" },
    { value: "support", label: "Support" },
    { value: "content", label: "Content" },
    { value: "strategy", label: "Strategy" },
  ],
  company: [
    { value: "saas", label: "SaaS" },
    { value: "fintech", label: "Fintech" },
    { value: "ecommerce", label: "E-commerce" },
    { value: "ai-ml", label: "AI / ML" },
    { value: "agency", label: "Agency" },
    { value: "consulting", label: "Consulting" },
    { value: "healthcare", label: "Healthcare" },
    { value: "education", label: "Education" },
    { value: "gaming", label: "Gaming" },
    { value: "media", label: "Media" },
    { value: "hardware", label: "Hardware" },
    { value: "enterprise", label: "Enterprise" },
  ],
};

/** Company / team size buckets for the slider (in order). */
export const SIZE_BUCKETS = ["1-2", "2-10", "10-50", "50-100", "100-1000", "1000+"] as const;
export type SizeBucket = (typeof SIZE_BUCKETS)[number];

/** Size slider label per identity (solo never shows it). */
export const SIZE_LABEL: Record<Exclude<EntityType, "solo">, string> = {
  team: "How big is your team?",
  company: "How large is your company?",
};

export const MCP_SERVER_NAME = "dopl";

export const DEFAULT_MCP_URL = "https://www.usedopl.com/api/mcp";
