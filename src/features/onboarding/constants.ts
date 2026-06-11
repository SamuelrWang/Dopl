/**
 * Survey question data + the copyable agent-connect prompt for the
 * post-signup onboarding flow. Pure data — no React, no server code.
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

/**
 * The paste-into-your-agent prompt. Works with any MCP-capable agent —
 * it describes the server and the OAuth dance, and lets the agent pick
 * its own client-specific install mechanics.
 */
export function buildAgentConnectPrompt(url: string): string {
  return [
    `Connect to my Dopl MCP server.`,
    `Server name: ${MCP_SERVER_NAME}. Transport: HTTP (streamable). URL: ${url}.`,
    `It uses OAuth — a browser window will open for me to sign in; no API key is needed.`,
    `Once connected, list the available tools so I can see what you can do with my workspace.`,
  ].join(" ");
}
