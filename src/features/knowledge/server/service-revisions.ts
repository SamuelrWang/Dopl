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
 * ⚠ **ONE REVISION PER WRITE OPERATION, INSIDE THE SAME REQUEST, AFTER THE
 * WRITE, AND AWAITED** — never `void`-ed, never `catch`-and-continue
 * (`revisions/server/repository.ts` carries the argument).
 *
 * ⚠ **THE SNAPSHOT IS POST-WRITE, NOT THE PATCH.** Every function takes the row
 * the write RETURNED: a payload built from the patch would describe an edit
 * rather than a state, and `revisions/lib/diff.ts` compares STATES.
 *
 * ⚠ **CAPTURE ONLY.** The reads and the restore need the knowledge services,
 * which reach the writers that call this module;
 * `./service-revisions-read.ts` holds that half so the cycle is a visible seam.
 *
 * ⚠ **THE HUMAN SEAL RULE IS NOT RESTATED HERE** — it lives ONCE, in
 * `revisions/server/service.ts › COALESCE_WINDOW_MS`.
 */

/**
 * The entry's slash path, as a reader would address it.
 *
 * ⚠ **ONE ANCESTOR WALK, AND ONLY WHEN THE ENTRY IS IN A FOLDER** — a root-level
 * entry's path is its title and costs no query, which is the common case. The
 * walk is the indexed read `./service-folders.ts › moveFolder` already spends.
 *
 * ⚠ **A CALLER THAT ALREADY KNOWS THE PATH PASSES IT** and nothing is read.
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
    // ⚠ THE ENTRY'S OWN container — for a base followed across a tenancy
    // boundary that is the BASE's, not `ctx.workspaceId` (INVARIANTS §T35).
    // Filed anywhere else, the base roll-up cannot find it.
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
 * ⚠ **BODY WINS OVER TITLE, AND THAT ORDER IS THE CONTRACT**: a save changing
 * both is an `edit`, because classifying it as a `rename` would seal the open
 * coalescing row mid-sentence every time the title bar was touched. Title-only is
 * a `rename`, folder/position-only a `move`, anything else an `edit` with no body
 * — honest, and not restorable.
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
