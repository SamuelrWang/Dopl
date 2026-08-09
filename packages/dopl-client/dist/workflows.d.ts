/**
 * Workflow methods for `DoplClient` — the row CRUD, the workspace-scoped
 * trash pair, and the graph-authoring surface (nodes + edges). Free
 * functions over `DoplTransport`; the class-side method group is
 * `client-workflows.ts`.
 *
 * `listWorkflowTrash` / `restoreWorkflow` are DELIBERATELY still here.
 * The 2026-08-07 trash teardown removed the knowledge, ontology-cluster and
 * chat trash/restore paths from this package; workflows survived it (D3), and
 * that survival is why the purge migration's workflows step is destructive.
 * They are not dead code — do not "clean them up".
 *
 * Bodies moved verbatim out of `client.ts` in the §2 per-domain split: same
 * routes, same tool names, same 204-vs-JSON choices.
 */
import type { DoplTransport } from "./transport.js";
import type { WorkflowDetail, WorkflowGraphSpec, WorkflowNodeInput, WorkflowRow, WorkflowTrashRow } from "./types.js";
export declare function listWorkflows(t: DoplTransport): Promise<{
    workflows: WorkflowRow[];
}>;
export declare function getWorkflow(t: DoplTransport, idOrSlug: string): Promise<WorkflowDetail>;
export declare function createWorkflow(t: DoplTransport, name: string): Promise<WorkflowRow>;
export declare function updateWorkflow(t: DoplTransport, idOrSlug: string, updates: {
    name?: string;
    description?: string | null;
    /** Cluster UUID to group this workflow under, or null to ungroup. */
    clusterId?: string | null;
}): Promise<WorkflowRow>;
export declare function deleteWorkflow(t: DoplTransport, idOrSlug: string): Promise<void>;
/** Workspace-scoped trash — every soft-deleted workflow the caller may see. */
export declare function listWorkflowTrash(t: DoplTransport): Promise<{
    workflows: WorkflowTrashRow[];
}>;
/** Restore a soft-deleted workflow (recovery, not deletion). */
export declare function restoreWorkflow(t: DoplTransport, idOrSlug: string): Promise<WorkflowRow>;
export declare function setWorkflowGraph(t: DoplTransport, idOrSlug: string, spec: WorkflowGraphSpec): Promise<void>;
export declare function addWorkflowNode(t: DoplTransport, idOrSlug: string, node: WorkflowNodeInput & {
    connect_from?: string;
}): Promise<{
    node_id: string;
}>;
export declare function updateWorkflowNode(t: DoplTransport, idOrSlug: string, nodeId: string, patch: Partial<WorkflowNodeInput>): Promise<void>;
export declare function removeWorkflowNode(t: DoplTransport, idOrSlug: string, nodeId: string): Promise<void>;
export declare function connectWorkflow(t: DoplTransport, idOrSlug: string, from: string, to: string, condition?: string): Promise<void>;
export declare function disconnectWorkflow(t: DoplTransport, idOrSlug: string, from: string, to: string): Promise<void>;
