import "server-only";
import type {
  KnowledgeBase,
  KnowledgeContext,
  KnowledgeEntry,
  KnowledgeFolder,
} from "../types";
import {
  EntryNotFoundError,
  FolderCycleError,
  KnowledgePathConflictError,
  KnowledgeStaleVersionError,
  PathTraversalError,
} from "./errors";
import {
  ensureFolderPath,
  parsePath,
  resolvePath,
  type ResolvedPath,
} from "./path";
import * as repo from "./repository";
import { scheduleEntryEmbedding } from "./embeddings";
import { assertBaseWritable, errorCode } from "./service-shared";
import { getBaseById } from "./service-bases";

/**
 * Path-based reads + writes — the agent-friendly addressing layer.
 * Path syntax: `/`-separated names (folder.name + entry.title). The
 * unique partial index from the Item 4 migration prevents path ambiguity.
 */

export interface WriteFileByPathInput {
  body?: string;
  title?: string;
  /** Optional optimistic-concurrency precondition (the entry's
   *  `updated_at` the caller last read). Only applies when the path
   *  resolves to an existing entry; a stale value → 412. */
  expectedUpdatedAt?: string;
}

/**
 * Returns the entry at `path` with full body.
 *
 * Errors:
 *   - `PathTraversalError` if a non-final segment doesn't resolve.
 *   - `EntryNotFoundError` if only the final segment is missing OR
 *     the path resolves to a folder / the root.
 */
export async function readFileByPath(
  ctx: KnowledgeContext,
  baseId: string,
  path: string
): Promise<KnowledgeEntry> {
  const base = await getBaseById(ctx, baseId);
  const resolved = await resolvePath(ctx, base.id, path);
  if (resolved.kind === "not_found") {
    throwIfIntermediateMissing(path, resolved);
    throw new EntryNotFoundError(path);
  }
  if (resolved.kind !== "entry") {
    throw new EntryNotFoundError(path);
  }
  return resolved.entry;
}

/**
 * Helper: when a not_found result is for a non-final segment, throw
 * PathTraversalError; otherwise no-op (caller decides whether the
 * leaf miss is fatal).
 */
function throwIfIntermediateMissing(
  path: string,
  resolved: Extract<ResolvedPath, { kind: "not_found" }>
): void {
  const segments = parsePath(path);
  // The miss is on the final segment iff lastFolder + 1 == segments.length
  // (lastFolder is null when the very first segment missed).
  const resolvedDepth = resolved.lastFolder
    ? // We can't get the lastFolder's depth without walking parents —
      // but we know the missingSegment matches one of the segments.
      // Find the *first* index of segments that matches missingSegment;
      // if it's anywhere except the last, the miss is intermediate.
      segments.indexOf(resolved.missingSegment)
    : 0;
  if (resolvedDepth !== -1 && resolvedDepth < segments.length - 1) {
    throw new PathTraversalError(path, resolved.missingSegment);
  }
}

/**
 * Upsert an entry by path. If the path resolves to an existing entry,
 * update body (and title if changed). If the path doesn't exist, mkdir
 * -p any missing parent folders and create a fresh entry. The entry's
 * title defaults to the last path segment unless overridden.
 *
 * Errors:
 *   - `KnowledgePathConflictError` if the path resolves to a FOLDER.
 *     Writing to a folder path is ambiguous — caller must use a path
 *     ending in a fresh leaf name.
 *   - `AgentWriteDisabledError` if `ctx.source === "agent"` and the
 *     base's toggle is off.
 */
export async function writeFileByPath(
  ctx: KnowledgeContext,
  baseId: string,
  path: string,
  input: WriteFileByPathInput = {}
): Promise<{ entry: KnowledgeEntry; base: KnowledgeBase }> {
  const base = await getBaseById(ctx, baseId);
  await assertBaseWritable(ctx, base);

  const segments = parsePath(path);
  if (segments.length === 0) {
    throw new KnowledgePathConflictError(path);
  }

  const resolved = await resolvePath(ctx, base.id, path);
  if (resolved.kind === "folder" || resolved.kind === "root") {
    throw new KnowledgePathConflictError(path);
  }

  const leafName = segments[segments.length - 1];
  const parentSegments = segments.slice(0, -1);

  if (resolved.kind === "entry") {
    // Update existing. Only override title/body when explicitly
    // provided — undefined preserves the existing value. (On CREATE
    // below we default title to leafName because we need a value.)
    if (
      input.expectedUpdatedAt &&
      resolved.entry.updatedAt !== input.expectedUpdatedAt
    ) {
      throw new KnowledgeStaleVersionError(
        input.expectedUpdatedAt,
        resolved.entry.updatedAt
      );
    }
    let saved;
    try {
      saved = await repo.updateEntryRow(
        resolved.entry.id,
        {
          title: input.title,
          body: input.body,
          lastEditedBy: ctx.userId,
          lastEditedSource: ctx.source,
        },
        input.expectedUpdatedAt
      );
    } catch (err) {
      // Renaming onto a sibling's title trips the unique (kb, folder,
      // title) index — surface a clean 409 conflict, not a raw 500.
      if (errorCode(err) === "23505") {
        throw new KnowledgePathConflictError(
          [...parentSegments, input.title ?? leafName].join("/")
        );
      }
      throw err;
    }
    if (saved === null) {
      const fresh = await repo.findEntryById(resolved.entry.id, false);
      throw new KnowledgeStaleVersionError(
        input.expectedUpdatedAt!,
        fresh?.updatedAt ?? "concurrent"
      );
    }
    if (input.title !== undefined || input.body !== undefined) {
      scheduleEntryEmbedding(saved);
    }
    return { entry: saved, base };
  }

  // Not found — but if the caller passed a precondition it expected to
  // overwrite an existing entry that has since vanished (deleted/renamed
  // concurrently). Refuse rather than silently creating a duplicate.
  if (input.expectedUpdatedAt) {
    throw new KnowledgeStaleVersionError(input.expectedUpdatedAt, "deleted");
  }

  // mkdir -p parents, then create.
  const parentFolder = await ensureFolderPath(ctx, base.id, parentSegments);
  let created;
  try {
    created = await repo.insertEntry({
      workspaceId: ctx.workspaceId,
      knowledgeBaseId: base.id,
      folderId: parentFolder?.id ?? null,
      title: input.title ?? leafName,
      body: input.body ?? "",
      createdBy: ctx.userId,
      source: ctx.source,
    });
  } catch (err) {
    // An explicit `title` (or a leaf) that already names an active entry
    // in this folder violates the unique (kb, folder, title) index. Map
    // the raw 23505 to the clean 409 the move ops already return.
    if (errorCode(err) === "23505") {
      throw new KnowledgePathConflictError(
        [...parentSegments, input.title ?? leafName].join("/")
      );
    }
    throw err;
  }
  scheduleEntryEmbedding(created);
  return { entry: created, base };
}

