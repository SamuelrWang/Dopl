"use strict";
/**
 * `dopl_workflow` mutating op handlers: create, update, set_graph, the
 * incremental node/edge ops (add_node/update_node/remove_node/connect/
 * disconnect), set_cluster, and restore_workflow (recovery). Each maps a
 * backend 404 to actionable "no such workflow/step/edge" guidance. Routed
 * from the registrar in workflow.ts.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.opCreate = opCreate;
exports.opUpdate = opUpdate;
exports.opSetGraph = opSetGraph;
exports.opAddNode = opAddNode;
exports.opUpdateNode = opUpdateNode;
exports.opRemoveNode = opRemoveNode;
exports.opConnect = opConnect;
exports.opDisconnect = opDisconnect;
exports.opSetCluster = opSetCluster;
exports.opRestoreWorkflow = opRestoreWorkflow;
const respond_1 = require("./respond");
const workflow_render_1 = require("./workflow-render");
async function opCreate(client, name) {
    const wf = await client.createWorkflow(name);
    return (0, respond_1.ok)(`Created workflow **${wf.name}** (slug: \`${wf.slug}\`). Now author its graph with op="set_graph" (or add_node + connect), then op="get" to verify.`);
}
async function opUpdate(client, slug, name, description) {
    let wf;
    try {
        wf = await client.updateWorkflow(slug, { name, description });
    }
    catch (e) {
        if ((0, respond_1.isNotFound)(e))
            return (0, workflow_render_1.workflowNotFound)(slug);
        throw e;
    }
    return (0, respond_1.ok)(`Updated workflow **${wf.name}** (slug: \`${wf.slug}\`).`);
}
async function opSetGraph(client, slug, graph) {
    // ref is required for every node in set_graph.
    for (const n of graph.nodes) {
        if (!n.ref)
            return (0, respond_1.err)("Every node in `graph.nodes` needs a `ref`.");
    }
    try {
        await client.setWorkflowGraph(slug, graph);
    }
    catch (e) {
        if ((0, respond_1.isNotFound)(e))
            return (0, workflow_render_1.workflowNotFound)(slug);
        throw e;
    }
    return (0, respond_1.ok)(`Set workflow \`${slug}\` graph: ${graph.nodes.length} step(s), ${graph.edges.length} edge(s). Run op="get" to see the ordered steps.`);
}
async function opAddNode(client, slug, node, connectFrom) {
    const payload = { ...node, connect_from: connectFrom };
    const { node_id } = await client.addWorkflowNode(slug, payload);
    return (0, respond_1.ok)(`Added step \`${node_id}\` to workflow \`${slug}\`${connectFrom ? ` (connected from ${connectFrom})` : " (entry step)"}.`);
}
async function opUpdateNode(client, slug, nodeId, node) {
    try {
        await client.updateWorkflowNode(slug, nodeId, node);
    }
    catch (e) {
        if ((0, respond_1.isNotFound)(e)) {
            return (0, respond_1.err)(`Couldn't update step \`${nodeId}\` — workflow \`${slug}\` or that step doesn't exist. Run dopl_workflow(op="get", slug="${slug}") to see step ids, or op="list" for workflows.`);
        }
        throw e;
    }
    return (0, respond_1.ok)(`Updated step \`${nodeId}\` in workflow \`${slug}\`.`);
}
async function opRemoveNode(client, slug, nodeId) {
    try {
        await client.removeWorkflowNode(slug, nodeId);
    }
    catch (e) {
        if ((0, respond_1.isNotFound)(e)) {
            return (0, respond_1.err)(`Couldn't remove step \`${nodeId}\` — workflow \`${slug}\` or that step doesn't exist. Run dopl_workflow(op="get", slug="${slug}") to see step ids, or op="list" for workflows.`);
        }
        throw e;
    }
    return (0, respond_1.ok)(`Removed step \`${nodeId}\` from workflow \`${slug}\`.`);
}
async function opConnect(client, slug, from, to, condition) {
    try {
        await client.connectWorkflow(slug, from, to, condition);
    }
    catch (e) {
        if ((0, respond_1.isNotFound)(e)) {
            return (0, respond_1.err)(`Couldn't connect \`${from}\` → \`${to}\` — workflow \`${slug}\` or one of those steps doesn't exist. Run dopl_workflow(op="get", slug="${slug}") to see step ids, or op="list" for workflows.`);
        }
        throw e;
    }
    return (0, respond_1.ok)(`Connected \`${from}\` → \`${to}\` in workflow \`${slug}\`${condition ? ` when ${condition}` : ""}.`);
}
async function opDisconnect(client, slug, from, to) {
    try {
        await client.disconnectWorkflow(slug, from, to);
    }
    catch (e) {
        // Backend now 404s when no such edge existed; report that instead of a
        // false "disconnected" success the author would trust.
        if ((0, respond_1.isNotFound)(e)) {
            return (0, respond_1.err)(`No edge \`${from}\` → \`${to}\` in workflow \`${slug}\` — nothing disconnected. Run op="get" to see current connections.`);
        }
        throw e;
    }
    return (0, respond_1.ok)(`Disconnected \`${from}\` → \`${to}\` in workflow \`${slug}\`.`);
}
async function opSetCluster(client, slug, cluster) {
    // Empty / omitted → ungroup the workflow.
    if (!cluster || !cluster.trim()) {
        let wf;
        try {
            wf = await client.updateWorkflow(slug, { clusterId: null });
        }
        catch (e) {
            if ((0, respond_1.isNotFound)(e))
                return (0, workflow_render_1.workflowNotFound)(slug);
            throw e;
        }
        return (0, respond_1.ok)(`Workflow **${wf.name}** (slug: \`${wf.slug}\`) is now ungrouped (no cluster).`);
    }
    // The API takes a cluster UUID; agents hold slugs, so resolve slug-or-id
    // → id via the cluster list.
    const { clusters } = await client.listClusters();
    const match = clusters.find((c) => c.id === cluster || c.slug === cluster);
    if (!match) {
        return (0, respond_1.err)(`Cluster not found: \`${cluster}\`. Run dopl_cluster(op="list") to see valid clusters.`);
    }
    let wf;
    try {
        wf = await client.updateWorkflow(slug, { clusterId: match.id });
    }
    catch (e) {
        if ((0, respond_1.isNotFound)(e))
            return (0, workflow_render_1.workflowNotFound)(slug);
        throw e;
    }
    return (0, respond_1.ok)(`Grouped workflow **${wf.name}** (slug: \`${wf.slug}\`) under cluster **${match.name}** (slug: \`${match.slug}\`).`);
}
async function opRestoreWorkflow(client, slug) {
    let wf;
    try {
        wf = await client.restoreWorkflow(slug);
    }
    catch (e) {
        // 404 = nothing in trash matched. Point at the trash listing, not
        // op="list" (which only shows live workflows).
        if ((0, respond_1.isNotFound)(e)) {
            return (0, respond_1.err)(`No deleted workflow matches \`${slug}\`. Run dopl_workflow(op="list_trash") to see restorable workflows; it may already be active.`);
        }
        throw e;
    }
    return (0, respond_1.ok)(`Restored workflow **${wf.name}** (slug: \`${wf.slug}\`). Its steps + edges are back — run op="get" to verify.`);
}
