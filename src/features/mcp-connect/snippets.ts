/**
 * Pure builders for the OAuth remote-HTTP MCP connection snippets. No API key:
 * the client runs the OAuth dance (browser sign-in) on first connect, and
 * server updates roll out automatically (nothing installed locally).
 *
 * Side-effect-free so the presentational components stay testable.
 */

/** Claude Code one-liner for the remote HTTP server (OAuth handles auth). */
export function buildClaudeCliHttp(url: string): string {
  return `claude mcp add --transport http dopl ${url}`;
}

/** Claude Desktop / Cursor / generic `mcpServers` JSON for the remote HTTP server. */
export function buildClaudeConfigHttp(url: string): string {
  return JSON.stringify(
    { mcpServers: { dopl: { type: "http", url } } },
    null,
    2,
  );
}
