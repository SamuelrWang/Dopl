/**
 * The paste-into-your-agent CONNECT prompt. Pure data — no React, no server
 * code, no AI keys.
 *
 * ⚠ Copy must stay MODEL-AGNOSTIC: no "Claude"/"Codex"/"Cursor". Address
 * "your AI agent" / "your environment" only.
 */

/** Connect prompt (onboarding step 2) — MCP handshake only. */
export function buildConnectPrompt(url: string): string {
  return `Connect to the Dopl MCP server using HTTP (streamable) at ${url}. If your environment can't add MCP servers via CLI or command, walk me through adding it manually using the server name and URL above and authenticating via OAuth.`;
}
