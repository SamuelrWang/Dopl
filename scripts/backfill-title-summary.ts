/**
 * One-off backfill: generate a `title_summary` chunk for every existing entry.
 *
 * Why: until this change, only readme/agents_md/raw_content were embedded.
 * Short title-shaped queries ("clone website", "polymarket bot") couldn't
 * beat the cosine similarity of long body chunks, so obvious matches
 * returned nothing. New ingests get a title_summary chunk from
 * `chunkAndEmbed`; this script retroactively adds one for rows ingested
 * before the patch.
 *
 * Idempotent: skips any entry that already has a title_summary chunk.
 * Safe to re-run.
 *
 * Run: npx tsx scripts/backfill-title-summary.ts
 */
import * as dotenv from "dotenv";
import { resolve } from "path";

// Must load env before any import that reads process.env at module-init.
// src/shared/supabase/admin.ts throws at import time if NEXT_PUBLIC_SUPABASE_URL is
// missing, so we can't use a top-level import here — use dynamic import
// inside main() after dotenv.config has run.
dotenv.config({ path: resolve(__dirname, "../.env.local") });

type EntryRow = {
  id: string;
  title: string | null;
  summary: string | null;
};

type TagRow = {
  entry_id: string;
  tag_value: string | null;
};

async function main() {
  const { supabaseAdmin } = await import("../src/shared/supabase/admin");
  const { generateEmbedding } = await import("../src/lib/ai");
  const supabase = supabaseAdmin();

  console.log("\n🔬 title_summary backfill\n");

  const { data: entries, error: entriesError } = await supabase
    .from("entries")
    .select("id, title, summary");

  if (entriesError) {
    console.error("Failed to list entries:", entriesError);
    process.exit(1);
  }

  const rows = (entries || []) as EntryRow[];
  console.log(`Loaded ${rows.length} entries`);

  // Find entries that already have a title_summary chunk — skip them.
  const { data: existing, error: existingError } = await supabase
    .from("chunks")
    .select("entry_id")
    .eq("chunk_type", "title_summary");

  if (existingError) {
    console.error("Failed to check existing chunks:", existingError);
    process.exit(1);
  }

  const alreadyDone = new Set((existing || []).map((r) => (r as { entry_id: string }).entry_id));
  const pending = rows.filter((r) => !alreadyDone.has(r.id));
  console.log(`Skipping ${alreadyDone.size} already-backfilled; processing ${pending.length}`);

  // Pull tags for all pending entries in one query.
  const pendingIds = pending.map((r) => r.id);
  const tagsByEntry = new Map<string, string[]>();
  if (pendingIds.length > 0) {
    const { data: tagRows, error: tagsError } = await supabase
      .from("tags")
      .select("entry_id, tag_value")
      .in("entry_id", pendingIds);

    if (tagsError) {
      console.error("Failed to load tags:", tagsError);
      process.exit(1);
    }

    for (const row of (tagRows || []) as TagRow[]) {
      if (!row.tag_value) continue;
      const list = tagsByEntry.get(row.entry_id) || [];
      list.push(row.tag_value);
      tagsByEntry.set(row.entry_id, list);
    }
  }

  let ok = 0;
  let skipped = 0;
  let failed = 0;

  for (const entry of pending) {
    const title = entry.title?.trim() || "";
    const summary = entry.summary?.trim() || "";
    const tagLine = (tagsByEntry.get(entry.id) || []).join(", ");
    const content = [title, summary, tagLine]
      .filter((s) => s.length > 0)
      .join("\n\n")
      .trim();

    if (content.length === 0) {
      console.log(`  ⏭  ${entry.id} — no title/summary/tags, skipping`);
      skipped++;
      continue;
    }

    try {
      const embedding = await generateEmbedding(content);
      const { error: insertError } = await supabase.from("chunks").insert({
        entry_id: entry.id,
        content,
        chunk_type: "title_summary",
        chunk_index: 0,
        embedding: JSON.stringify(embedding),
      });
      if (insertError) throw insertError;
      console.log(`  ✅ ${entry.id} — "${title.slice(0, 60)}"`);
      ok++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log(`  ❌ ${entry.id} — ${msg}`);
      failed++;
    }
  }

  console.log(`\nDone. ok=${ok} skipped=${skipped} failed=${failed}\n`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
