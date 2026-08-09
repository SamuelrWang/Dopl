/**
 * Workspace method group — link 2 of the chain documented in
 * `client-base.ts`. Pure delegation to `workspaces.ts`; no HTTP here.
 */
import { DoplClientBase } from "./client-base.js";
import type { ResolvedWorkspace, WorkspaceListItem } from "./types.js";
export declare class WorkspaceMethods extends DoplClientBase {
    listWorkspaces(): Promise<{
        workspaces: WorkspaceListItem[];
    }>;
    getWorkspace(slug: string): Promise<ResolvedWorkspace>;
    /**
     * Resolve the active workspace — the one currently set on the transport
     * via `setWorkspaceId(...)` or `X-Workspace-Id` — via `GET
     * /api/workspaces/me`. Header-less resolution now depends on the caller's
     * membership count (exactly one auto-targets; 0 or 2+ → 400
     * WORKSPACE_REQUIRED). The MCP server boots off `listWorkspaces()` instead,
     * so this is no longer on the boot path.
     */
    getActiveWorkspace(): Promise<ResolvedWorkspace>;
    pingMcpStatus(): Promise<{
        is_admin: boolean;
        user_id: string | null;
    }>;
}
