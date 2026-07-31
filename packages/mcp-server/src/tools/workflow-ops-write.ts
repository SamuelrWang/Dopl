/**
 * `dopl_workflow` mutating op handlers: create, update, set_graph, the
 * incremental node/edge ops (add_node/update_node/remove_node/connect/
 * disconnect), set_cluster, and restore_workflow (recovery). Each maps a
 * backend 404 to actionable "no such workflow/step/edge" guidance. Routed
 * from the registrar in workflow.ts.
 */

import type { DoplClient } from "@dopl/client";
import { ok, err, isNotFound, type ToolResponse } from "./respond";
import { inlineOr } from "./narration";
import { NO_NAME, workflowNotFound } from "./workflow-render";

export async function opCreate(client: DoplClient, name: string): Promise<ToolResponse> {
  const wf = await client.createWorkflow(name);
  return ok(
    `Created workflow ${inlineOr(wf.name, NO_NAME)} (slug: \`${wf.slug}\`). Now author its graph with op="set_graph" (or add_node + connect), then op="get" to verify.`
  );
}

export async function opUpdate(
  client: DoplClient,
  slug: string,
  name: string | undefined,
  description: string | undefined,
): Promise<ToolResponse> {
  let wf;
  try {
    wf = await client.updateWorkflow(slug, { name, description });
  } catch (e) {
    if (isNotFound(e)) return workflowNotFound(slug);
    throw e;
  }
  return ok(`Updated workflow ${inlineOr(wf.name, NO_NAME)} (slug: \`${wf.slug}\`).`);
}

export async function opSetGraph(
  client: DoplClient,
  slug: string,
  graph: { nodes: Array<{ ref?: string }>; edges: Array<{ from: string; to: string; condition?: string }> },
): Promise<ToolResponse> {
  // ref is required for every node in set_graph.
  for (const n of graph.nodes) {
    if (!n.ref) return err("Every node in `graph.nodes` needs a `ref`.");
  }
  try {
    await client.setWorkflowGraph(slug, graph as Parameters<DoplClient["setWorkflowGraph"]>[1]);
  } catch (e) {
    if (isNotFound(e)) return workflowNotFound(slug);
    throw e;
  }
  return ok(
    `Set workflow \`${slug}\` graph: ${graph.nodes.length} step(s), ${graph.edges.length} edge(s). Run op="get" to see the ordered steps.`
  );
}

export async function opAddNode(
  client: DoplClient,
  slug: string,
  node: Record<string, unknown>,
  connectFrom: string | undefined,
): Promise<ToolResponse> {
  const payload = { ...node, connect_from: connectFrom } as unknown as Parameters<
    DoplClient["addWorkflowNode"]
  >[1];
  const { node_id } = await client.addWorkflowNode(slug, payload);
  return ok(
    `Added step \`${node_id}\` to workflow \`${slug}\`${connectFrom ? ` (connected from ${connectFrom})` : " (entry step)"}.`
  );
}

export async function opUpdateNode(
  client: DoplClient,
  slug: string,
  nodeId: string,
  node: Record<string, unknown>,
): Promise<ToolResponse> {
  try {
    await client.updateWorkflowNode(
      slug,
      nodeId,
      node as unknown as Parameters<DoplClient["updateWorkflowNode"]>[2]
    );
  } catch (e) {
    if (isNotFound(e)) {
      return err(
        `Couldn't update step \`${nodeId}\` — workflow \`${slug}\` or that step doesn't exist. Run dopl_workflow(op="get", slug="${slug}") to see step ids, or op="list" for workflows.`,
      );
    }
    throw e;
  }
  return ok(`Updated step \`${nodeId}\` in workflow \`${slug}\`.`);
}

