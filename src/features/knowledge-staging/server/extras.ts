/** The staged search, export and revision routes. */
import type { KnowledgeSearchHit } from "@/features/knowledge/client/api";
import type { KnowledgeEntry } from "@/features/knowledge/types";
import type { RevisionPage } from "@/features/revisions/types";
import { knowledgeDb, nowIso, recordRevision } from "../fake-store";
import { notFound } from "./http";

/** A case-insensitive substring match over title + body, the snippet `<b>`-wrapped. */
export function search(q: string, baseSlug: string | null, limit: number): { hits: KnowledgeSearchHit[] } {
  const db = knowledgeDb();
  const needle = q.trim().toLowerCase();
  if (!needle) return { hits: [] };
  const base = baseSlug
    ? db.bases.find((b) => b.slug === baseSlug || b.publicId === baseSlug)
    : null;
  const hits: KnowledgeSearchHit[] = [];
  for (const e of db.entries) {
    if (base && e.knowledgeBaseId !== base.id) continue;
    const hay = `${e.title}\n${e.body}`;
    const at = hay.toLowerCase().indexOf(needle);
    if (at === -1) continue;
    const from = Math.max(0, at - 40);
    const raw = hay.slice(from, at + needle.length + 60).replace(/\n+/g, " ");
    const rel = at - from;
    hits.push({
      entryId: e.id,
      knowledgeBaseId: e.knowledgeBaseId,
      folderId: e.folderId,
      title: e.title,
      excerpt: e.excerpt,
      snippet: `${raw.slice(0, rel)}<b>${raw.slice(rel, rel + needle.length)}</b>${raw.slice(rel + needle.length)}`,
      rank: e.title.toLowerCase().includes(needle) ? 2 : 1,
      updatedAt: e.updatedAt,
    });
  }
  return { hits: hits.sort((a, b) => b.rank - a.rank).slice(0, limit) };
}

/** The export routes as one `.md` file: the real routes zip a base or folder, staging concatenates. */
export function exportMarkdown(kind: "base" | "folder" | "entry", id: string): Response {
  const db = knowledgeDb();
  const entries =
    kind === "entry"
      ? db.entries.filter((e) => e.id === id)
      : kind === "folder"
        ? db.entries.filter((e) => e.folderId === id)
        : db.entries.filter((e) => e.knowledgeBaseId === id);
  const name =
    kind === "entry"
      ? (entries[0]?.title ?? "entry")
      : kind === "folder"
        ? (db.folders.find((f) => f.id === id)?.name ?? "folder")
        : (db.bases.find((b) => b.id === id)?.name ?? "knowledge");
  const text = entries.map((e) => `# ${e.title}\n\n${e.body}`).join("\n\n---\n\n");
  return new Response(text, {
    status: 200,
    headers: {
      "content-type": "text/markdown",
      "content-disposition": `attachment; filename="${name}.md"`,
    },
  });
}

/** Pages of 8, so "Load more" is reachable on the seeded bases. */
const PAGE = 8;

function page(all: RevisionPage["revisions"], cursor: string | null): RevisionPage {
  const from = cursor ? Number(cursor) : 0;
  const next = from + PAGE < all.length ? String(from + PAGE) : null;
  return { revisions: all.slice(from, from + PAGE), nextCursor: next };
}

export function entryRevisions(entryId: string, cursor: string | null): RevisionPage {
  return page(
    knowledgeDb().revisions.filter((r) => r.resourceId === entryId),
    cursor
  );
}

/** The base roll-up: every revision of every entry in it, newest first. */
export function baseRevisions(baseId: string, cursor: string | null): RevisionPage {
  const db = knowledgeDb();
  const inBase = new Set(db.entries.filter((e) => e.knowledgeBaseId === baseId).map((e) => e.id));
  const all = db.revisions
    .filter((r) => inBase.has(r.resourceId))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return page(all, cursor);
}

/** Write a prior snapshot back; answers the entry as it now stands. */
export function restoreRevision(entryId: string, revisionId: string): { entry: KnowledgeEntry } {
  const db = knowledgeDb();
  const entry = db.entries.find((e) => e.id === entryId);
  const revision = db.revisions.find((r) => r.id === revisionId);
  if (!entry || !revision) throw notFound("Revision");
  if (typeof revision.payload.body === "string") entry.body = revision.payload.body;
  if (typeof revision.payload.title === "string") entry.title = revision.payload.title;
  entry.updatedAt = nowIso();
  const day = new Date(revision.createdAt).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
  });
  recordRevision(entry, "restore", `Restored the version from ${day}`);
  return { entry: { ...entry } };
}
