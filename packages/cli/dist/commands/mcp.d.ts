import { Command } from "commander";
/**
 * `dopl mcp` — set up an MCP client (Claude Code, Claude Desktop) to
 * talk to Dopl. The flagship subcommand is `dopl mcp config` which
 * either prints the config block or, with `--write`, drops it into
 * the right file on disk and installs the master Dopl skill.
 *
 * Resolved against the user's stored credentials (`dopl auth login`),
 * so the printed/written block already has the API key + base URL
 * substituted — no copy-paste fiddling.
 */
export declare function registerMcpCommands(program: Command): void;
