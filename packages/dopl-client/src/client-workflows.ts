/**
 * Workflow method group — link 4 of the chain documented in `client-base.ts`.
 * Pure delegation to `workflows.ts`; no HTTP here.
 *
 * `listWorkflowTrash` / `restoreWorkflow` SURVIVED the 2026-08-07 trash
 * teardown on purpose (D3) — see the note atop `workflows.ts`. They look dead
 * next to the knowledge/ontology/chat trash methods that were deleted around
 * them; they are not.
 */

import { ClusterMethods } from "./client-clusters.js";
import * as workflows from "./workflows.js";
import type {
  WorkflowDetail,
  WorkflowGraphSpec,
  WorkflowNodeInput,
  WorkflowRow,
  WorkflowTrashRow,
} from "./types.js";

export class WorkflowMethods extends ClusterMethods {
  async listWorkflows(): Promise<{ workflows: WorkflowRow[] }> {
    return workflows.listWorkflows(this.transport);
  }

  async getWorkflow(idOrSlug: string): Promise<WorkflowDetail> {
    return workflows.getWorkflow(this.transport, idOrSlug);
  }

  async createWorkflow(name: string): Promise<WorkflowRow> {
    return workflows.createWorkflow(this.transport, name);
  }

  async updateWorkflow(
    idOrSlug: string,
    updates: {
      name?: string;
      description?: string | null;
      /** Cluster UUID to group this workflow under, or null to ungroup. */
      clusterId?: string | null;
    }
  ): Promise<WorkflowRow> {
    return workflows.updateWorkflow(this.transport, idOrSlug, updates);
  }

  async deleteWorkflow(idOrSlug: string): Promise<void> {
    return workflows.deleteWorkflow(this.transport, idOrSlug);
  }

  /** Workspace-scoped trash — every soft-deleted workflow the caller may see. */
  async listWorkflowTrash(): Promise<{ workflows: WorkflowTrashRow[] }> {
    return workflows.listWorkflowTrash(this.transport);
  }

  /** Restore a soft-deleted workflow (recovery, not deletion). */
  async restoreWorkflow(idOrSlug: string): Promise<WorkflowRow> {
    return workflows.restoreWorkflow(this.transport, idOrSlug);
  }

  // ── Workflow graph authoring ──────────────────────────────────────
  async setWorkflowGraph(
    idOrSlug: string,
    spec: WorkflowGraphSpec
  ): Promise<void> {
    return workflows.setWorkflowGraph(this.transport, idOrSlug, spec);
  }

  async addWorkflowNode(
    idOrSlug: string,
    node: WorkflowNodeInput & { connect_from?: string }
  ): Promise<{ node_id: string }> {
    return workflows.addWorkflowNode(this.transport, idOrSlug, node);
  }

  async updateWorkflowNode(
    idOrSlug: string,
    nodeId: string,
    patch: Partial<WorkflowNodeInput>
  ): Promise<void> {
    return workflows.updateWorkflowNode(this.transport, idOrSlug, nodeId, patch);
  }

  async removeWorkflowNode(idOrSlug: string, nodeId: string): Promise<void> {
    return workflows.removeWorkflowNode(this.transport, idOrSlug, nodeId);
  }

  async connectWorkflow(
    idOrSlug: string,
    from: string,
    to: string,
    condition?: string
  ): Promise<void> {
    return workflows.connectWorkflow(this.transport, idOrSlug, from, to, condition);
  }

  async disconnectWorkflow(
    idOrSlug: string,
    from: string,
    to: string
  ): Promise<void> {
    return workflows.disconnectWorkflow(this.transport, idOrSlug, from, to);
  }
}
