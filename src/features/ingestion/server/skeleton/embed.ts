import "server-only";
import { generateEmbedding } from "@/shared/lib/ai";
import { supabaseAdmin } from "@/shared/supabase/admin";
import { logSystemEvent } from "@/features/analytics/server/system-events";

/**
 * Embed the descriptor as a single chunk. Clears any pre-existing chunks
 * for the entry so a re-ingest yields a clean single-chunk row set.
 */
export async function embedDescriptor(
  entryId: string,
  descriptor: string
): Promise<void> {
  const supabase = supabaseAdmin();

  // Clear any pre-existing chunks for this entry so a re-ingest yields
  // a clean single-chunk row set.
  await supabase.from("chunks").delete().eq("entry_id", entryId);

  const embedding = await generateEmbedding(descriptor);

  const { error } = await supabase.from("chunks").insert({
    entry_id: entryId,
    content: descriptor,
    chunk_type: "descriptor",
    chunk_index: 0,
    embedding: JSON.stringify(embedding),
  });
  if (error) {
    throw new Error(`Failed to insert descriptor chunk: ${error.message}`);
  }
}

/**
 * Short-query retrieval parity with full ingest. Emits a dedicated
 * title+summary+tags chunk so title-shaped queries ("clone website",
 * "polymarket bot") rank skeletons competitively alongside full entries.
 *
 * Failure here degrades search quality but doesn't justify failing the
 * whole entry — we log and move on.
 */
export async function embedTitleSummary(
  entryId: string,
  title: string,
  summary: string,
  tagValues: string[]
): Promise<void> {
  const content = [title, summary, tagValues.filter(Boolean).join(", ")]
    .map((s) => (s || "").trim())
    .filter((s) => s.length > 0)
    .join("\n\n");

  if (content.length === 0) return;

  try {
    const supabase = supabaseAdmin();
    const embedding = await generateEmbedding(content);
    const { error } = await supabase.from("chunks").insert({
      entry_id: entryId,
      content,
      chunk_type: "title_summary",
      chunk_index: 0,
      embedding: JSON.stringify(embedding),
    });
    if (error) throw error;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[skeleton] title_summary embed failed for ${entryId}: ${msg}`);
    void logSystemEvent({
      severity: "warn",
      category: "ingestion",
      source: "skeleton.embedTitleSummary",
      message: `title_summary embed failed: ${msg}`,
      fingerprintKeys: ["skeleton", "title_summary_failed"],
      metadata: { entry_id: entryId },
    });
  }
}
