"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.listWorkflows = listWorkflows;
exports.getWorkflow = getWorkflow;
exports.createWorkflow = createWorkflow;
exports.updateWorkflow = updateWorkflow;
exports.deleteWorkflow = deleteWorkflow;
exports.listWorkflowTrash = listWorkflowTrash;
exports.restoreWorkflow = restoreWorkflow;
exports.setWorkflowGraph = setWorkflowGraph;
exports.addWorkflowNode = addWorkflowNode;
exports.updateWorkflowNode = updateWorkflowNode;
exports.removeWorkflowNode = removeWorkflowNode;
exports.connectWorkflow = connectWorkflow;
exports.disconnectWorkflow = disconnectWorkflow;
const enc = encodeURIComponent;
// ─── Rows ────────────────────────────────────────────────────────────
async function listWorkflows(t) {
    return t.request("/api/workflows", {
        toolName: "list_workflows",
    });
}
async function getWorkflow(t, idOrSlug) {
    return t.request(`/api/workflows/${enc(idOrSlug)}`, {
        toolName: "get_workflow",
    });
}
async function createWorkflow(t, name) {
    return t.request("/api/workflows", {
        method: "POST",
        toolName: "create_workflow",
        body: { name },
    });
}
async function updateWorkflow(t, idOrSlug, updates) {
    return t.request(`/api/workflows/${enc(idOrSlug)}`, {
        method: "PATCH",
        toolName: "update_workflow",
        body: updates,
    });
}
async function deleteWorkflow(t, idOrSlug) {
    await t.requestNoContent(`/api/workflows/${enc(idOrSlug)}`, "DELETE", "delete_workflow");
}
/** Workspace-scoped trash — every soft-deleted workflow the caller may see. */
async function listWorkflowTrash(t) {
    return t.request("/api/workflows/trash", {
        toolName: "list_workflow_trash",
    });
}
/** Restore a soft-deleted workflow (recovery, not deletion). */
async function restoreWorkflow(t, idOrSlug) {
    return t.request(`/api/workflows/${enc(idOrSlug)}/restore`, {
        method: "POST",
        toolName: "restore_workflow",
        body: {},
    });
}
// ─── Graph authoring ─────────────────────────────────────────────────
async function setWorkflowGraph(t, idOrSlug, spec) {
    await t.requestNoContent(`/api/workflows/${enc(idOrSlug)}/graph`, "POST", "set_workflow_graph", spec);
}
async function addWorkflowNode(t, idOrSlug, node) {
    return t.request(`/api/workflows/${enc(idOrSlug)}/nodes`, { method: "POST", toolName: "add_workflow_node", body: node });
}
async function updateWorkflowNode(t, idOrSlug, nodeId, patch) {
    await t.requestNoContent(`/api/workflows/${enc(idOrSlug)}/nodes/${enc(nodeId)}`, "PATCH", "update_workflow_node", patch);
}
async function removeWorkflowNode(t, idOrSlug, nodeId) {
    await t.requestNoContent(`/api/workflows/${enc(idOrSlug)}/nodes/${enc(nodeId)}`, "DELETE", "remove_workflow_node");
}
async function connectWorkflow(t, idOrSlug, from, to, condition) {
    await t.requestNoContent(`/api/workflows/${enc(idOrSlug)}/edges`, "POST", "connect_workflow", { from, to, condition });
}
async function disconnectWorkflow(t, idOrSlug, from, to) {
    await t.requestNoContent(`/api/workflows/${enc(idOrSlug)}/edges`, "DELETE", "disconnect_workflow", { from, to });
}
