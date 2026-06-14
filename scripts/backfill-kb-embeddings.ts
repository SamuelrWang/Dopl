/**
 * Backfill semantic-search embeddings for existing knowledge entries.
 * Idempotent — `syncEntryEmbeddings` hashes per chunk, so re-runs only
 * embed content that changed (or was never embedded).
 *
 * Usage:
 *   NODE_OPTIONS='--conditions=react-server' npx tsx scripts/backfill-kb-embeddings.ts            # all workspaces
 *   NODE_OPTIONS='--conditions=react-server' npx tsx scripts/backfill-kb-embeddings.ts --workspace=<uuid>
 *
 * Requires OPENAI_API_KEY + Supabase service credentials in .env.local.
 * New/edited entries embed automatically (after()-scheduled sync in the
 * knowledge service) — this script exists only for pre-feature rows.
 */
import * as dotenv from "dotenv";
import { resolve } from "path";

dotenv.config({ path: resolve(__dirname, "../.env.local") });

if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local");
  process.exit(1);
}
if (!process.env.OPENAI_API_KEY) {
  console.error("Missing OPENAI_API_KEY in .env.local — nothing to backfill with.");
  process.exit(1);
}

async function main() {
  // Dynamic imports AFTER dotenv so module-level env reads see values.
  const { supabaseAdmin } = await import("../src/shared/supabase/admin");
  const { syncEntryEmbeddings } = await import(
    "../src/features/knowledge/server/embeddings"
  );
  const { mapEntryRow } = await import(
    "../src/features/knowledge/server/dto"
  );

  const workspaceArg = process.argv
    .find((a) => a.startsWith("--workspace="))
    ?.split("=")[1];

  const db = supabaseAdmin();
  const pageSize = 200;
  let offset = 0;
  let done = 0;
  let failed = 0;

  for (;;) {
    let query = db
      .from("knowledge_entries")
      .select("*")
      .is("deleted_at", null)
      .order("id", { ascending: true })
      .range(offset, offset + pageSize - 1);
    if (workspaceArg) query = query.eq("workspace_id", workspaceArg);
    const { data, error } = await query;
    if (error) throw error;
    const rows = data ?? [];
    if (rows.length === 0) break;

    for (const row of rows) {
      const entry = mapEntryRow(row);
      try {
        await syncEntryEmbeddings(entry);
        done += 1;
        if (done % 25 === 0) console.log(`  …${done} entries synced`);
      } catch (err) {
        failed += 1;
        console.error(`  ✗ ${entry.id} (${entry.title}):`, (err as Error).message);
      }
    }
    offset += pageSize;
  }

  console.log(`Backfill complete: ${done} synced, ${failed} failed.`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
