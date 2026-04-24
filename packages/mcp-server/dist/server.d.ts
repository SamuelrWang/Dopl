import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { DoplClient } from "@dopl/client";
export declare function createServer(client: DoplClient, options?: {
    isAdmin?: boolean;
}): McpServer;
