/**
 * Pure builders for the OAuth remote-HTTP MCP connection snippets. No API key —
 * the client runs the OAuth dance on first connect. Side-effect-free so the
 * presentational components stay testable.
 */

/** Claude Code one-liner for the remote HTTP server (OAuth handles auth). */
export function buildClaudeCliHttp(url: string): string {
  return `claude mcp add --transport http dopl ${url}`;
}

/** Claude Desktop / Cursor / generic `mcpServers` JSON, remote HTTP server. */
export function buildClaudeConfigHttp(url: string): string {
  return JSON.stringify(
    { mcpServers: { dopl: { type: "http", url } } },
    null,
    2,
  );
}

/** Codex CLI one-liner for the remote HTTP server; Codex runs the OAuth sign-in on first use. */
export function buildCodexCliHttp(url: string): string {
  return `codex mcp add dopl --url ${url}`;
}

export interface ConnectRecipe {
  client: string;
  /** What to paste, and where the copy goes. */
  text: string;
  hint: string;
}

/** One line per client the Connect page names — the command or URL, and where it goes. */
export function connectRecipes(url: string): ConnectRecipe[] {
  return [
    { client: "Claude Code", text: buildClaudeCliHttp(url), hint: "Run in a terminal" },
    { client: "Codex", text: buildCodexCliHttp(url), hint: "Run in a terminal" },
    { client: "Claude", text: url, hint: "Settings → Connectors → Add custom connector" },
    { client: "Cursor and others", text: url, hint: "Add as a remote MCP server" },
  ];
}
