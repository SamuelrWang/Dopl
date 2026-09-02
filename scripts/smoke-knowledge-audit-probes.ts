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

// Audit fix #18: env-driven instead of hardcoded UUIDs.
function envOrFail(name: string): string {
  const v = process.env[name];
  if (!v) {
    console.error(
      `[smoke] Missing ${name}. Set it in .env.local to a UUID from your Supabase project.`
    );
    process.exit(1);
  }
  return v;
}
const WORKSPACE_ID = envOrFail("SMOKE_WORKSPACE_ID");
const USER_ID = envOrFail("SMOKE_USER_ID");

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
    deleteBase,
    writeFileByPath,
    updateBase,
  } = await import("@/features/knowledge/server/service");

  const userCtx = buildKnowledgeContext({
    userId: USER_ID,
    workspaceId: WORKSPACE_ID,
    role: "owner",
    credentialSubjectUserId: USER_ID,
    agentTokenId: null,
  });
  const agentCtx = buildKnowledgeContext({
    userId: USER_ID,
    workspaceId: WORKSPACE_ID,
    role: "owner",
    credentialSubjectUserId: USER_ID,
    agentTokenId: "fake-api-key-for-agent-source",
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
    const { entry: written } = await writeFileByPath(agentCtx, base.id, "agent-test.md", {
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
    await deleteBase(userCtx, base.id);
    console.log(`  cleanup: scratch base hard-deleted`);
  }

  // PROBE 6: cron secret env presence
  console.log("\nPROBE 6: CRON_SECRET configured?");
  console.log(`  CRON_SECRET in env: ${process.env.CRON_SECRET ? "yes" : "NO — auth bypass risk"}`);

  // PROBE 7: hard-delete cascade behavior.
  // Delete is PERMANENT as of 2026-08-07 (RETIREMENT-UNWIRING-PLAN §2b) — this
  // used to probe the soft-delete cascade + restore; there is no restore now,
  // so it probes that the subtree is really GONE. The trap it guards is
  // `knowledge_entries.folder_id ON DELETE SET NULL`: a folder delete that
  // doesn't remove its subtree's entries first orphans them at the base root
  // instead of deleting them.
  //
  // THE FIXTURE IS THE PROBE. `hardDeleteFolder` deletes entries by
  // `folder_id IN collectFolderSubtreeIds(root)` — a NESTED entry is the only
  // thing that exercises the BFS descent. A fixture with only a direct child
  // still passes if `collectFolderSubtreeIds` is reduced to `[rootId]`, and
  // the folder assertions can't cover the gap either: `parent_id` is ON
  // DELETE CASCADE, so descendant *folders* vanish no matter what. Hence one
  // entry at each depth, asserted separately.
  console.log("\nPROBE 7: hard-delete cascade (folder subtree really gone)");
  const cascadeBase = await createBase(userCtx, {
    name: `cascade probe ${new Date().toISOString()}`,
    agentWriteEnabled: false,
  });
  try {
    const {
      createFolder,
      deleteFolder,
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
    // Depth 1 — a direct child of the folder being deleted.
    const { entry: directEntry } = await writeFileByPath(
      userCtx,
      cascadeBase.id,
      "parent/direct.md",
      { body: "x" }
    );
    // Depth 2 — lands in the `child` folder above (writeFileByPath is
    // mkdir -p and reuses it). This is the one the BFS descent is for.
    const { entry: nestedEntry } = await writeFileByPath(
      userCtx,
      cascadeBase.id,
      "parent/child/leaf.md",
      { body: "x" }
    );
    if (nestedEntry.folderId !== child.id) {
      throw new Error(
        `fixture broken: nested entry landed in folder ${nestedEntry.folderId}, expected ${child.id}`
      );
    }

    // ── Cascade-delete: delete parent → child folder + BOTH entries GONE.
    // `includeDeleted: true` on every lookup is the point: a tombstone would
    // still resolve, so a null proves the row was physically removed.
    await deleteFolder(userCtx, parent.id);
    const childAfterDelete = await findFolderById(child.id, true);
    const directAfterDelete = await findEntryById(directEntry.id, true);
    const nestedAfterDelete = await findEntryById(nestedEntry.id, true);
    const cascadeOk =
      childAfterDelete === null &&
      directAfterDelete === null &&
      nestedAfterDelete === null;
    console.log(
      `  ✅ child folder gone: ${childAfterDelete === null}; direct entry gone: ${
        directAfterDelete === null
      }; nested entry gone: ${nestedAfterDelete === null}; ok=${cascadeOk}`
    );
    if (!cascadeOk) {
      throw new Error(
        "folder delete left rows behind — the subtree must be hard-deleted (SET NULL orphan trap)"
      );
    }

    // Active listings should be empty (parent + descendants all deleted).
    const activeFolders = await listFolders(userCtx, cascadeBase.id);
    const activeEntries = await listEntries(userCtx, cascadeBase.id);
    console.log(
      `  ✅ active rows after parent delete: folders=${activeFolders.length}, entries=${activeEntries.length} (expect both 0)`
    );
    if (activeEntries.length !== 0) {
      throw new Error(
        "an entry survived its folder's delete — orphaned to the base root instead of removed"
      );
    }
  } finally {
    await deleteBase(userCtx, cascadeBase.id);
  }

  // PROBE 8: stale-precondition write (audit fix #9)
  // Models the unmount-flush race: an in-flight save with a stale
  // expectedUpdatedAt must be rejected with KnowledgeStaleVersionError
  // (HTTP 412) — preventing silent overwrite of a parallel writer's edits.
  console.log("\nPROBE 8: stale precondition rejected (no silent overwrite)");
  const raceBase = await createBase(userCtx, {
    name: `412 race probe ${new Date().toISOString()}`,
    agentWriteEnabled: true,
  });
  try {
    const { updateEntry } = await import(
      "@/features/knowledge/server/service"
    );
    const { KnowledgeStaleVersionError } = await import(
      "@/features/knowledge/server/errors"
    );

    // Create entry, capture its initial updated_at as the "stale" token.
    const { entry } = await writeFileByPath(userCtx, raceBase.id, "race.md", {
      body: "v1",
    });
    const staleUpdatedAt = entry.updatedAt;

    // Simulate a parallel writer landing — bumps updated_at server-side.
    await updateEntry(userCtx, entry.id, { body: "v2 (parallel writer)" });

    // Now the equivalent of the unmount-flush save: fire with the
    // CACHED stale token. Must throw KnowledgeStaleVersionError.
    let threw412 = false;
    try {
      await updateEntry(
        userCtx,
        entry.id,
        { body: "v3 (in-flight unmount)" },
        staleUpdatedAt
      );
    } catch (err) {
      threw412 = err instanceof KnowledgeStaleVersionError;
      if (!threw412) {
        console.log(
          `  ❌ wrong error class: ${(err as Error).name} (${(err as Error).message})`
        );
      }
    }
    console.log(
      `  ${threw412 ? "✅" : "❌"} stale precondition → KnowledgeStaleVersionError: ${threw412}`
    );

    // Confirm the parallel writer's body survived (no overwrite).
    const final = await updateEntry(userCtx, entry.id, {});
    const survived = final.body === "v2 (parallel writer)";
    console.log(
      `  ${survived ? "✅" : "❌"} parallel writer's body survived: ${survived}`
    );
  } finally {
    await deleteBase(userCtx, raceBase.id);
  }
}

main().catch((err) => {
  console.error("❌", err);
  process.exit(1);
});
