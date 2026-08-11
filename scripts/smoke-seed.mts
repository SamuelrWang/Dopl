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
    // Mirrors seed-workspace.ts: KB → skills → ontology → chat.
    // Ontology: 1 cluster, 2 column objects + 7 card objects (= 9 objects,
    // 9 memberships), 3 seed relationships that fan out to 4 rows (one row
    // per target — `ritual-upkeep` points at two).
    const expected: ReadonlyArray<readonly [string, number]> = [
      ["knowledge_bases", 1],
      ["knowledge_entries", 5],
      ["skills", 3],
      ["ontology_clusters", 1],
      ["ontology_objects", 9],
      ["ontology_memberships", 9],
      ["ontology_relationships", 4],
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
    check("fetched skill/entry id pools", skillIds.size === 3 && entryIds.size === 5, `${skillIds.size}/${entryIds.size}`);

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
    // 9 link attributes in the seed (4 across Surfaces, 5 across Rituals).
    // `resolveAttributes` DROPS a link attr whose refs didn't resolve, so an
    // exact count is what catches the cross-ref threading silently breaking.
    check("ontology objects carry skill/knowledge ref attrs", refAttrs === 9, String(refAttrs));
    check("no dangling ontology refs", danglingRefs === 0, String(danglingRefs));

    // The only place `seedNewWorkspace` runs twice against a real DB — keep
    // it reachable. Nothing above may throw on a healthy seed, or this block
    // (and the whole idempotency guarantee) silently stops being exercised.
    console.log("== 4. idempotency: re-seed is a no-op ==");
    const { seedNewWorkspace } = await import(
      "../src/features/workspaces/server/seed-workspace"
    );
    const reseed = await seedNewWorkspace(wsId, userId);
    check("re-seed short-circuited on the dopl-guide slug", reseed.seeded === false, JSON.stringify(reseed));
    for (const [table, n] of expected) {
      const got = await countRows(table, wsId);
      check(`re-seed: ${table} still ${n}`, got === n, `got ${got}`);
    }
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
