/**
 * Live smoke test for the rebuilt workflows backend: runs the REAL
 * compose/authoring code against the live DB using disposable fixtures
 * (throwaway user + workspace + workflow), and read-only checks the
 * ported production graph. Cleans up after itself.
 *
 * Run:  set -a; source .env.local; set +a; \
 *       NODE_OPTIONS="--require $PWD/scripts/stub-server-only.cjs" npx tsx scripts/smoke-workflows.mts
 */
import { createClient } from "@supabase/supabase-js";
import { composeWorkflow } from "../src/features/workflows/server/graph";
import {
  setGraph,
  addNode,
  connect,
  disconnect,
  removeNode,
} from "../src/features/workflows/server/authoring";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

let pass = 0;
let fail = 0;
function check(name: string, ok: boolean, detail = "") {
  if (ok) {
    pass++;
    console.log(`  PASS  ${name}`);
  } else {
    fail++;
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

async function expectHttpError(name: string, code: string, fn: () => Promise<unknown>) {
  try {
    await fn();
    check(name, false, "no throw");
  } catch (e) {
    const c = (e as { code?: string }).code ?? (e as Error).message;
    check(name, c === code, String(c));
  }
}

async function main() {
  console.log("== 0. ported production graph (read-only) ==");
  const { data: wf } = await admin
    .from("workflows")
    .select("id, workspace_id, slug")
    .eq("slug", "cluster-8")
    .single();
  if (!wf) throw new Error("cluster-8 workflow not found");
  const ported = await composeWorkflow(wf.workspace_id, wf.id);
  check("cluster-8 composes: 3 steps", ported.nodes.length === 3, String(ported.nodes.length));
  check("cluster-8: 2 edges", ported.edges.length === 2, String(ported.edges.length));
  const ids = new Set(ported.nodes.map((n) => n.id));
  check(
    "topo order: every edge points forward",
    ported.edges.every((e) => {
      const fi = ported.nodes.findIndex((n) => n.id === e.from);
      const ti = ported.nodes.findIndex((n) => n.id === e.to);
      return fi >= 0 && ti >= 0 && fi < ti;
    })
  );
  check("edge endpoints all exist", ported.edges.every((e) => ids.has(e.from) && ids.has(e.to)));

  console.log("== fixtures ==");
  const stamp = Math.random().toString(36).slice(2, 8);
  const { data: u, error: uErr } = await admin.auth.admin.createUser({
    email: `smoke-workflows-${stamp}@example.com`,
    email_confirm: true,
  });
  if (uErr || !u.user) throw new Error(`createUser: ${uErr?.message}`);
  const userId = u.user.id;
  const { data: ws, error: wsErr } = await admin
    .from("workspaces")
    .insert({
      owner_id: userId,
      name: "Smoke Workflows",
      slug: `smoke-workflows-${stamp}`,
      public_id: `smokew${stamp}`,
    })
    .select("id")
    .single();
  if (wsErr || !ws) throw new Error(`workspace: ${wsErr?.message}`);
  const wsId = ws.id as string;
  await admin.from("workspace_members").insert({
    workspace_id: wsId,
    user_id: userId,
    role: "owner",
    status: "active",
  });
  const { data: tw, error: twErr } = await admin
    .from("workflows")
    .insert({ workspace_id: wsId, user_id: userId, name: "Smoke Flow", slug: `smoke-flow-${stamp}` })
    .select("id")
    .single();
  if (twErr || !tw) throw new Error(`workflow: ${twErr?.message}`);
  const wfId = tw.id as string;
  const scope = { workspaceId: wsId, userId, role: "owner" as const, source: "user" as const };

  const cleanup = async () => {
    await admin.from("workspaces").delete().eq("id", wsId);
    await admin.auth.admin.deleteUser(userId).catch(() => {});
  };

  try {
    console.log("== 1. set_graph: branched DAG ==");
    await setGraph(
      wfId,
      {
        nodes: [
          { ref: "triage", title: "Triage the lead" },
          { ref: "draft", title: "Draft intro" },
          { ref: "nurture", title: "Add to nurture" },
          { ref: "log", title: "Log outcome" },
        ],
        edges: [
          { from: "triage", to: "draft", condition: "qualified" },
          { from: "triage", to: "nurture", condition: "not a fit yet" },
          { from: "draft", to: "log" },
          { from: "nurture", to: "log" },
        ],
      },
      scope
    );
    let g = await composeWorkflow(wsId, wfId);
    check("4 steps, 4 edges", g.nodes.length === 4 && g.edges.length === 4);
    check("entry = triage (topo first)", g.nodes[0]?.ref === "triage", g.nodes[0]?.ref);
    check(
      "branch conditions persisted",
      g.edges.some((e) => e.condition === "qualified") &&
        g.edges.some((e) => e.condition === "not a fit yet")
    );
    check("merge lands last (log)", g.nodes[g.nodes.length - 1]?.ref === "log");

    console.log("== 2. invariants ==");
    const logId = g.nodes.find((n) => n.ref === "log")!.id;
    await expectHttpError("cycle rejected (log → triage)", "WORKFLOW_CYCLE", () =>
      connect(wfId, logId, "triage", "", scope)
    );
    await expectHttpError("self-edge rejected", "SELF_EDGE", () =>
      connect(wfId, "draft", "draft", "", scope)
    );
    await expectHttpError("header sentinel rejected", "HEADER_SENTINEL_REMOVED", () =>
      connect(wfId, "header", "draft", "", scope)
    );
    await expectHttpError("duplicate ref rejected", "DUPLICATE_REF", () =>
      addNode(wfId, { ref: "triage", title: "dupe" }, undefined, scope)
    );
    await expectHttpError("connect to missing step 404s", "STEP_NOT_FOUND", () =>
      connect(wfId, "triage", "no-such-ref", "", scope)
    );

    console.log("== 3. incremental authoring ==");
    const newId = await addNode(
      wfId,
      { ref: "followup", title: "Follow up Thursday" },
      "log",
      scope
    );
    check("addNode returns step id", typeof newId === "string" && newId.length > 10);
    g = await composeWorkflow(wsId, wfId);
    check("5 steps after addNode, edge from log", g.edges.some((e) => e.to === newId));

    await disconnect(wfId, "log", "followup", scope);
    g = await composeWorkflow(wsId, wfId);
    check("disconnect removes edge", !g.edges.some((e) => e.to === newId));
    check("disconnected step parked, still present", g.nodes.some((n) => n.id === newId));

    await removeNode(wfId, "nurture", scope);
    g = await composeWorkflow(wsId, wfId);
    check("removeNode cascades its edges", g.nodes.length === 4 && !g.edges.some((e) => e.condition === "not a fit yet"));

    console.log("== 4. set_graph reconcile (update/delete by ref) ==");
    await setGraph(
      wfId,
      {
        nodes: [
          { ref: "triage", title: "Triage the lead (v2)" },
          { ref: "draft", title: "Draft intro" },
        ],
        edges: [{ from: "triage", to: "draft" }],
      },
      scope
    );
    g = await composeWorkflow(wsId, wfId);
    check("reconcile: 2 steps remain", g.nodes.length === 2, String(g.nodes.length));
    check("reconcile: title updated in place", g.nodes[0]?.title === "Triage the lead (v2)");

    console.log("== 5. delete workflow cascades ==");
    await admin.from("workflows").delete().eq("id", wfId);
    const { count: stepCount } = await admin
      .from("workflow_steps")
      .select("id", { count: "exact", head: true })
      .eq("workflow_id", wfId);
    check("steps cascade on workflow delete", stepCount === 0, String(stepCount));
  } finally {
    console.log("== cleanup ==");
    await cleanup();
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

main().catch((e) => {
  console.error("SMOKE CRASH:", e);
  process.exit(1);
});
