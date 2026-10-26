"use client";

/** STAGING: the export + search half of the staging `./api.ts` (re-exported from there). */
import type { KnowledgeEntry } from "@/features/knowledge/types";
import { knowledgeDb, latency } from "@/features/knowledge-staging/fake-store";

// ─── Export / download ──────────────────────────────────────────────

export type KnowledgeExportKind = "base" | "folder" | "entry";

/**
 * STAGING: builds the markdown in memory and hands it to the browser as a `.md` file (the real
 * route zips a base/folder; staging concatenates its entries into one file instead).
 */
export async function downloadKnowledgeExport(
  kind: KnowledgeExportKind,
  id: string,
  workspaceId?: string
): Promise<void> {
  void workspaceId;
  await latency(120);
  const db = knowledgeDb();
  let entries: KnowledgeEntry[] = [];
  let name = "knowledge";
  if (kind === "entry") {
    entries = db.entries.filter((e) => e.id === id);
    name = entries[0]?.title ?? "entry";
  } else if (kind === "folder") {
    entries = db.entries.filter((e) => e.folderId === id);
    name = db.folders.find((f) => f.id === id)?.name ?? "folder";
  } else {
    entries = db.entries.filter((e) => e.knowledgeBaseId === id);
    name = db.bases.find((b) => b.id === id)?.name ?? "knowledge";
  }
  const text = entries.map((e) => `# ${e.title}\n\n${e.body}`).join("\n\n---\n\n");
  triggerBlobDownload(new Blob([text], { type: "text/markdown" }), `${name}.md`);
}

function triggerBlobDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// ─── Search ─────────────────────────────────────────────────────────

export interface KnowledgeSearchHit {
  entryId: string;
  knowledgeBaseId: string;
  folderId: string | null;
  title: string;
  excerpt: string | null;
  /** Snippet has `<b>` tags around matched terms — strip or render. */
  snippet: string;
  rank: number;
  updatedAt: string;
}

/** STAGING: a case-insensitive substring match over title + body, snippet `<b>`-wrapped. */
export async function searchKnowledge(
  query: string,
  opts: { baseSlug?: string; limit?: number } = {},
  workspaceId?: string
): Promise<KnowledgeSearchHit[]> {
  await latency(140);
  const db = knowledgeDb();
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const base = opts.baseSlug
    ? db.bases.find((b) => b.slug === opts.baseSlug || b.publicId === opts.baseSlug)
    : null;
  const hits: KnowledgeSearchHit[] = [];
  for (const e of db.entries) {
    if (workspaceId && e.workspaceId !== workspaceId) continue;
    if (base && e.knowledgeBaseId !== base.id) continue;
    const hay = `${e.title}\n${e.body}`;
    const at = hay.toLowerCase().indexOf(q);
    if (at === -1) continue;
    const from = Math.max(0, at - 40);
    const raw = hay.slice(from, at + q.length + 60).replace(/\n+/g, " ");
    const rel = at - from;
    const snippet = `${raw.slice(0, rel)}<b>${raw.slice(rel, rel + q.length)}</b>${raw.slice(rel + q.length)}`;
    hits.push({
      entryId: e.id,
      knowledgeBaseId: e.knowledgeBaseId,
      folderId: e.folderId,
      title: e.title,
      excerpt: e.excerpt,
      snippet,
      rank: e.title.toLowerCase().includes(q) ? 2 : 1,
      updatedAt: e.updatedAt,
    });
  }
  return hits.sort((a, b) => b.rank - a.rank).slice(0, opts.limit ?? 10);
}
