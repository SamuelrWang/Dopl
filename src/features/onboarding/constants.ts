/**
 * Survey question data + MCP server constants for the post-signup
 * onboarding flow. Pure data — no React, no server code. The paste-in
 * bootstrap prompt + card template live in `./bootstrap-prompt.ts`.
 *
 * Copy here must stay MODEL-AGNOSTIC: no "Claude", "Codex", "Cursor",
 * etc. The MCP connect step addresses "your AI agent" only.
 */

export interface SurveyOption {
  value: string;
  label: string;
}

export const ROLE_OPTIONS: SurveyOption[] = [
  { value: "engineer", label: "Engineer" },
  { value: "founder", label: "Founder" },
  { value: "product", label: "Product" },
  { value: "designer", label: "Designer" },
  { value: "operations", label: "Operations" },
  { value: "student", label: "Student" },
];

export const USE_CASE_OPTIONS: SurveyOption[] = [
  { value: "organize_ai_knowledge", label: "Organize AI knowledge" },
  { value: "build_agent_workflows", label: "Build agent workflows" },
  { value: "team_knowledge_sharing", label: "Team knowledge sharing" },
  { value: "connect_agents_mcp", label: "Connect agents via MCP" },
  { value: "research", label: "Research" },
];

export const TEAM_OPTIONS: SurveyOption[] = [
  { value: "solo", label: "Just me" },
  { value: "small_team", label: "Small team" },
  { value: "company", label: "Company" },
];

export const REFERRAL_OPTIONS: SurveyOption[] = [
  { value: "twitter", label: "Twitter / X" },
  { value: "friend", label: "Friend or colleague" },
  { value: "search", label: "Search" },
  { value: "youtube", label: "YouTube" },
];

/** Sentinel chip value that reveals the free-text "Other" input. */
export const OTHER_OPTION_VALUE = "other";

export const MCP_SERVER_NAME = "dopl";

export const DEFAULT_MCP_URL = "https://www.usedopl.com/api/mcp";
