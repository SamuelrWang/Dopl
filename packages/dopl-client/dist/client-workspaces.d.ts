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
    /** See `workspaces.getActiveWorkspace`. */
    getActiveWorkspace(): Promise<ResolvedWorkspace>;
    pingMcpStatus(): Promise<{
        is_admin: boolean;
        user_id: string | null;
    }>;
}
