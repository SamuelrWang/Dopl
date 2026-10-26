"use client";

/**
 * STAGING STUB of `src/features/revisions/client/api.ts` — the two knowledge families only
 * (`fetchEntryRevisions`, `fetchBaseRevisions`, `restoreEntryRevision`), served from the
 * in-memory DB. No fetch.
 */
import type { KnowledgeEntry } from "@/features/knowledge/types";
import type { RevisionPage } from "@/features/revisions/types";
import { knowledgeDb, latency, nowIso, recordRevision } from "../fake-store";

export interface RevisionPageArgs {
  cursor?: string | null;
  limit?: number;
  workspaceId?: string;
}

/** Pages of 8 so "Load more" is reachable on the seeded bases. */
const PAGE = 8;

function page(all: RevisionPage["revisions"], args: RevisionPageArgs): RevisionPage {
  const from = args.cursor ? Number(args.cursor) : 0;
  const size = args.limit ?? PAGE;
  const slice = all.slice(from, from + size);
  const next = from + size < all.length ? String(from + size) : null;
  return { revisions: slice, nextCursor: next };
}

export async function fetchEntryRevisions(
  entryId: string,
  args: RevisionPageArgs = {}
): Promise<RevisionPage> {
  await latency(120);
  const all = knowledgeDb().revisions.filter((r) => r.resourceId === entryId);
  return page(all, args);
}

export async function fetchBaseRevisions(
  baseId: string,
  args: RevisionPageArgs = {}
): Promise<RevisionPage> {
  await latency(120);
  const db = knowledgeDb();
  const inBase = new Set(
    db.entries.filter((e) => e.knowledgeBaseId === baseId).map((e) => e.id)
  );
  const all = db.revisions
    .filter((r) => inBase.has(r.resourceId))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return page(all, args);
}

/** Write a prior snapshot back. Answers the entry as it now stands. */
export async function restoreEntryRevision(
  entryId: string,
  revisionId: string,
  workspaceId?: string
): Promise<KnowledgeEntry> {
  void workspaceId;
  await latency(200);
  const db = knowledgeDb();
  const entry = db.entries.find((e) => e.id === entryId);
  const revision = db.revisions.find((r) => r.id === revisionId);
  if (!entry || !revision) throw new Error("Revision not found");
  if (typeof revision.payload.body === "string") entry.body = revision.payload.body;
  if (typeof revision.payload.title === "string") entry.title = revision.payload.title;
  entry.updatedAt = nowIso();
  const day = new Date(revision.createdAt).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
  });
  recordRevision(entry, "restore", `Restored the version from ${day}`);
  return { ...entry };
}
