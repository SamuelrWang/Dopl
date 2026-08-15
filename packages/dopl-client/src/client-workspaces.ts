/**
 * Workspace method group — link 2 of the chain documented in
 * `client-base.ts`. Pure delegation to `workspaces.ts`; no HTTP here.
 */

import { DoplClientBase } from "./client-base.js";
import * as workspaces from "./workspaces.js";
import type { ResolvedWorkspace, WorkspaceListItem } from "./types.js";

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

  async pingMcpStatus(): Promise<{ is_admin: boolean; user_id: string | null }> {
    return workspaces.pingMcpStatus(this.transport);
  }
}
