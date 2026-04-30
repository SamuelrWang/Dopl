import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { DoplClient } from "@dopl/client";
import type { WorkspaceRole, WorkspaceSummary } from "@dopl/client";
export declare function createServer(client: DoplClient, options?: {
    isAdmin?: boolean;
    workspace?: WorkspaceSummary | null;
    role?: WorkspaceRole | null;
}): McpServer;
