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
 * KNOWLEDGE → REVISIONS: the READ half — history, the base roll-up, and restore.
 *
 * ⚠ **SPLIT FROM `./service-revisions.ts` BY A CYCLE, NOT BY SIZE.** The capture
 * half is imported BY the writers (`service-entries.ts`, `service-folders.ts`,
 * `service-base-writes.ts`, `service-paths.ts`); this half imports those same
 * writers back, to gate a read and to perform a restore. Keeping both in one
 * module would make that cycle real rather than merely apparent.
 *
 * 🔒 ⚠ **EVERY READ HERE IS GATED BY THE RESOURCE'S OWN SERVICE FIRST, AND THE
 * PROOF IS PASSED ON AS A REACH SET.** `revisions` states no visibility rule of
 * its own (`revisions/server/service-shared.ts`), so a history read that skipped
 * this step would be a service-role read of an unfenced table — which is exactly
 * the shape `service-entries.ts › getEntry`'s own docblock records as a hole.
 */

/**
 * ONE entry's history, newest first.
 *
 * 🔒 GATED ON {@link readEntry} — the id-following READ (B2), the same door
 * `GET /api/knowledge/entries/{id}` opens. A refusal is that read's 404, so
 * "no such entry", "its base is invisible to you" and "no history" stay one
 * answer.
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
 * THE BASE ROLL-UP — every revision of the base itself and of everything in it,
 * newest first. This is what the base page's **Changelog** section renders.
 *
 * 🔒 GATED ON `readBaseInContext`, then narrowed to the ids that base actually
 * owns: the reach set is built from the base's OWN folder and entry lists, so a
 * row naming anything else is dropped rather than rendered even though the query
 * ran as service role.
 *
 * ⚠ **THE ID SET IS READ FRESH, AND A DELETED ROW IS THEREFORE NOT IN IT.**
 * Knowledge deletes are permanent, so a delete revision names an id no list can
 * still produce — its row is filed and is not shown in the roll-up. That is the
 * fail-closed direction and it is the SAME answer the RLS policy gives
 * (`20261002120000_revisions.sql`, the fence section). Naming the deleted ids
 * would mean keeping a tombstone list this feature deliberately does not have.
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
 * 🔒 **RESTORE — A NEW REVISION, NEVER A REWRITE.**
 *
 * The snapshot is written back through {@link updateEntry}, the entry's own
 * write service: it re-runs the base's writable gate, the storage headroom
 * accounting and the embedding refresh, and it records the resulting revision
 * itself with `op: "restore"` and the source's date in the summary. Nothing here
 * touches the source row or any row between it and now.
 *
 * 🔒 THE WRITE GATE IS {@link getEntry}, workspace-keyed, exactly as `PATCH
 * /api/knowledge/entries/{id}` uses it — a write must not follow an id across a
 * tenancy boundary (INVARIANTS §T35).
 *
 * ⚠ **AGENTS MAY RESTORE.** This is deliberately NOT `sessionOnly`: restoring is
 * a WRITE that adds a revision, not a deletion, and the app-only fence exists for
 * acts that destroy history. `assertBaseWritable` and the base's
 * `agent_write_enabled` toggle are the gates that apply.
 *
 * ⚠ A revision belonging to a DIFFERENT entry answers the same 404 an unknown id
 * does — the route addresses one entry, and letting it write another entry's
 * snapshot would make the entry id decorative.
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