/**
 * Create a folder at `path`, mkdir -p style. If every segment is
 * already a folder, no-op + return the existing leaf. If the path's
 * leaf segment is currently an entry, throws `KnowledgePathConflictError`.
 */
export async function createFolderByPath(
  ctx: KnowledgeContext,
  baseId: string,
  path: string
): Promise<KnowledgeFolder> {
  const base = await getBaseById(ctx, baseId);
  await assertBaseWritable(ctx, base);

  const segments = parsePath(path);
  if (segments.length === 0) {
    throw new KnowledgePathConflictError(path);
  }

  // Pre-check: if path resolves to an entry, refuse.
  const resolved = await resolvePath(ctx, base.id, path);
  if (resolved.kind === "entry") {
    throw new KnowledgePathConflictError(path);
  }

  const folder = await ensureFolderPath(ctx, base.id, segments);
  if (!folder) throw new KnowledgePathConflictError(path);
  return folder;
}

/**
 * Soft-delete the folder or entry at `path`. Throws when path is root,
 * doesn't exist, or `ctx.source === "agent"` with toggle off.
 */
export async function deleteByPath(
  ctx: KnowledgeContext,
  baseId: string,
  path: string
): Promise<{ kind: "folder" | "entry"; id: string }> {
  const base = await getBaseById(ctx, baseId);
  await assertBaseWritable(ctx, base);
  const resolved = await resolvePath(ctx, base.id, path);
  if (resolved.kind === "root") {
    throw new KnowledgePathConflictError("Cannot delete the base root.");
  }
  if (resolved.kind === "not_found") {
    throw new PathTraversalError(path, resolved.missingSegment);
  }
  if (resolved.kind === "folder") {
    await repo.markFolderDeleted(resolved.folder.id);
    return { kind: "folder", id: resolved.folder.id };
  }
  await repo.markEntryDeleted(resolved.entry.id);
  return { kind: "entry", id: resolved.entry.id };
}

/**
 * Move + rename in one operation. Resolves `fromPath`, computes the
 * target parent + leaf name from `toPath`, mkdir -p the target's
 * parents, then updates the row in a single repo call so the move +
 * rename is atomic.
 *
 * Cycle prevention is delegated to the underlying service `moveFolder`
 * (which calls `listFolderAncestors`) when the parent changes; for
 * pure-rename moves we skip the walk.
 */
export async function moveByPath(
  ctx: KnowledgeContext,
  baseId: string,
  fromPath: string,
  toPath: string
): Promise<{ kind: "folder" | "entry"; id: string }> {
  const base = await getBaseById(ctx, baseId);
  await assertBaseWritable(ctx, base);

  const fromResolved = await resolvePath(ctx, base.id, fromPath);
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
  const toParent = await ensureFolderPath(ctx, base.id, toParentSegments);
  const toParentId = toParent?.id ?? null;

  if (fromResolved.kind === "folder") {
    // Cycle pre-check: walking the destination's ancestors must not
    // include the folder being moved.
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
      return { kind: "folder", id: updated.id };
    } catch (err) {
      // Unique partial index collision on (kb, parent, name).
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
    return { kind: "entry", id: updated.id };
  } catch (err) {
    // Unique partial index collision on (kb, folder, title).
    if (errorCode(err) === "23505") {
      throw new KnowledgePathConflictError(toPath);
    }
    throw err;
  }
}

/**
 * List the immediate children (folders + entries) of the folder at
 * `path`, or of the base root when path is empty. Used by `kb_list_dir`.
 */
export async function listDirByPath(
  ctx: KnowledgeContext,
  baseId: string,
  path: string
): Promise<{
  folder: KnowledgeFolder | null;
  folders: KnowledgeFolder[];
  entries: KnowledgeEntry[];
}> {
  const base = await getBaseById(ctx, baseId);
  let parentId: string | null = null;
  let folder: KnowledgeFolder | null = null;
  if (path) {
    const resolved = await resolvePath(ctx, base.id, path);
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
