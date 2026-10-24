/**
 * The "Connect an agent" `dopl-mcp` code window's rows. ⚠ SAME VALUES AS THE LANDING'S CONNECT
 * SECTION (`marketing/components/connect-section.tsx › ROWS` / `CURSOR_INSTALL_URL`, not
 * exported) — keep them in step. The MCP route lives on the app origin, not a subdomain (that
 * file says why).
 */
export const MCP_URL = "https://www.usedopl.com/api/mcp";

/** Cursor's one-click install link: base64 of `{"url": MCP_URL}` (connect-section.tsx). */
export const CURSOR_INSTALL_URL = `https://cursor.com/en/install-mcp?name=dopl&config=${encodeURIComponent(
  "eyJ1cmwiOiJodHRwczovL3d3dy51c2Vkb3BsLmNvbS9hcGkvbWNwIn0=",
)}`;

/** One value token; `str` renders in the window's string blue. */
export interface ConnectToken {
  k?: "str";
  t: string;
}

/** A `#` comment naming the client, then the value to copy. */
export interface ConnectRow {
  id: "claude" | "codex" | "cursor" | "any";
  /** Copy button's accessible name. */
  label: string;
  comment: string;
  value: ConnectToken[];
  copy: string;
}

export const CONNECT_ROWS: ConnectRow[] = [
  {
    id: "claude",
    label: "Claude connector URL",
    comment: "Claude: Settings › Connectors › Add custom connector",
    value: [{ k: "str", t: MCP_URL }],
    copy: MCP_URL,
  },
  {
    id: "codex",
    label: "Codex command",
    comment: "ChatGPT (Codex app, CLI, IDE)",
    value: [{ t: "codex mcp add dopl --url " }, { k: "str", t: MCP_URL }],
    copy: `codex mcp add dopl --url ${MCP_URL}`,
  },
  {
    id: "cursor",
    label: "Cursor snippet",
    comment: "Cursor: add to ~/.cursor/mcp.json",
    value: [{ t: '"dopl": { "url": ' }, { k: "str", t: `"${MCP_URL}"` }, { t: " }" }],
    copy: `"dopl": { "url": "${MCP_URL}" }`,
  },
  {
    id: "any",
    label: "MCP URL",
    comment: "Any MCP client",
    value: [{ k: "str", t: MCP_URL }],
    copy: MCP_URL,
  },
];
