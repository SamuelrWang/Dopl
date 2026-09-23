/** Workspace method group (chain in `client-base.ts`); pure delegation. */

import { DoplClientBase } from "./client-base.js";
import * as workspaces from "./workspaces.js";
import * as grants from "./grants.js";
import type { ResolvedWorkspace, WorkspaceListItem } from "./types.js";
import type {
  ResourceGrantInput,
  ResourceGrantResult,
} from "./grant-types.js";

export class WorkspaceMethods extends DoplClientBase {
  async listWorkspaces(): Promise<{ workspaces: WorkspaceListItem[] }> {
    return workspaces.listWorkspaces(this.transport);
  }

  async getWorkspace(slug: string): Promise<ResolvedWorkspace> {
    return workspaces.getWorkspace(this.transport, slug);
  }

  /** See `workspaces.getActiveWorkspace`. */
  async getActiveWorkspace(): Promise<ResolvedWorkspace> {
    return workspaces.getActiveWorkspace(this.transport);
  }

  /** Lend one resource to one scope. On this early link because it is cross-domain (knowledge and
   *  identities both call it). */
  async grantResource(input: ResourceGrantInput): Promise<ResourceGrantResult> {
    return grants.grantResource(this.transport, input);
  }

  async pingMcpStatus(): Promise<{
    is_admin: boolean;
    user_id: string | null;
    /** The operator's mention handle, or null — see `workspaces.ts › pingMcpStatus`. */
    handle: string | null;
  }> {
    return workspaces.pingMcpStatus(this.transport);
  }
}
