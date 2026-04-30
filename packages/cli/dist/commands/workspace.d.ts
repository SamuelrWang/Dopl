import { Command } from "commander";
/**
 * `dopl workspace` — manage which workspace the CLI (and any MCP server
 * launched without an explicit `DOPL_WORKSPACE_ID`) is scoped to.
 *
 * Subcommands:
 *   list      — list every workspace the current user is an active member of
 *   current   — show the active workspace (from config, env, or default)
 *   use <slug>— set the active workspace (writes config)
 *   clear     — unset; the server will fall back to the user's default
 */
export declare function registerWorkspaceCommands(program: Command): void;
