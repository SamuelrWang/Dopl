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
 * Knowledge → revisions: the CAPTURE half (2026-09-09, the changelog lane).
 *
 * One revision per write operation, inside the same request, after the write,
 * and AWAITED — never `void`-ed, never `catch`-and-continue.
 *
 * The snapshot is POST-WRITE, not the patch: every function takes the row the
 * write returned, because `revisions/lib/diff.ts` compares STATES.
 *
 * Capture only — the reads and the restore need the knowledge services, which
 * reach the writers that call this module, so `./service-revisions-read.ts` holds
 * that half. The human seal rule lives once, in
 * `revisions/server/service.ts › COALESCE_WINDOW_MS`.
 */

/**
 * The entry's slash path, as a reader would address it. One ancestor walk, and
 * only when the entry is in a folder — a root-level entry's path is its title
 * and costs no query. A caller that already knows the path passes it.
 */
export async function entryPath(entry: KnowledgeEntry): Promise<string> {
  if (!entry.folderId) return entry.title;
  const ancestors = await repo.listFolderAncestors(entry.folderId);
  // `listFolderAncestors` answers the chain folder-first; root-first is what
  // makes the join a path.
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
    // the ENTRY's own container — for a base followed across a tenancy boundary
    // that is the BASE's, not `ctx.workspaceId` (INVARIANTS §T35). Filed anywhere
    // else, the base roll-up cannot find it.
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
 * Which op a patch performed. Body wins over title and that order is the
 * contract: a save changing both is an `edit`, because a `rename` would seal the
 * open coalescing row every time the title bar was touched mid-sentence.
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
