/**
 * The "Connect an agent" window's tabs. ⚠ THE SAME FOUR PATHS AS THE LANDING'S CONNECT SECTION
 * (`marketing/components/connect-section.tsx › TABS`, which is not exported) — keep the commands
 * in step with it. The MCP route lives on the app origin, not a subdomain (that file says why).
 */
export const MCP_URL = "https://www.usedopl.com/api/mcp";

export interface ConnectTab {
  id: "claude" | "codex" | "cursor" | "sdk";
  label: string;
  command: string;
  hint?: string;
}

export const CONNECT_TABS: ConnectTab[] = [
  {
    id: "claude",
    label: "Claude",
    command: MCP_URL,
    hint: "Paste in Settings → Connectors → Add custom connector — syncs to claude.ai, Desktop, and Claude Code.",
  },
  {
    id: "codex",
    label: "Codex",
    command: `codex mcp add dopl --url ${MCP_URL}`,
    hint: "One command covers the Codex CLI, IDE extension, and ChatGPT desktop app.",
  },
  {
    id: "cursor",
    label: "Cursor",
    command: `"dopl": { "url": "${MCP_URL}" }`,
    hint: "Paste the snippet into ~/.cursor/mcp.json.",
  },
  { id: "sdk", label: "SDK", command: "npm install @dopl/client" },
];
