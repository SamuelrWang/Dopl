import "server-only";
import type {
  KnowledgeContext,
  KnowledgeEntry,
  KnowledgeFolder,
} from "../types";
import {
  FolderCycleError,
  KnowledgePathConflictError,
  PathTraversalError,
} from "./errors";
import {
  ensureFolderPath,
  parsePath,
  resolvePath,
} from "./path";
import * as repo from "./repository";
import {
  assertAgentCanDelete,
  assertBaseWritable,
  errorCode,
} from "./service-shared";
import { getBaseForWrite, readBaseInContext } from "./service-bases";
// AWAITED, AFTER THE WRITE, INSIDE THE REQUEST (`./service-revisions.ts`).
import {
  recordEntryRevision,
  recordFolderRevision,
} from "./service-revisions";

/**
 * **PATH-ADDRESSED FOLDER AND TREE OPS** — mkdir -p, delete, move, list.
 *
 * ⚠ **SPLIT OUT OF `service-paths.ts` ON 2026-09-18**, which passed the §1
 * 500-line cap (`eslint max-lines`, an ERROR on this tree) when the write path
 * grew the S40 vanished-target guard and the S53 idempotency probe. The seam is
 * the one the file already had: everything above it answers "what is AT this
 * path and what happens when I write there"; everything here MOVES the shape of
 * the tree itself and shares only the resolver.
 */

/**
 * mkdir -p a folder. Leaf already an entry ⇒ KnowledgePathConflictError.
 * `description` (≤300 chars) applies to the leaf only; mkdir-p'd parents stay
 * description-less. Re-calling on an existing folder updates its description;
 * `undefined` leaves it as-is.
 */
export async function createFolderByPath(
  ctx: KnowledgeContext,
  baseId: string,
  path: string,
  description?: string | null
): Promise<KnowledgeFolder> {
  const { ctx: baseCtx, value: base } = await getBaseForWrite(ctx, baseId);
  await assertBaseWritable(baseCtx, base);

  const segments = parsePath(path);
  if (segments.length === 0) {
    throw new KnowledgePathConflictError(path);
  }

  const resolved = await resolvePath(baseCtx, base.id, path);
  if (resolved.kind === "entry") {
    throw new KnowledgePathConflictError(path);
  }

  const folder = await ensureFolderPath(baseCtx, base.id, segments);
  if (!folder) throw new KnowledgePathConflictError(path);
  // Only when supplied, so plain mkdir-p re-call never clobbers a description.
  const saved =
    description !== undefined
      ? await repo.updateFolderRow(folder.id, { description })
      : folder;
  // one revision, for the leaf: mkdir -p'd parents are a consequence of this
  // write, not writes of their own.
  await recordFolderRevision(baseCtx, saved, "create", { path });
  return saved;
}

/**
 * PERMANENTLY delete folder (+ subtree) or entry at `path`. No trash —
 * immediate and irreversible. Throws on root, missing, or `ctx.source ===
 * "agent"` with base `agent_write_enabled` off (F-10).
 */
export async function deleteByPath(
  ctx: KnowledgeContext,
  baseId: string,
  path: string
): Promise<{ kind: "folder" | "entry"; id: string }> {
  const { ctx: baseCtx, value: base } = await getBaseForWrite(ctx, baseId);
  // F-10: block agent deletes in a base read-only to agents.
  assertAgentCanDelete(ctx, base);
  await assertBaseWritable(baseCtx, base);
  const resolved = await resolvePath(baseCtx, base.id, path);
  if (resolved.kind === "root") {
    throw new KnowledgePathConflictError("Cannot delete the base root.");
  }
  if (resolved.kind === "not_found") {
    throw new PathTraversalError(path, resolved.missingSegment);
  }
  if (resolved.kind === "folder") {
    await repo.hardDeleteFolder(baseCtx.workspaceId, resolved.folder.id);
    await recordFolderRevision(baseCtx, resolved.folder, "delete", { path });
    return { kind: "folder", id: resolved.folder.id };
  }
  await repo.hardDeleteEntry(baseCtx.workspaceId, resolved.entry.id);
  // the snapshot is the only surviving copy: knowledge deletes are permanent.
  await recordEntryRevision(baseCtx, resolved.entry, "delete", { path });
  return { kind: "entry", id: resolved.entry.id };
}

