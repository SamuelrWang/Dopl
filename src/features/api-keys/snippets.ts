/**
 * Pure builders for the API-key setup snippets. Kept side-effect-free so
 * the unified ConnectionSetup component stays presentational and these
 * strings are unit-testable. `key` is the real plaintext (or a
 * placeholder when the key isn't revealable).
 */

export const KEY_PLACEHOLDER = "<YOUR_API_KEY>";

/** Claude Code CLI one-liner. */
export function buildClaudeCli(key: string): string {
  return `claude mcp add dopl --scope user --transport stdio -- npx @dopl/mcp-server --api-key ${key}`;
}

/** Claude Desktop / VS Code / Cursor mcpServers JSON. */
export function buildClaudeConfig(key: string): string {
  return JSON.stringify(
    { mcpServers: { dopl: { command: "npx", args: ["@dopl/mcp-server", "--api-key", key] } } },
    null,
    2
  );
}

/** Codex (`~/.codex/config.toml`) MCP server block. */
export function buildCodexConfig(key: string): string {
  return [
    "[mcp_servers.dopl]",
    'command = "npx"',
    `args = ["@dopl/mcp-server", "--api-key", "${key}"]`,
  ].join("\n");
}

/** Generic single-server MCP config for any other tool. */
export function buildGenericConfig(key: string): string {
  return JSON.stringify(
    { dopl: { command: "npx", args: ["@dopl/mcp-server", "--api-key", key] } },
    null,
    2
  );
}

/** Self-contained instructions to paste into any MCP-capable agent. */
export function buildAgentPrompt(key: string): string {
  return `# Dopl — MCP Connection

You are being given credentials to connect to Dopl.
Connect to this MCP server, then explain to the user what you just connected to.

## Connect

Add this MCP server to your configuration. This is a standard MCP stdio server.

\`\`\`json
{
  "dopl": {
    "command": "npx",
    "args": ["@dopl/mcp-server", "--api-key", "${key}"]
  }
}
\`\`\`

Where to put this depends on your platform:
- Claude Code CLI: run \`claude mcp add dopl --scope user --transport stdio -- npx @dopl/mcp-server --api-key ${key}\`
- Claude Desktop (macOS): add to ~/Library/Application Support/Claude/claude_desktop_config.json under "mcpServers"
- Claude Desktop (Windows): add to %APPDATA%\\Claude\\claude_desktop_config.json under "mcpServers"
- Codex: add to ~/.codex/config.toml under [mcp_servers.dopl]
- VS Code / Cursor / Windsurf: add to .mcp.json in project root under "mcpServers"
- Any other MCP-compatible tool: add to that tool's MCP server config

## After connecting

Once connected, explain to the user that they are now connected to **Dopl** — a curated knowledge base of real-world AI and automation setups. The server provides its own context about available capabilities and tools, so you'll automatically know what you can do.
`;
}
