/** Workspace method group (chain in `client-base.ts`); pure delegation. */
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
    /** Lend one resource to one scope. On this early link because it is cross-domain (knowledge and
     *  identities both call it). */
    grantResource(input: ResourceGrantInput): Promise<ResourceGrantResult>;
    pingMcpStatus(): Promise<{
        is_admin: boolean;
        user_id: string | null;
        /** The operator's mention handle, or null — see `workspaces.ts › pingMcpStatus`. */
        handle: string | null;
    }>;
}