/** Move + rename atomically — one repo call after mkdir -p of target parents.
 *  Cycle check only when the parent changes; pure renames skip the walk. */
export async function moveByPath(
  ctx: KnowledgeContext,
  baseId: string,
  fromPath: string,
  toPath: string
): Promise<{ kind: "folder" | "entry"; id: string }> {
  const { ctx: baseCtx, value: base } = await getBaseForWrite(ctx, baseId);
  await assertBaseWritable(baseCtx, base);

  const fromResolved = await resolvePath(baseCtx, base.id, fromPath);
  if (fromResolved.kind === "root") {
    throw new KnowledgePathConflictError("Cannot move the base root.");
  }
  if (fromResolved.kind === "not_found") {
    throw new PathTraversalError(fromPath, fromResolved.missingSegment);
  }

  const toSegments = parsePath(toPath);
  if (toSegments.length === 0) {
    throw new KnowledgePathConflictError("Move target cannot be the base root.");
  }
  const toLeafName = toSegments[toSegments.length - 1];
  const toParentSegments = toSegments.slice(0, -1);
  const toParent = await ensureFolderPath(baseCtx, base.id, toParentSegments);
  const toParentId = toParent?.id ?? null;

  if (fromResolved.kind === "folder") {
    // Destination ancestors must not include the folder being moved.
    if (toParentId) {
      const ancestors = await repo.listFolderAncestors(toParentId);
      if (ancestors.some((a) => a.id === fromResolved.folder.id)) {
        throw new FolderCycleError(fromResolved.folder.id, toParentId);
      }
    }
    try {
      const updated = await repo.updateFolderRow(fromResolved.folder.id, {
        parentId: toParentId,
        name: toLeafName,
      });
      await recordFolderRevision(baseCtx, updated, "move", { path: toPath });
      return { kind: "folder", id: updated.id };
    } catch (err) {
      // Unique partial index collision (kb, parent, name).
      if (errorCode(err) === "23505") {
        throw new KnowledgePathConflictError(toPath);
      }
      throw err;
    }
  }

  try {
    const updated = await repo.updateEntryRow(fromResolved.entry.id, {
      folderId: toParentId,
      title: toLeafName,
      lastEditedBy: ctx.userId,
      lastEditedSource: ctx.source,
    });
    await recordEntryRevision(baseCtx, updated, "move", { path: toPath });
    return { kind: "entry", id: updated.id };
  } catch (err) {
    // Unique partial index collision (kb, folder, title).
    if (errorCode(err) === "23505") {
      throw new KnowledgePathConflictError(toPath);
    }
    throw err;
  }
}

/** Immediate children of folder at `path`, or base root when empty. Used by
 *  `kb_list_dir`. */
export async function listDirByPath(
  ctx: KnowledgeContext,
  baseId: string,
  path: string
): Promise<{
  folder: KnowledgeFolder | null;
  folders: KnowledgeFolder[];
  entries: KnowledgeEntry[];
}> {
  // a read, so it follows the id — see {@link readFileByPath}.
  const { ctx: baseCtx, value: base } = await readBaseInContext(ctx, baseId);
  let parentId: string | null = null;
  let folder: KnowledgeFolder | null = null;
  if (path) {
    const resolved = await resolvePath(baseCtx, base.id, path);
    if (resolved.kind === "entry") {
      throw new KnowledgePathConflictError(
        `Cannot list contents of an entry: "${path}"`
      );
    }
    if (resolved.kind === "not_found") {
      throw new PathTraversalError(path, resolved.missingSegment);
    }
    if (resolved.kind === "folder") {
      folder = resolved.folder;
      parentId = resolved.folder.id;
    }
  }
  const allFolders = await repo.listFoldersForBase(base.id, false);
  const folders = allFolders.filter((f) => f.parentId === parentId);
  const entries = await repo.listEntriesForBase(base.id, {
    folderId: parentId,
    includeBody: false,
    includeDeleted: false,
  });
  return { folder, folders, entries };
}