export async function opRemoveNode(
  client: DoplClient,
  slug: string,
  nodeId: string,
): Promise<ToolResponse> {
  try {
    await client.removeWorkflowNode(slug, nodeId);
  } catch (e) {
    if (isNotFound(e)) {
      return err(
        `Couldn't remove step \`${nodeId}\` — workflow \`${slug}\` or that step doesn't exist. Run dopl_workflow(op="get", slug="${slug}") to see step ids, or op="list" for workflows.`,
      );
    }
    throw e;
  }
  return ok(`Removed step \`${nodeId}\` from workflow \`${slug}\`.`);
}

export async function opConnect(
  client: DoplClient,
  slug: string,
  from: string,
  to: string,
  condition: string | undefined,
): Promise<ToolResponse> {
  try {
    await client.connectWorkflow(slug, from, to, condition);
  } catch (e) {
    if (isNotFound(e)) {
      return err(
        `Couldn't connect \`${from}\` → \`${to}\` — workflow \`${slug}\` or one of those steps doesn't exist. Run dopl_workflow(op="get", slug="${slug}") to see step ids, or op="list" for workflows.`,
      );
    }
    throw e;
  }
  return ok(
    `Connected \`${from}\` → \`${to}\` in workflow \`${slug}\`${condition ? ` when ${condition}` : ""}.`
  );
}

export async function opDisconnect(
  client: DoplClient,
  slug: string,
  from: string,
  to: string,
): Promise<ToolResponse> {
  try {
    await client.disconnectWorkflow(slug, from, to);
  } catch (e) {
    // Backend now 404s when no such edge existed; report that instead of a
    // false "disconnected" success the author would trust.
    if (isNotFound(e)) {
      return err(
        `No edge \`${from}\` → \`${to}\` in workflow \`${slug}\` — nothing disconnected. Run op="get" to see current connections.`,
      );
    }
    throw e;
  }
  return ok(`Disconnected \`${from}\` → \`${to}\` in workflow \`${slug}\`.`);
}

export async function opSetCluster(
  client: DoplClient,
  slug: string,
  cluster: string | undefined,
): Promise<ToolResponse> {
  // Empty / omitted → ungroup the workflow.
  if (!cluster || !cluster.trim()) {
    let wf;
    try {
      wf = await client.updateWorkflow(slug, { clusterId: null });
    } catch (e) {
      if (isNotFound(e)) return workflowNotFound(slug);
      throw e;
    }
    return ok(`Workflow ${inlineOr(wf.name, NO_NAME)} (slug: \`${wf.slug}\`) is now ungrouped (no cluster).`);
  }
  // The API takes a cluster UUID; agents hold slugs, so resolve slug-or-id
  // → id via the cluster list.
  const { clusters } = await client.listClusters();
  const match = clusters.find((c) => c.id === cluster || c.slug === cluster);
  if (!match) {
    return err(
      `Cluster not found: \`${cluster}\`. Run dopl_cluster(op="list") to see valid clusters.`,
    );
  }
  let wf;
  try {
    wf = await client.updateWorkflow(slug, { clusterId: match.id });
  } catch (e) {
    if (isNotFound(e)) return workflowNotFound(slug);
    throw e;
  }
  return ok(
    `Grouped workflow ${inlineOr(wf.name, NO_NAME)} (slug: \`${wf.slug}\`) under cluster ${inlineOr(match.name, NO_NAME)} (slug: \`${match.slug}\`).`,
  );
}

export async function opRestoreWorkflow(
  client: DoplClient,
  slug: string,
): Promise<ToolResponse> {
  let wf;
  try {
    wf = await client.restoreWorkflow(slug);
  } catch (e) {
    // 404 = nothing in trash matched. Point at the trash listing, not
    // op="list" (which only shows live workflows).
    if (isNotFound(e)) {
      return err(
        `No deleted workflow matches \`${slug}\`. Run dopl_workflow(op="list_trash") to see restorable workflows; it may already be active.`,
      );
    }
    throw e;
  }
  return ok(
    `Restored workflow ${inlineOr(wf.name, NO_NAME)} (slug: \`${wf.slug}\`). Its steps + edges are back — run op="get" to verify.`,
  );
}
