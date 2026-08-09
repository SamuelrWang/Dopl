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
import type { WorkflowDetail, WorkflowGraphSpec, WorkflowNodeInput, WorkflowRow, WorkflowTrashRow } from "./types.js";
export declare class WorkflowMethods extends ClusterMethods {
    listWorkflows(): Promise<{
        workflows: WorkflowRow[];
    }>;
    getWorkflow(idOrSlug: string): Promise<WorkflowDetail>;
    createWorkflow(name: string): Promise<WorkflowRow>;
    updateWorkflow(idOrSlug: string, updates: {
        name?: string;
        description?: string | null;
        /** Cluster UUID to group this workflow under, or null to ungroup. */
        clusterId?: string | null;
    }): Promise<WorkflowRow>;
    deleteWorkflow(idOrSlug: string): Promise<void>;
    /** Workspace-scoped trash — every soft-deleted workflow the caller may see. */
    listWorkflowTrash(): Promise<{
        workflows: WorkflowTrashRow[];
    }>;
    /** Restore a soft-deleted workflow (recovery, not deletion). */
    restoreWorkflow(idOrSlug: string): Promise<WorkflowRow>;
    setWorkflowGraph(idOrSlug: string, spec: WorkflowGraphSpec): Promise<void>;
    addWorkflowNode(idOrSlug: string, node: WorkflowNodeInput & {
        connect_from?: string;
    }): Promise<{
        node_id: string;
    }>;
    updateWorkflowNode(idOrSlug: string, nodeId: string, patch: Partial<WorkflowNodeInput>): Promise<void>;
    removeWorkflowNode(idOrSlug: string, nodeId: string): Promise<void>;
    connectWorkflow(idOrSlug: string, from: string, to: string, condition?: string): Promise<void>;
    disconnectWorkflow(idOrSlug: string, from: string, to: string): Promise<void>;
}
