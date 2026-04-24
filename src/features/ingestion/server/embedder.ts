import { generateEmbedding } from "@/lib/ai";
import { supabaseAdmin } from "@/shared/supabase/admin";
const supabase = supabaseAdmin();
import { ChunkData } from "./types";
import { logSystemEvent } from "@/lib/analytics/system-events";

const MIN_CHUNK_SIZE = 10;
const MAX_CHUNK_SIZE = 5000;

const CHUNK_SIZE = Math.max(
  MIN_CHUNK_SIZE,
  Math.min(
    MAX_CHUNK_SIZE,
    parseInt(process.env.CHUNK_SIZE || "500", 10) || 500
  )
);

const CHUNK_OVERLAP = Math.max(
  0,
  Math.min(
    Math.floor(CHUNK_SIZE / 2), // Overlap can't exceed half of chunk size
    parseInt(process.env.CHUNK_OVERLAP || "50", 10) || 50
  )
);

const MAX_CHUNKS = parseInt(process.env.MAX_CHUNKS_PER_ENTRY || "50", 10);

// text-embedding-3-small accepts up to 8192 tokens per input. Word-based
// chunking doesn't know about tokens — a single "word" (a long URL,
// minified code, a base64 blob, a file-tree line) can be thousands of
// tokens, and dense markdown with code fences averages well under 3
// chars/token. Gate chunk sizes on a conservative char-per-token
// estimate so we don't blow up the embedding API with 400s.
const MAX_EMBEDDING_TOKENS = 6000; // headroom below OpenAI's 8192 limit
const CHARS_PER_TOKEN_ESTIMATE = 3; // conservative — dense content can hit ~3
const MAX_CHUNK_CHARS = MAX_EMBEDDING_TOKENS * CHARS_PER_TOKEN_ESTIMATE;

