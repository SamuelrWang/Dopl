import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SIEClient } from "./api-client.js";
export declare function createServer(client: SIEClient): McpServer;
/**
 * Register one MCP prompt per cluster. Each prompt loads the cluster's
 * entries as context and seeds a scoping instruction so Claude uses
 * query_cluster instead of search_setups for the session.
 */
export declare function registerClusterPrompts(server: McpServer, client: SIEClient): Promise<string[]>;
/**
 * Poll for cluster changes and re-register prompts when the set changes.
 * Emits `notifications/prompts/list_changed` so Claude Code refreshes
 * its slash-command palette.
 */
export declare function startPromptSync(server: McpServer, client: SIEClient, intervalMs?: number): NodeJS.Timeout;
