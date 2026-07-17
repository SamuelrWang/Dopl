/**
 * One-off port: copy each workflow's canvas-stored step graph
 * (canvas_panels 'workflow' header + 'node' steps + canvas_edges) into the
 * first-class tables (workflow_steps + workflow_step_edges).
 *
 * Composition replicates the OLD `composeWorkflow` BFS (the feature's
 * copy was rewritten to read the new tables, so the logic is inlined here):
 * undirected reachability from the workflow's header panel over
 * canvas_edges, stopping at OTHER headers, gives the member node panels;
 * edges among those members become step edges. Idempotent — a workflow that
 * already has workflow_steps rows is skipped.
 *
 * Reads the live DB directly via the service-role client; writes only the
 * two new tables. Does NOT touch canvas_panels / canvas_edges (the canvas
 * teardown migration drops those afterward).
 *
 * Run from repo root (the stub-server-only require is a harmless no-op here
 * — this script imports no server-only modules — kept for parity with the
 * smoke scripts):
 *
 *   set -a; source .env.local; set +a; \
 *   NODE_OPTIONS="--require ./scripts/stub-server-only.cjs" \
 *   npx tsx scripts/port-workflows.mts
 */
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
if (!url || !serviceKey) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}
const db = createClient(url, serviceKey, { auth: { persistSession: false } });

interface PanelRow {
  panel_id: string;
  panel_type: string;
  title: string | null;
  panel_data: Record<string, unknown> | null;
  x: number | null;
  y: number | null;
}
interface EdgeRow {
  from_panel_id: string;
  to_panel_id: string;
}

interface ComposedStep {
  panelId: string;
  ref: string;
  title: string;
  description: string;
  reads: unknown[];
  actions: unknown[];
  userInput: string;
  agentOutput: string;
  nextInstructions: string;
  position: number;
}

/** OLD composeWorkflow, inlined: BFS from the header over canvas_edges,
 *  stopping at other headers; members are the reached node panels. */
function composeFromCanvas(
  workflowId: string,
  panels: PanelRow[],
  edges: EdgeRow[]
): { steps: ComposedStep[]; edges: Array<{ from: string; to: string }> } | null {
  const headers = panels.filter((p) => p.panel_type === "workflow");
  const header = headers.find(
    (p) => (p.panel_data as { workflowId?: string } | null)?.workflowId === workflowId
  );
  if (!header) return null;

  const nodeById = new Map(
    panels.filter((p) => p.panel_type === "node").map((p) => [p.panel_id, p])
  );

  const adj = new Map<string, string[]>();
  for (const e of edges) {
    adj.set(e.from_panel_id, [...(adj.get(e.from_panel_id) ?? []), e.to_panel_id]);
    adj.set(e.to_panel_id, [...(adj.get(e.to_panel_id) ?? []), e.from_panel_id]);
  }
  const headerId = header.panel_id;
  const otherHeaderIds = new Set(
    headers.map((h) => h.panel_id).filter((id) => id !== headerId)
  );
  const visited = new Set<string>([headerId]);
  const queue = [headerId];
  while (queue.length) {
    const cur = queue.shift()!;
    for (const nb of adj.get(cur) ?? []) {
      if (visited.has(nb)) continue;
      visited.add(nb);
      if (otherHeaderIds.has(nb)) continue;
      queue.push(nb);
    }
  }

  const memberIds = [...visited].filter((id) => nodeById.has(id));
  const memberSet = new Set(memberIds);
  const memberRows = memberIds.map((id) => nodeById.get(id)!);
  // Spatial order (top→bottom, left→right) → deterministic position hint.
  memberRows.sort((a, b) => (a.y ?? 0) - (b.y ?? 0) || (a.x ?? 0) - (b.x ?? 0));

  const steps: ComposedStep[] = memberRows.map((row, i) => {
    const d = (row.panel_data ?? {}) as Record<string, unknown>;
    return {
      panelId: row.panel_id,
      ref: (d.ref as string) || row.panel_id,
      title: (row.title as string) || "",
      description: (d.description as string) || "",
      reads: Array.isArray(d.reads) ? (d.reads as unknown[]) : [],
      actions: Array.isArray(d.actions) ? (d.actions as unknown[]) : [],
      userInput: (d.userInput as string) || "",
      agentOutput: (d.agentOutput as string) || "",
      nextInstructions: (d.nextInstructions as string) || "",
      position: i,
    };
  });

  const memberEdges = edges
    .filter((e) => memberSet.has(e.from_panel_id) && memberSet.has(e.to_panel_id))
    .map((e) => ({ from: e.from_panel_id, to: e.to_panel_id }));

  return { steps, edges: memberEdges };
}