export async function chunkAndEmbed(
  entryId: string,
  content: {
    readme: string;
    agentsMd: string;
    rawContent: string;
    titleSummary?: string;
  }
): Promise<void> {
  const allChunks: ChunkData[] = [];

  // title_summary is a dedicated high-signal chunk (title + summary + tags).
  // Kept as a single chunk — it's short, and splitting would dilute the
  // query→title cosine similarity that the whole thing exists to rescue.
  if (content.titleSummary && content.titleSummary.trim().length > 0) {
    const trimmed = content.titleSummary.trim().slice(0, MAX_CHUNK_CHARS);
    allChunks.push({ content: trimmed, chunkType: "title_summary", chunkIndex: 0 });
  }

  const readmeChunks = splitIntoChunks(content.readme, "readme");
  allChunks.push(...readmeChunks);

  const agentsChunks = splitIntoChunks(content.agentsMd, "agents_md");
  allChunks.push(...agentsChunks);

  const rawChunks = splitIntoChunks(content.rawContent, "raw_content");
  allChunks.push(...rawChunks);

  // Limit total chunks
  const limitedChunks = allChunks.slice(0, MAX_CHUNKS);

  if (limitedChunks.length === 0) {
    console.warn(`[embedder] No chunks to embed for entry ${entryId}`);
    return;
  }

  // ─── Phase 1: embed everything into memory, do NOT touch the DB yet. ───
  // Previously we deleted existing chunks as step 1 then inserted as we
  // embedded. That made a mid-flight embedding failure catastrophic for
  // re-ingests: old chunks already gone, new ones never landed, entry
  // silently becomes unsearchable. Collecting rows first and only
  // swapping at the end preserves the old chunk set for any failure
  // before the swap.
  //
  // allSettled so a single oversize/malformed chunk doesn't abort the
  // whole entry — earlier behavior was to fail the pipeline on one 400,
  // which wiped the user's in-flight ingestion (8192-token regression
  // for addyosmani/agent-skills).
  const batchSize = 10;
  let successCount = 0;
  let failureCount = 0;
  const newRows: Array<{
    entry_id: string;
    content: string;
    chunk_type: ChunkData["chunkType"];
    chunk_index: number;
    embedding: string;
  }> = [];

  for (let i = 0; i < limitedChunks.length; i += batchSize) {
    const batch = limitedChunks.slice(i, i + batchSize);

    const results = await Promise.allSettled(
      batch.map((chunk) => generateEmbedding(chunk.content))
    );

    results.forEach((res, idx) => {
      if (res.status === "fulfilled") {
        newRows.push({
          entry_id: entryId,
          content: batch[idx].content,
          chunk_type: batch[idx].chunkType,
          chunk_index: batch[idx].chunkIndex,
          embedding: JSON.stringify(res.value),
        });
        successCount++;
      } else {
        failureCount++;
        const reason = res.reason instanceof Error ? res.reason.message : String(res.reason);
        console.error(
          `[embedder] Embedding failed for chunk ${batch[idx].chunkType}#${batch[idx].chunkIndex}:`,
          reason
        );
        void logSystemEvent({
          severity: "warn",
          category: "ingestion",
          source: "embedder.chunk",
          message: `Chunk embedding failed: ${reason}`,
          fingerprintKeys: ["embedder", "chunk_fail"],
          metadata: {
            entry_id: entryId,
            chunk_type: batch[idx].chunkType,
            chunk_index: batch[idx].chunkIndex,
            chunk_chars: batch[idx].content.length,
          },
        });
      }
    });
  }

  // If nothing embedded, leave existing chunks alone and throw. Old
  // chunks (if any) remain searchable — a retry is safe.
  if (newRows.length === 0) {
    throw new Error(
      `All ${failureCount} chunk embeddings failed for entry ${entryId}`
    );
  }

  // ─── Phase 2: atomic swap — delete old, insert new. ───
  // Narrow failure window: if DELETE succeeds and INSERT fails we've
  // lost the old chunks. Log critical so the entry is easy to find in
  // audit, then throw so the caller can decide whether to retry.
  const { error: deleteError } = await supabase
    .from("chunks")
    .delete()
    .eq("entry_id", entryId);
  if (deleteError) {
    throw new Error(`Failed to clear existing chunks: ${deleteError.message}`);
  }

  const { error: insertError } = await supabase.from("chunks").insert(newRows);
  if (insertError) {
    console.error("[embedder] Failed to insert chunks after delete:", insertError);
    void logSystemEvent({
      severity: "critical",
      category: "ingestion",
      source: "embedder.insert_post_delete",
      message: `Insert failed after delete — entry has no chunks: ${insertError.message}`,
      fingerprintKeys: ["embedder", "insert_post_delete"],
      metadata: {
        entry_id: entryId,
        attempted_rows: newRows.length,
      },
    });
    throw insertError;
  }

  // ─── Phase 3: record embedding coverage on the entry row. ───
  // Lets ops see which entries got a partial index (successCount <
  // limitedChunks.length) vs a clean one. Non-fatal if the update fails —
  // search is already working.
  const { error: statsError } = await supabase
    .from("entries")
    .update({
      chunks_attempted: limitedChunks.length,
      chunks_embedded: successCount,
    })
    .eq("id", entryId);
  if (statsError) {
    console.warn(`[embedder] Failed to stamp embedding stats for ${entryId}: ${statsError.message}`);
  }
}

function splitIntoChunks(
  text: string,
  chunkType: ChunkData["chunkType"]
): ChunkData[] {
  if (!text || text.trim().length === 0) return [];

  const words = text.split(/\s+/);
  const rawChunks: string[] = [];
  let start = 0;

  // Step size must be at least 1 to prevent infinite loops
  const stepSize = Math.max(1, CHUNK_SIZE - CHUNK_OVERLAP);

  while (start < words.length) {
    const end = Math.min(start + CHUNK_SIZE, words.length);
    const content = words.slice(start, end).join(" ").trim();
    if (content.length > 0) rawChunks.push(content);
    start += stepSize;
  }

  // Enforce the embedding-API char ceiling on every chunk. Word-based
  // splits can produce oversize chunks when a single "word" is huge
  // (long URL, base64 blob, minified line). Fall back to char-slicing
  // for those, so we never hand a 10k-token blob to OpenAI.
  const chunks: ChunkData[] = [];
  let chunkIndex = 0;
  for (const raw of rawChunks) {
    for (const piece of enforceCharCeiling(raw, MAX_CHUNK_CHARS)) {
      chunks.push({ content: piece, chunkType, chunkIndex });
      chunkIndex++;
    }
  }

  return chunks;
}

/**
 * Split a chunk string into pieces no larger than `maxChars`. Returns
 * the original string unchanged when it's already under the limit.
 * Uses fixed-size slicing — good enough for the embedding API's
 * token ceiling, and keeps ordering deterministic.
 */
function enforceCharCeiling(text: string, maxChars: number): string[] {
  if (text.length <= maxChars) return [text];
  const pieces: string[] = [];
  for (let i = 0; i < text.length; i += maxChars) {
    pieces.push(text.slice(i, i + maxChars));
  }
  return pieces;
}
