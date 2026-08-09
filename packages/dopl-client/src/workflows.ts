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
import type {
  WorkflowDetail,
  WorkflowGraphSpec,
  WorkflowNodeInput,
  WorkflowRow,
  WorkflowTrashRow,
} from "./types.js";

const enc = encodeURIComponent;

// ─── Rows ────────────────────────────────────────────────────────────

export async function listWorkflows(
  t: DoplTransport
): Promise<{ workflows: WorkflowRow[] }> {
  return t.request<{ workflows: WorkflowRow[] }>("/api/workflows", {
    toolName: "list_workflows",
  });
}

export async function getWorkflow(
  t: DoplTransport,
  idOrSlug: string
): Promise<WorkflowDetail> {
  return t.request<WorkflowDetail>(`/api/workflows/${enc(idOrSlug)}`, {
    toolName: "get_workflow",
  });
}

export async function createWorkflow(
  t: DoplTransport,
  name: string
): Promise<WorkflowRow> {
  return t.request<WorkflowRow>("/api/workflows", {
    method: "POST",
    toolName: "create_workflow",
    body: { name },
  });
}

export async function updateWorkflow(
  t: DoplTransport,
  idOrSlug: string,
  updates: {
    name?: string;
    description?: string | null;
    /** Cluster UUID to group this workflow under, or null to ungroup. */
    clusterId?: string | null;
  }
): Promise<WorkflowRow> {
  return t.request<WorkflowRow>(`/api/workflows/${enc(idOrSlug)}`, {
    method: "PATCH",
    toolName: "update_workflow",
    body: updates,
  });
}

export async function deleteWorkflow(
  t: DoplTransport,
  idOrSlug: string
): Promise<void> {
  await t.requestNoContent(
    `/api/workflows/${enc(idOrSlug)}`,
    "DELETE",
    "delete_workflow"
  );
}

/** Workspace-scoped trash — every soft-deleted workflow the caller may see. */
export async function listWorkflowTrash(
  t: DoplTransport
): Promise<{ workflows: WorkflowTrashRow[] }> {
  return t.request<{ workflows: WorkflowTrashRow[] }>("/api/workflows/trash", {
    toolName: "list_workflow_trash",
  });
}

/** Restore a soft-deleted workflow (recovery, not deletion). */
export async function restoreWorkflow(
  t: DoplTransport,
  idOrSlug: string
): Promise<WorkflowRow> {
  return t.request<WorkflowRow>(`/api/workflows/${enc(idOrSlug)}/restore`, {
    method: "POST",
    toolName: "restore_workflow",
    body: {},
  });
}

// ─── Graph authoring ─────────────────────────────────────────────────

export async function setWorkflowGraph(
  t: DoplTransport,
  idOrSlug: string,
  spec: WorkflowGraphSpec
): Promise<void> {
  await t.requestNoContent(
    `/api/workflows/${enc(idOrSlug)}/graph`,
    "POST",
    "set_workflow_graph",
    spec
  );
}

export async function addWorkflowNode(
  t: DoplTransport,
  idOrSlug: string,
  node: WorkflowNodeInput & { connect_from?: string }
): Promise<{ node_id: string }> {
  return t.request<{ node_id: string }>(
    `/api/workflows/${enc(idOrSlug)}/nodes`,
    { method: "POST", toolName: "add_workflow_node", body: node }
  );
}

export async function updateWorkflowNode(
  t: DoplTransport,
  idOrSlug: string,
  nodeId: string,
  patch: Partial<WorkflowNodeInput>
): Promise<void> {
  await t.requestNoContent(
    `/api/workflows/${enc(idOrSlug)}/nodes/${enc(nodeId)}`,
    "PATCH",
    "update_workflow_node",
    patch
  );
}

export async function removeWorkflowNode(
  t: DoplTransport,
  idOrSlug: string,
  nodeId: string
): Promise<void> {
  await t.requestNoContent(
    `/api/workflows/${enc(idOrSlug)}/nodes/${enc(nodeId)}`,
    "DELETE",
    "remove_workflow_node"
  );
}

export async function connectWorkflow(
  t: DoplTransport,
  idOrSlug: string,
  from: string,
  to: string,
  condition?: string
): Promise<void> {
  await t.requestNoContent(
    `/api/workflows/${enc(idOrSlug)}/edges`,
    "POST",
    "connect_workflow",
    { from, to, condition }
  );
}

export async function disconnectWorkflow(
  t: DoplTransport,
  idOrSlug: string,
  from: string,
  to: string
): Promise<void> {
  await t.requestNoContent(
    `/api/workflows/${enc(idOrSlug)}/edges`,
    "DELETE",
    "disconnect_workflow",
    { from, to }
  );
}
