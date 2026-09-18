import "server-only";
import {
  listRevisions,
  listRevisionsAcross,
  restoreRevision,
  restoreSummary,
  type ListRevisionsOpts,
} from "@/features/revisions/server/service";
import { revisionReach } from "@/features/revisions/server/service-shared";
import { RevisionNotFoundError } from "@/features/revisions/server/errors";
import type { RevisionPage } from "@/features/revisions/types";
import type { KnowledgeContext } from "../types";
import * as repo from "./repository";
import { readBaseInContext } from "./service-bases";
import { getEntry, readEntry, updateEntry } from "./service-entries";

/**
 * Knowledge → revisions: the READ half — history, the base roll-up, and restore.
 *
 * Split from `./service-revisions.ts` by a CYCLE, not by size: the capture half
 * is imported BY the writers, and this half imports those writers back to gate a
 * read and to perform a restore.
 *
 * Every read here is gated by the resource's own service FIRST, and the proof
 * is passed on as a reach set. `revisions` states no visibility rule of its own,
 * so a history read that skipped this step would be a service-role read of an
 * unfenced table — the shape `service-entries.ts › getEntry`'s own docblock
 * records as a hole.
 */

/**
 * ONE entry's history, newest first. Gated on {@link readEntry} — the
 * id-following READ (B2). A refusal is that read's 404, so "no such entry", "its
 * base is invisible to you" and "no history" stay one answer.
 */
export async function listEntryRevisions(
  ctx: KnowledgeContext,
  entryId: string,
  opts: ListRevisionsOpts = {}
): Promise<RevisionPage> {
  const entry = await readEntry(ctx, entryId);
  return listRevisions(
    { resourceType: "knowledge_entry", resourceId: entry.id },
    revisionReach([{ resourceType: "knowledge_entry", resourceId: entry.id }]),
    opts
  );
}

/**
 * The base roll-up — every revision of the base itself and of everything in it,
 * newest first; what the base page's Changelog section renders.
 *
 * Gated on `readBaseInContext`, then narrowed to the ids that base owns: the
 * reach set is built from the base's OWN folder and entry lists, so a row naming
 * anything else is dropped even though the query ran as service role.
 *
 * The id set is read FRESH, so a deleted row is not in it. Knowledge deletes
 * are permanent, so a delete revision names an id no list can still produce; its
 * row is filed and not shown. That is the fail-closed direction and the same
 * answer the RLS policy gives (`20261002120000_revisions.sql`).
 */
export async function listBaseRevisions(
  ctx: KnowledgeContext,
  baseId: string,
  opts: ListRevisionsOpts = {}
): Promise<RevisionPage> {
  const { value: base } = await readBaseInContext(ctx, baseId);
  const [folders, entries] = await Promise.all([
    repo.listFoldersForBase(base.id, false),
    repo.listEntriesForBase(base.id, { includeBody: false, includeDeleted: false }),
  ]);
  const refs = [
    { resourceType: "knowledge_base" as const, resourceId: base.id },
    ...folders.map((f) => ({
      resourceType: "knowledge_folder" as const,
      resourceId: f.id,
    })),
    ...entries.map((e) => ({
      resourceType: "knowledge_entry" as const,
      resourceId: e.id,
    })),
  ];
  return listRevisionsAcross(base.workspaceId, refs, revisionReach(refs), opts);
}

/**
 * Restore — a new revision, never a rewrite. The snapshot is written back through
 * {@link updateEntry}, so the base's writable gate, the storage accounting and
 * the embedding refresh all re-run and the revision is recorded with
 * `op: "restore"`. Nothing here touches the source row.
 *
 * The write gate is {@link getEntry}, workspace-keyed — a write must not
 * follow an id across a tenancy boundary (INVARIANTS §T35).
 *
 * Agents may restore: deliberately NOT `sessionOnly`, because restoring adds a
 * revision rather than destroying history; `assertBaseWritable` and
 * `agent_write_enabled` are the gates that apply. A revision belonging to a
 * DIFFERENT entry answers the same 404 an unknown id does.
 */
export async function restoreEntryRevision(
  ctx: KnowledgeContext,
  entryId: string,
  revisionId: string
): Promise<void> {
  const entry = await getEntry(ctx, entryId);
  const reach = revisionReach([
    { resourceType: "knowledge_entry", resourceId: entry.id },
  ]);
  await restoreRevision(revisionId, reach, async (source) => {
    if (source.resourceId !== entry.id) throw new RevisionNotFoundError(revisionId);
    await updateEntry(
      ctx,
      entry.id,
      {
        body: source.payload.body ?? "",
        ...(source.payload.title ? { title: source.payload.title } : {}),
      },
      undefined,
      { op: "restore", summary: restoreSummary(source) }
    );
  });
}
