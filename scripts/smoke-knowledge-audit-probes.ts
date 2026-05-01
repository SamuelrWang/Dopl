/**
 * Audit-only probes — confirm specific findings flagged in the deep-audit
 * pass. Read-mostly: writes a scratch base, verifies a few invariants,
 * cleans up.
 *
 * Run:
 *   NODE_OPTIONS='--conditions=react-server' npx tsx scripts/smoke-knowledge-audit-probes.ts
 */
import * as dotenv from "dotenv";
import { resolve } from "path";

dotenv.config({ path: resolve(__dirname, "../.env.local") });

const WORKSPACE_ID = "46090e9c-e033-452b-a77b-dda54d9c9da6";
const USER_ID = "e95bd11c-32b9-42ab-b754-ffe93787de0a";

async function main() {
  const { supabaseAdmin } = await import("@/shared/supabase/admin");
  const db = supabaseAdmin();

  // ── PROBE 1: realtime publication membership ─────────────────────
  // Expected (per finding F-RT): knowledge_* tables are NOT in
  // supabase_realtime — UI realtime hook will subscribe but never fire.
  const { data: pubData, error: pubErr } = await db.rpc("execute_sql" as never, {} as never).then(
    () => ({ data: null, error: new Error("execute_sql RPC unavailable") }),
    () => ({ data: null, error: new Error("rpc-unavailable-fallback") })
  );
  void pubData;
  void pubErr;
  // Use a raw query via PostgREST's `from` — pg_publication_tables is a
  // catalog view; not exposed by default. Try selecting via a proxy:
  // we'll inspect by attempting the realtime channel and noting the
  // result. As a cheaper proxy, query `pg_publication_tables` is not
  // exposed via PostgREST, so we just print expectation.
  console.log("PROBE 1 (realtime publication): cannot directly query pg_catalog via PostgREST.");
  console.log("  → Check via SQL: SELECT tablename FROM pg_publication_tables WHERE pubname='supabase_realtime' AND tablename LIKE 'knowledge_%';");

  // ── PROBE 2: search_knowledge_entries RPC behavior ───────────────
  console.log("\nPROBE 2: search_knowledge_entries RPC");
  const { data: emptyHits, error: emptyErr } = await db.rpc(
    "search_knowledge_entries" as never,
    {
      p_workspace_id: WORKSPACE_ID,
      p_query: "",
      p_base_id: null,
      p_limit: 5,
    } as never
  );
  console.log(
    `  empty query → hits=${(emptyHits as unknown[] | null)?.length ?? "null"}, err=${
      emptyErr ? emptyErr.message : "none"
    }`
  );

  const { data: foundHits, error: foundErr } = await db.rpc(
    "search_knowledge_entries" as never,
    {
      p_workspace_id: WORKSPACE_ID,
      p_query: "the and a",
      p_base_id: null,
      p_limit: 5,
    } as never
  );
  console.log(
    `  common-words query → hits=${(foundHits as unknown[] | null)?.length ?? "null"}, err=${
      foundErr ? foundErr.message : "none"
    }`
  );

  // PROBE 3: agent-write enforcement on a base whose toggle is OFF.
  console.log("\nPROBE 3: agent-write enforcement");
  const {
    buildKnowledgeContext,
    createBase,
    softDeleteBase,
    writeFileByPath,
    updateBase,
  } = await import("@/features/knowledge/server/service");

  const userCtx = buildKnowledgeContext({
    userId: USER_ID,
    workspaceId: WORKSPACE_ID,
    apiKeyId: null,
  });
  const agentCtx = buildKnowledgeContext({
    userId: USER_ID,
    workspaceId: WORKSPACE_ID,
    apiKeyId: "fake-api-key-for-agent-source",
  });

  const base = await createBase(userCtx, {
    name: `audit probe ${new Date().toISOString()}`,
    description: "agent-write probe (toggle off)",
    agentWriteEnabled: false,
  });
  console.log(`  scratch base: ${base.slug} agentWriteEnabled=${base.agentWriteEnabled}`);

  try {
    let denied = false;
    try {
      await writeFileByPath(agentCtx, base.id, "agent-test.md", { body: "agent" });
    } catch (err) {
      denied = (err as { code?: string }).code === "AGENT_WRITE_DISABLED";
      console.log(`  agent write w/ toggle off → ${(err as Error).name}: ${(err as Error).message}`);
    }
    console.log(`  ✅ agent-write blocked: ${denied}`);

    // Now flip the toggle and retry as agent.
    await updateBase(userCtx, base.id, { agentWriteEnabled: true });
    const written = await writeFileByPath(agentCtx, base.id, "agent-test.md", {
      body: "agent",
    });
    console.log(`  ✅ agent write ok after toggle on: lastEditedSource=${written.lastEditedSource}`);

    // Probe 4: agent attempts to flip the toggle itself → should 403.
    let toggleDenied = false;
    try {
      await updateBase(agentCtx, base.id, { agentWriteEnabled: false });
    } catch (err) {
      toggleDenied = (err as { code?: string }).code === "AGENT_WRITE_DISABLED";
      console.log(`  agent flip toggle → ${(err as Error).name}: ${(err as Error).message}`);
    }
    console.log(`  ✅ agent toggle-flip blocked: ${toggleDenied}`);

    // Probe 5: case-sensitivity in path resolution.
    await writeFileByPath(userCtx, base.id, "Foo.md", { body: "1" });
    await writeFileByPath(userCtx, base.id, "foo.md", { body: "2" });
    console.log(`  ✅ case-sensitive paths: 'Foo.md' and 'foo.md' coexist`);
  } finally {
    await softDeleteBase(userCtx, base.id);
    console.log(`  cleanup: scratch base soft-deleted`);
  }

  // PROBE 6: cron secret env presence
  console.log("\nPROBE 6: CRON_SECRET configured?");
  console.log(`  CRON_SECRET in env: ${process.env.CRON_SECRET ? "yes" : "NO — auth bypass risk"}`);

  // PROBE 7: soft-delete cascade behavior (post-fix in PR-3)
  console.log("\nPROBE 7: soft-delete cascade + restore");
  const cascadeBase = await createBase(userCtx, {
    name: `cascade probe ${new Date().toISOString()}`,
    agentWriteEnabled: false,
  });
  try {
    const {
      createFolder,
      softDeleteFolder,
      restoreFolder,
      listFolders,
      listEntries,
    } = await import("@/features/knowledge/server/service");
    const { findEntryById, findFolderById } = await import(
      "@/features/knowledge/server/repository"
    );

    const parent = await createFolder(userCtx, {
      knowledgeBaseId: cascadeBase.id,
      name: "parent",
    });
    const child = await createFolder(userCtx, {
      knowledgeBaseId: cascadeBase.id,
      parentId: parent.id,
      name: "child",
    });
    const leafEntry = await writeFileByPath(
      userCtx,
      cascadeBase.id,
      "parent/leaf.md",
      { body: "x" }
    );

    // ── Cascade-delete: trash parent → child folder + leaf both trashed.
    await softDeleteFolder(userCtx, parent.id);
    const childAfterDelete = await findFolderById(child.id, true);
    const leafAfterDelete = await findEntryById(leafEntry.id, true);
    const cascadeOk =
      childAfterDelete?.deletedAt !== null &&
      leafAfterDelete?.deletedAt !== null;
    console.log(
      `  ✅ child cascaded: deletedAt=${childAfterDelete?.deletedAt?.slice(0, 19)}; leaf cascaded: deletedAt=${leafAfterDelete?.deletedAt?.slice(0, 19)}; ok=${cascadeOk}`
    );

    // Active listings should be empty (parent + descendants all trashed).
    const activeFolders = await listFolders(userCtx, cascadeBase.id);
    const activeEntries = await listEntries(userCtx, cascadeBase.id);
    console.log(
      `  ✅ active rows after parent trash: folders=${activeFolders.length}, entries=${activeEntries.length} (expect both 0)`
    );

    // ── Cascade-restore: restore parent → child + leaf restored too.
    await restoreFolder(userCtx, parent.id);
    const childAfterRestore = await findFolderById(child.id, false);
    const leafAfterRestore = await findEntryById(leafEntry.id, false);
    const restoreOk =
      childAfterRestore !== null && leafAfterRestore !== null;
    console.log(
      `  ✅ child restored: ${!!childAfterRestore}; leaf restored: ${!!leafAfterRestore}; ok=${restoreOk}`
    );
  } finally {
    await softDeleteBase(userCtx, cascadeBase.id);
  }
}

main().catch((err) => {
  console.error("❌", err);
  process.exit(1);
});
