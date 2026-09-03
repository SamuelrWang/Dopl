/**
 * Workspace method group — link 2 of the chain documented in
 * `client-base.ts`. Pure delegation to `workspaces.ts`; no HTTP here.
 */

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

  /**
   * Lend one resource to one scope — the write that REPLACED the copy ops
   * (Wave B ruling B11). ⚠ It lives on link 2 because a grant is cross-domain:
   * `KnowledgeMethods` and `AgentTemplateMethods` both call it, and a method on
   * either of those would be invisible to the other.
   */
  async grantResource(input: ResourceGrantInput): Promise<ResourceGrantResult> {
    return grants.grantResource(this.transport, input);
  }

  async pingMcpStatus(): Promise<{ is_admin: boolean; user_id: string | null }> {
    return workspaces.pingMcpStatus(this.transport);
  }
}
