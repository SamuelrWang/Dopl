/**
 * Live smoke test for new-workspace seeding: creates a disposable user +
 * workspace through the REAL creation path (createWorkspaceForUser →
 * seedNewWorkspace), verifies every seeded surface + cross-refs, then
 * cleans up.
 *
 * Run:  set -a; source .env.local; set +a; \
 *       NODE_OPTIONS="--require $PWD/scripts/stub-server-only.cjs" npx tsx scripts/smoke-seed.mts
 */
import { createClient } from "@supabase/supabase-js";
import { createWorkspaceForUser } from "../src/features/workspaces/server/service";
import { composeWorkflow } from "../src/features/workflows/server/graph";

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

async function countRows(table: string, wsId: string): Promise<number> {
  const { count, error } = await admin
    .from(table)
    .select("*", { count: "exact", head: true })
    .eq("workspace_id", wsId);
  if (error) throw new Error(`${table}: ${error.message}`);
  return count ?? 0;
}

async function main() {
  console.log("== fixtures ==");
  const stamp = Math.random().toString(36).slice(2, 8);
  const { data: u, error: uErr } = await admin.auth.admin.createUser({
    email: `smoke-seed-${stamp}@example.com`,
    email_confirm: true,
  });
  if (uErr || !u.user) throw new Error(`createUser: ${uErr?.message}`);
  const userId = u.user.id;

  let wsId = "";
  try {
    console.log("== 1. create workspace through the real path ==");
    const ws = await createWorkspaceForUser(userId, { name: "Smoke Seed Test" });
    wsId = ws.id;
    check("workspace created", Boolean(wsId));

    console.log("== 2. per-table seed counts ==");
    const expected: ReadonlyArray<readonly [string, number]> = [
      ["knowledge_bases", 1],
      ["knowledge_entries", 5],
      ["skills", 4],
      ["ontology_clusters", 1],
      ["ontology_objects", 9],
      ["ontology_memberships", 9],
      ["ontology_relationships", 4],
      ["workflows", 1],
      ["workflow_steps", 5],
      ["workflow_step_edges", 5],
      ["workflow_knowledge_bases", 1],
      ["workflow_skills", 3],
      ["chats", 1],
      ["chat_messages", 4],
    ];
    for (const [table, n] of expected) {
      const got = await countRows(table, wsId);
      check(`${table} = ${n}`, got === n, `got ${got}`);
    }

    console.log("== 3. cross-refs resolve to real rows ==");
    const { data: skills, error: skillsErr } = await admin
      .from("skills")
      .select("id, slug")
      .eq("workspace_id", wsId);
    if (skillsErr) throw new Error(`skills fetch: ${skillsErr.message}`);
    const { data: entries, error: entriesErr } = await admin
      .from("knowledge_entries")
      .select("id")
      .eq("workspace_id", wsId);
    if (entriesErr) throw new Error(`entries fetch: ${entriesErr.message}`);
    const skillIds = new Set((skills ?? []).map((s) => s.id));
    const entryIds = new Set((entries ?? []).map((e) => e.id));
    check("fetched skill/entry id pools", skillIds.size === 4 && entryIds.size === 5, `${skillIds.size}/${entryIds.size}`);

    const { data: objects } = await admin
      .from("ontology_objects")
      .select("name, attributes")
      .eq("workspace_id", wsId);
    let refAttrs = 0;
    let danglingRefs = 0;
    type SeedAttr = { value?: { kind?: string; value?: unknown } };
    for (const o of objects ?? []) {
      for (const attr of (o.attributes as SeedAttr[]) ?? []) {
        const v = attr.value;
        if (v?.kind === "skill" || v?.kind === "knowledge") {
          refAttrs++;
          const ids = Array.isArray(v.value) ? v.value : [v.value];
          for (const id of ids) {
            const pool = v.kind === "skill" ? skillIds : entryIds;
            if (typeof id === "string" && !pool.has(id)) danglingRefs++;
          }
        }
      }
    }
    check("ontology objects carry skill/knowledge ref attrs", refAttrs >= 6, String(refAttrs));
    check("no dangling ontology refs", danglingRefs === 0, String(danglingRefs));

    const { data: wf } = await admin
      .from("workflows")
      .select("id, slug")
      .eq("workspace_id", wsId)
      .single();
    const graph = await composeWorkflow(wsId, wf!.id);
    check("workflow: 5 steps topo-composed", graph.nodes.length === 5);
    const conditions = graph.edges.filter((e) => e.condition !== "").length;
    check("workflow: branch conditions present", conditions >= 2, String(conditions));
    let danglingStepRefs = 0;
    for (const step of graph.nodes) {
      for (const r of step.reads) if (r.entryId && !entryIds.has(r.entryId)) danglingStepRefs++;
      for (const a of step.actions) if (!skillIds.has(a.skillId)) danglingStepRefs++;
    }
    check("workflow reads/actions resolve", danglingStepRefs === 0, String(danglingStepRefs));

    console.log("== 4. idempotency: re-seed is a no-op ==");
    const { seedNewWorkspace } = await import(
      "../src/features/workspaces/server/seed-workspace"
    );
    await seedNewWorkspace(wsId, userId);
    const kbAfter = await countRows("knowledge_bases", wsId);
    const objAfter = await countRows("ontology_objects", wsId);
    check("re-seed: still 1 KB / 9 objects", kbAfter === 1 && objAfter === 9, `${kbAfter}/${objAfter}`);
  } finally {
    console.log("== cleanup ==");
    if (wsId) await admin.from("workspaces").delete().eq("id", wsId);
    await admin.auth.admin.deleteUser(userId).catch(() => {});
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

main().catch((e) => {
  console.error("SMOKE CRASH:", e);
  process.exit(1);
});
