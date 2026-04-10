import { generateEmbedding } from "@/lib/ai";
import { supabase } from "@/lib/supabase";
import { ChunkData } from "./types";

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

export async function chunkAndEmbed(
  entryId: string,
  content: { readme: string; agentsMd: string; rawContent: string }
): Promise<void> {
  // Delete existing chunks for this entry (in case of re-processing)
  await supabase.from("chunks").delete().eq("entry_id", entryId);

  const allChunks: ChunkData[] = [];

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

  // Generate embeddings and insert in batches
  const batchSize = 10;
  for (let i = 0; i < limitedChunks.length; i += batchSize) {
    const batch = limitedChunks.slice(i, i + batchSize);

    const embeddings = await Promise.all(
      batch.map((chunk) => generateEmbedding(chunk.content))
    );

    const rows = batch.map((chunk, idx) => ({
      entry_id: entryId,
      content: chunk.content,
      chunk_type: chunk.chunkType,
      chunk_index: chunk.chunkIndex,
      embedding: JSON.stringify(embeddings[idx]),
    }));

    const { error } = await supabase.from("chunks").insert(rows);
    if (error) {
      console.error("[embedder] Failed to insert chunks:", error);
      throw error;
    }
  }
}

function splitIntoChunks(
  text: string,
  chunkType: ChunkData["chunkType"]
): ChunkData[] {
  if (!text || text.trim().length === 0) return [];

  const words = text.split(/\s+/);
  const chunks: ChunkData[] = [];
  let chunkIndex = 0;
  let start = 0;

  // Step size must be at least 1 to prevent infinite loops
  const stepSize = Math.max(1, CHUNK_SIZE - CHUNK_OVERLAP);

  while (start < words.length) {
    const end = Math.min(start + CHUNK_SIZE, words.length);
    const chunkWords = words.slice(start, end);
    const content = chunkWords.join(" ").trim();

    if (content.length > 0) {
      chunks.push({
        content,
        chunkType,
        chunkIndex,
      });
      chunkIndex++;
    }

    start += stepSize;
  }

  return chunks;
}
