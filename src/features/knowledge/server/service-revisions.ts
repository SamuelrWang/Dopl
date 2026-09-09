import "server-only";
import { recordRevision } from "@/features/revisions/server/service";
import type { RevisionOp } from "@/features/revisions/types";
import type {
  KnowledgeBase,
  KnowledgeContext,
  KnowledgeEntry,
  KnowledgeFolder,
} from "../types";
import * as repo from "./repository";

/**
 * KNOWLEDGE → REVISIONS: the CAPTURE half (2026-09-09, the CHANGELOG lane).
 *
 * ⚠ **ONE REVISION PER WRITE OPERATION, RECORDED INSIDE THE SAME REQUEST, AFTER
 * THE WRITE, AND AWAITED.** Never `void`-ed and never `catch`-and-continue: a
 * write whose revision could not be recorded is reported as FAILED, because a
 * lost revision is a lost audit (`revisions/server/repository.ts`'s docblock
 * carries the full argument and the counter-example).
 *
 * ⚠ **THE SNAPSHOT IS POST-WRITE, NOT THE PATCH.** Every function here takes the
 * row the write RETURNED, so the payload is the document as it now stands. A
 * payload built from the patch would describe an edit rather than a state, and
 * `revisions/lib/diff.ts` compares STATES.
 *
 * ⚠ **CAPTURE ONLY — no reads and no restore live here.** Those need the
 * knowledge SERVICES (`getEntry`, `readBaseInContext`) which in turn reach the
 * writers that call this module, and the cycle is avoided by the seam rather
 * than by an import order nobody can see: `./service-revisions-read.ts` holds
 * the read half.
 *
 * ⚠ **THE HUMAN SEAL RULE IS NOT RESTATED HERE.** Consecutive human `edit`s
 * coalesce inside a five-minute window; that arithmetic lives ONCE, in
 * `revisions/server/service.ts › COALESCE_WINDOW_MS`, and this module simply
 * records every write and lets it apply. An agent write never coalesces, which
 * is likewise that module's rule and not a condition anybody spells here.
 */

/**
 * The entry's slash path, as a reader would address it.
 *
 * ⚠ **ONE ANCESTOR WALK, AND ONLY WHEN THE ENTRY IS IN A FOLDER.** A root-level
 * entry's path is its title and costs no query at all, which is the common case.
 * The walk is `repo.listFolderAncestors`, the same indexed read
 * `service-folders.ts › moveFolder` already spends on a move.
 *
 * ⚠ **A CALLER THAT ALREADY KNOWS THE PATH PASSES IT** (`service-paths.ts` was
 * handed one as its argument), and then nothing is read.
 */
export async function entryPath(entry: KnowledgeEntry): Promise<string> {
  if (!entry.folderId) return entry.title;
  const ancestors = await repo.listFolderAncestors(entry.folderId);
  // ⚠ `listFolderAncestors` answers the chain; ordering it root-first is what
  // makes the join a path rather than a reversed one.
  const names = [...ancestors].reverse().map((f) => f.name);
  return [...names, entry.title].join("/");
}

/** Record one ENTRY write. `path` is derived when not supplied. */
export async function recordEntryRevision(
  ctx: KnowledgeContext,
  entry: KnowledgeEntry,
  op: RevisionOp,
  opts: { path?: string; summary?: string | null } = {}
): Promise<void> {
  await recordRevision(ctx, {
    resourceType: "knowledge_entry",
    resourceId: entry.id,
    // ⚠ THE ENTRY'S OWN container, which for a base followed across a tenancy
    // boundary is the BASE's and not `ctx.workspaceId` (INVARIANTS §T35's
    // id-following writes). The row must be filed where the resource lives or
    // the base roll-up cannot find it.
    workspaceId: entry.workspaceId,
    op,
    summary: opts.summary ?? null,
    payload: {
      body: entry.body,
      title: entry.title,
      path: opts.path ?? (await entryPath(entry)),
    },
  });
}

/** Record one FOLDER write. A folder has no body, so the snapshot is its name
 *  and its path — and a folder revision is therefore never RESTORABLE
 *  (`revisions/server/service.ts › restoreRevision` refuses a bodyless one). */
export async function recordFolderRevision(
  ctx: KnowledgeContext,
  folder: KnowledgeFolder,
  op: RevisionOp,
  opts: { path?: string } = {}
): Promise<void> {
  await recordRevision(ctx, {
    resourceType: "knowledge_folder",
    resourceId: folder.id,
    workspaceId: folder.workspaceId,
    op,
    payload: { title: folder.name, path: opts.path ?? folder.name },
  });
}

/** Record one BASE write — create, rename/description, delete. */
export async function recordBaseRevision(
  ctx: KnowledgeContext,
  base: KnowledgeBase,
  op: RevisionOp
): Promise<void> {
  await recordRevision(ctx, {
    resourceType: "knowledge_base",
    resourceId: base.id,
    workspaceId: base.workspaceId,
    op,
    payload: { title: base.name },
  });
}

/**
 * WHICH OP a patch performed.
 *
 * ⚠ **BODY WINS OVER TITLE, AND THAT ORDER IS THE CONTRACT.** A save that
 * changes both is an `edit` — the coalescing window is about a person typing,
 * and classifying such a save as a `rename` would seal the open row mid-sentence
 * every time the title bar was touched. A title-only change is a `rename`; a
 * folder/position-only change is a `move`; anything else (a description, an
 * excerpt) is an `edit` with no body, which is honest and not restorable.
 */
export function entryOpFor(patch: {
  body?: unknown;
  title?: unknown;
  folderId?: unknown;
  position?: unknown;
}): RevisionOp {
  if (patch.body !== undefined) return "edit";
  if (patch.title !== undefined) return "rename";
  if (patch.folderId !== undefined || patch.position !== undefined) return "move";
  return "edit";
}
