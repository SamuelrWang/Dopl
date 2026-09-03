/**
 * Workspace method group — link 2 of the chain documented in
 * `client-base.ts`. Pure delegation to `workspaces.ts`; no HTTP here.
 */
import { DoplClientBase } from "./client-base.js";
import type { ResolvedWorkspace, WorkspaceListItem } from "./types.js";
import type { ResourceGrantInput, ResourceGrantResult } from "./grant-types.js";
export declare class WorkspaceMethods extends DoplClientBase {
    listWorkspaces(): Promise<{
        workspaces: WorkspaceListItem[];
    }>;
    getWorkspace(slug: string): Promise<ResolvedWorkspace>;
    /** See `workspaces.getActiveWorkspace`. */
    getActiveWorkspace(): Promise<ResolvedWorkspace>;
    /**
     * Lend one resource to one scope — the write that REPLACED the copy ops
     * (Wave B ruling B11). ⚠ It lives on link 2 because a grant is cross-domain:
     * `KnowledgeMethods` and `AgentTemplateMethods` both call it, and a method on
     * either of those would be invisible to the other.
     */
    grantResource(input: ResourceGrantInput): Promise<ResourceGrantResult>;
    pingMcpStatus(): Promise<{
        is_admin: boolean;
        user_id: string | null;
    }>;
}