async function main() {
  const { data: workflows, error: wfErr } = await db
    .from("workflows")
    .select("id, slug, workspace_id");
  if (wfErr) throw new Error(`list workflows: ${wfErr.message}`);

  let ported = 0;
  let skippedExisting = 0;
  let skippedNoGraph = 0;

  for (const wf of workflows ?? []) {
    const workflowId = wf.id as string;
    const workspaceId = wf.workspace_id as string;
    const slug = wf.slug as string;

    // Idempotency: skip if steps already exist for this workflow.
    const { count } = await db
      .from("workflow_steps")
      .select("id", { count: "exact", head: true })
      .eq("workflow_id", workflowId);
    if ((count ?? 0) > 0) {
      console.log(`SKIP (already ported)  ${slug} — ${count} steps`);
      skippedExisting++;
      continue;
    }

    const [{ data: panels }, { data: edges }] = await Promise.all([
      db
        .from("canvas_panels")
        .select("panel_id, panel_type, title, panel_data, x, y")
        .eq("workspace_id", workspaceId)
        .in("panel_type", ["workflow", "node"]),
      db
        .from("canvas_edges")
        .select("from_panel_id, to_panel_id")
        .eq("workspace_id", workspaceId),
    ]);

    const composed = composeFromCanvas(
      workflowId,
      (panels ?? []) as PanelRow[],
      (edges ?? []) as EdgeRow[]
    );
    if (!composed) {
      console.log(`SKIP (no header panel)  ${slug}`);
      skippedNoGraph++;
      continue;
    }
    if (composed.steps.length === 0) {
      console.log(`SKIP (header only, 0 steps)  ${slug}`);
      skippedNoGraph++;
      continue;
    }

    // Insert steps, collecting panel_id → new step uuid.
    const panelToStepId = new Map<string, string>();
    for (const s of composed.steps) {
      const { data, error } = await db
        .from("workflow_steps")
        .insert({
          workflow_id: workflowId,
          workspace_id: workspaceId,
          ref: s.ref,
          title: s.title,
          description: s.description,
          reads: s.reads,
          actions: s.actions,
          user_input: s.userInput,
          agent_output: s.agentOutput,
          next_instructions: s.nextInstructions,
          position: s.position,
        })
        .select("id")
        .single();
      if (error) throw new Error(`insert step ${slug}/${s.ref}: ${error.message}`);
      panelToStepId.set(s.panelId, data.id as string);
    }

    // Insert edges, mapping panel ids → step uuids. Dedup + self-edge guard.
    let edgeCount = 0;
    const seen = new Set<string>();
    for (const e of composed.edges) {
      const from = panelToStepId.get(e.from);
      const to = panelToStepId.get(e.to);
      if (!from || !to || from === to) continue;
      const key = `${from}->${to}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const { error } = await db.from("workflow_step_edges").insert({
        workflow_id: workflowId,
        workspace_id: workspaceId,
        from_step_id: from,
        to_step_id: to,
        condition: "",
      });
      if (error) throw new Error(`insert edge ${slug} ${key}: ${error.message}`);
      edgeCount++;
    }

    console.log(`PORTED  ${slug} — ${composed.steps.length} steps, ${edgeCount} edges`);
    ported++;
  }

  console.log(
    `\nDone. ported=${ported}, skipped_existing=${skippedExisting}, skipped_no_graph=${skippedNoGraph}`
  );
}

main().catch((e) => {
  console.error("PORT CRASH:", e);
  process.exit(1);
});
