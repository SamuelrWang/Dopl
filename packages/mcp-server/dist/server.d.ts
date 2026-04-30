import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { DoplClient } from "@dopl/client";
import type { CanvasRole, CanvasSummary } from "@dopl/client";
export declare function createServer(client: DoplClient, options?: {
    isAdmin?: boolean;
    canvas?: CanvasSummary | null;
    role?: CanvasRole | null;
}): McpServer;
