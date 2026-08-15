import "server-only";
import { createHash } from "node:crypto";
import { after } from "next/server";
import type { KnowledgeEntry } from "../types";
import {
  deleteChunksFrom,
  listChunkHashes,
  upsertChunks,
} from "./embeddings-repository";

/**
 * Semantic-search embeddings for knowledge entries. Chunks live in
 * `knowledge_entry_chunks` and feed `search_knowledge_hybrid`, which fuses
 * vector similarity with the tsvector rank.
 *
 * ⚠ Degrades gracefully by design: no OPENAI_API_KEY → no embeddings → search
 * falls back to the pure full-text RPC. Sync runs post-response via `after()`
 * (see `scheduleEntryEmbedding`), so saves never wait on the embedding API and
 * failures only log — they can NEVER fail a write.
 */

const OPENAI_EMBEDDINGS_URL = "https://api.openai.com/v1/embeddings";

const MODEL = process.env.EMBEDDING_MODEL ?? "text-embedding-3-small";
const DIMENSIONS = intEnv("EMBEDDING_DIMENSIONS", 1536);
/** ⚠ Chunk size is in ~tokens (ingestion convention) — ×4 ≈ chars. */
const CHUNK_CHARS = intEnv("CHUNK_SIZE", 500) * 4;
const OVERLAP_CHARS = intEnv("CHUNK_OVERLAP", 50) * 4;
const MAX_CHUNKS = intEnv("MAX_CHUNKS_PER_ENTRY", 50);

function intEnv(name: string, fallback: number): number {
  const parsed = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function embeddingsEnabled(): boolean {
  return Boolean(process.env.OPENAI_API_KEY?.trim());
}

// ─── OpenAI client (REST via fetch — no SDK dep) ────────────────────

async function embedTexts(texts: string[]): Promise<number[][]> {
  const key = process.env.OPENAI_API_KEY?.trim();
  if (!key) throw new Error("OPENAI_API_KEY not configured");
  const res = await fetch(OPENAI_EMBEDDINGS_URL, {
    method: "POST",
    headers: {
      authorization: `Bearer ${key}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ model: MODEL, input: texts, dimensions: DIMENSIONS }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`OpenAI embeddings ${res.status}: ${body.slice(0, 300)}`);
  }
  const parsed = (await res.json()) as {
    data: Array<{ index: number; embedding: number[] }>;
  };
  // API preserves order; sort by index defensively.
  return [...parsed.data].sort((a, b) => a.index - b.index).map((d) => d.embedding);
}

/** Embed a search query. Null on any failure → caller falls back to FTS. */
export async function embedQuery(query: string): Promise<string | null> {
  if (!embeddingsEnabled()) return null;
  try {
    const [vec] = await embedTexts([query.slice(0, 8000)]);
    return toVectorLiteral(vec);
  } catch (err) {
    console.error("[knowledge-embeddings] query embed failed:", err);
    return null;
  }
}

function toVectorLiteral(vec: number[]): string {
  return `[${vec.join(",")}]`;
}

// ─── Chunking ───────────────────────────────────────────────────────

/** Split on blank lines, pack into ~CHUNK_CHARS windows, carry OVERLAP_CHARS
 *  of trailing context forward. Oversized paragraphs hard-split. */
export function chunkEntryBody(body: string): string[] {
  const text = body.trim();
  if (!text) return [];
  const paragraphs = text.split(/\n{2,}/);
  const chunks: string[] = [];
  let current = "";
  for (const para of paragraphs) {
    const pieces =
      para.length > CHUNK_CHARS ? hardSplit(para, CHUNK_CHARS) : [para];
    for (const piece of pieces) {
      if (current && current.length + piece.length + 2 > CHUNK_CHARS) {
        chunks.push(current);
        current = current.slice(-OVERLAP_CHARS) + "\n\n";
      }
      current += (current.endsWith("\n\n") || current === "" ? "" : "\n\n") + piece;
    }
  }
  if (current.trim()) chunks.push(current);
  return chunks.slice(0, MAX_CHUNKS);
}

function hardSplit(text: string, size: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < text.length; i += size) out.push(text.slice(i, i + size));
  return out;
}

// ─── Sync ───────────────────────────────────────────────────────────

/**
 * Reconcile an entry's chunk rows with its content. Hash-aware: unchanged
 * chunks are never re-embedded (autosave fires every few seconds, usually one
 * chunk changes). THROWS on hard failure — callers decide fatal (backfill) vs
 * log-only (after()-scheduled sync).
 */
export async function syncEntryEmbeddings(entry: KnowledgeEntry): Promise<void> {
  if (!embeddingsEnabled()) return;

  const bodyChunks = chunkEntryBody(entry.body ?? "");
  // Title-only entries still get one chunk, else unfindable.
  const texts = (bodyChunks.length > 0 ? bodyChunks : [""]).map(
    (c) => `${entry.title}\n\n${c}`.trim()
  );
  const hashes = texts.map(hashChunk);

  const existing = await listChunkHashes(entry.id);
  const existingByIndex = new Map(existing.map((r) => [r.chunkIndex, r.contentHash]));

  const changedIndexes = texts
    .map((_, i) => i)
    .filter((i) => existingByIndex.get(i) !== hashes[i]);
  const staleCount = existing.filter((r) => r.chunkIndex >= texts.length).length;
  if (changedIndexes.length === 0 && staleCount === 0) return;

  if (changedIndexes.length > 0) {
    const vectors = await embedTexts(changedIndexes.map((i) => texts[i]));
    await upsertChunks(
      changedIndexes.map((i, j) => ({
        workspaceId: entry.workspaceId,
        knowledgeBaseId: entry.knowledgeBaseId,
        entryId: entry.id,
        chunkIndex: i,
        content: texts[i],
        contentHash: hashes[i],
        embedding: toVectorLiteral(vectors[j]),
      }))
    );
  }
  if (staleCount > 0) await deleteChunksFrom(entry.id, texts.length);
}

function hashChunk(text: string): string {
  return createHash("sha256").update(`${MODEL}:${DIMENSIONS}:${text}`).digest("hex");
}

/** Fire-and-forget: sync after response flush (`after()`), detached promise
 *  outside a request scope. NEVER throws into the caller. */
export function scheduleEntryEmbedding(entry: KnowledgeEntry): void {
  if (!embeddingsEnabled()) return;
  const run = () =>
    syncEntryEmbeddings(entry).catch((err) =>
      console.error(`[knowledge-embeddings] sync failed for ${entry.id}:`, err)
    );
  try {
    after(run);
  } catch {
    // `after()` throws outside a request scope (scripts, tests).
    void run();
  }
}
