import "server-only";
import { supabaseAdmin } from "@/shared/supabase/admin";

/** Raw I/O for `knowledge_entry_chunks`. ⚠ Service-role only — the table has
 *  RLS enabled with NO policies. */

export interface ChunkHashRow {
  chunkIndex: number;
  contentHash: string;
}

export interface UpsertChunkRow {
  workspaceId: string;
  knowledgeBaseId: string;
  entryId: string;
  chunkIndex: number;
  content: string;
  contentHash: string;
  /** pgvector literal, e.g. "[0.1,0.2,...]". */
  embedding: string;
}

export async function listChunkHashes(entryId: string): Promise<ChunkHashRow[]> {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("knowledge_entry_chunks")
    .select("chunk_index, content_hash")
    .eq("entry_id", entryId);
  if (error) throw error;
  return ((data ?? []) as Array<{ chunk_index: number; content_hash: string }>).map(
    (r) => ({ chunkIndex: r.chunk_index, contentHash: r.content_hash })
  );
}

export async function upsertChunks(rows: UpsertChunkRow[]): Promise<void> {
  if (rows.length === 0) return;
  const db = supabaseAdmin();
  const { error } = await db.from("knowledge_entry_chunks").upsert(
    rows.map((r) => ({
      workspace_id: r.workspaceId,
      knowledge_base_id: r.knowledgeBaseId,
      entry_id: r.entryId,
      chunk_index: r.chunkIndex,
      content: r.content,
      content_hash: r.contentHash,
      embedding: r.embedding,
      updated_at: new Date().toISOString(),
    })),
    { onConflict: "entry_id,chunk_index" }
  );
  if (error) throw error;
}

/** Drop chunks at or beyond `fromIndex` — entry shrank on re-chunk. */
export async function deleteChunksFrom(
  entryId: string,
  fromIndex: number
): Promise<void> {
  const db = supabaseAdmin();
  const { error } = await db
    .from("knowledge_entry_chunks")
    .delete()
    .eq("entry_id", entryId)
    .gte("chunk_index", fromIndex);
  if (error) throw error;
}

