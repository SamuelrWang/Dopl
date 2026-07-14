import "server-only";
import type {
  KnowledgeBase,
  KnowledgeContext,
  KnowledgeEntry,
  KnowledgeFolder,
} from "../types";
import type {
  KnowledgeFolderCreateInput,
  KnowledgeFolderMoveInput,
  KnowledgeFolderUpdateInput,
} from "../schema";
import {
  FolderCycleError,
  FolderNotFoundError,
  KnowledgeBaseMismatchError,
  KnowledgeBaseNotFoundError,
  KnowledgeStaleVersionError,
} from "./errors";
import * as repo from "./repository";
import {
  assertAncestorsActive,
  assertBaseVisible,
  assertBaseWritable,
  assertSameWorkspace,
} from "./service-shared";
import { getBaseById } from "./service-bases";

/**
 * Knowledge folder reads + writes, plus `getBaseTree` (the base + folder
 * + entry-metadata snapshot shared by REST and the MCP get_tree op).
 */

export async function listFolders(
  ctx: KnowledgeContext,
  baseId: string
): Promise<KnowledgeFolder[]> {
  const base = await getBaseById(ctx, baseId);
  return repo.listFoldersForBase(base.id, false);
}

/**
 * Snapshot of a base + its folders + entries (metadata only — bodies
 * stripped). Used by `GET /api/knowledge/bases/[baseId]/tree` and the
 * MCP get_tree op. Lives here so REST and MCP share one composition and
 * one auth path.
 *
 * Entry paging is opt-in (`entryLimit` + `entryOffset`): folders always
 * ship in full (they're the light structure), entries page. Without
 * `entryLimit` the response is the legacy full snapshot — no extra
 * fields, no count query.
 */
export async function getBaseTree(
  ctx: KnowledgeContext,
  baseId: string,
  opts?: { entryLimit: number; entryOffset: number }
): Promise<{
  base: KnowledgeBase;
  folders: KnowledgeFolder[];
  entries: KnowledgeEntry[];
  entryTotal?: number;
  nextEntryCursor?: string | null;
}> {
  const base = await getBaseById(ctx, baseId);
  const [folders, entries, entryTotal] = await Promise.all([
    repo.listFoldersForBase(base.id, false),
    repo.listEntriesForBase(base.id, {
      includeBody: false,
      includeDeleted: false,
      ...(opts ? { limit: opts.entryLimit, offset: opts.entryOffset } : {}),
    }),
    opts ? repo.countEntriesForBase(base.id) : Promise.resolve(undefined),
  ]);
  if (!opts || entryTotal === undefined) return { base, folders, entries };
  const nextOffset = opts.entryOffset + entries.length;
  return {
    base,
    folders,
    entries,
    entryTotal,
    nextEntryCursor: nextOffset < entryTotal ? String(nextOffset) : null,
  };
}

export async function createFolder(
  ctx: KnowledgeContext,
  input: KnowledgeFolderCreateInput
): Promise<KnowledgeFolder> {
  const base = await getBaseById(ctx, input.knowledgeBaseId);
  await assertBaseWritable(ctx, base);
  if (input.parentId) {
    const parent = await repo.findFolderById(input.parentId, false);
    if (!parent) throw new FolderNotFoundError(input.parentId);
    assertSameWorkspace(parent.workspaceId, ctx.workspaceId, "parent folder");
    if (parent.knowledgeBaseId !== base.id) {
      throw new KnowledgeBaseMismatchError(
        `Folder ${input.parentId} belongs to a different knowledge base`
      );
    }
  }
  return repo.insertFolder({
    workspaceId: ctx.workspaceId,
    knowledgeBaseId: base.id,
    parentId: input.parentId ?? null,
    name: input.name,
    description: input.description ?? null,
    position: input.position,
    createdBy: ctx.userId,
  });
}

export async function updateFolder(
  ctx: KnowledgeContext,
  id: string,
  patch: KnowledgeFolderUpdateInput,
  expectedUpdatedAt?: string
): Promise<KnowledgeFolder> {
  const folder = await getFolderInternal(ctx, id, false);
  const base = await repo.findBaseById(folder.knowledgeBaseId, true);
  if (!base) throw new KnowledgeBaseNotFoundError(folder.knowledgeBaseId);
  await assertBaseWritable(ctx, base);
  if (expectedUpdatedAt && folder.updatedAt !== expectedUpdatedAt) {
    throw new KnowledgeStaleVersionError(expectedUpdatedAt, folder.updatedAt);
  }
  // Atomic CAS gate (closes the read→write race the pre-check above
  // can't): null means a concurrent write landed; re-fetch for the
  // actual version and surface the stale conflict.
  const saved = await repo.updateFolderRow(id, patch, expectedUpdatedAt);
  if (saved === null) {
    const fresh = await getFolderInternal(ctx, id, false);
    throw new KnowledgeStaleVersionError(expectedUpdatedAt!, fresh.updatedAt);
  }
  return saved;
}

export async function moveFolder(
  ctx: KnowledgeContext,
  id: string,
  input: KnowledgeFolderMoveInput
): Promise<KnowledgeFolder> {
  const folder = await getFolderInternal(ctx, id, false);
  const base = await repo.findBaseById(folder.knowledgeBaseId, true);
  if (!base) throw new KnowledgeBaseNotFoundError(folder.knowledgeBaseId);
  await assertBaseWritable(ctx, base);

  if (input.parentId !== null) {
    const newParent = await repo.findFolderById(input.parentId, false);
    if (!newParent) throw new FolderNotFoundError(input.parentId);
    assertSameWorkspace(newParent.workspaceId, ctx.workspaceId, "destination folder");
    if (newParent.knowledgeBaseId !== folder.knowledgeBaseId) {
      throw new KnowledgeBaseMismatchError(
        `Cannot move folder ${id} across knowledge bases`
      );
    }
    // Cycle pre-check: walk the destination's ancestry; if it contains
    // the folder being moved, we'd create a loop. The DB trigger is the
    // safety net but this gives the caller a clean domain error first.
    const ancestors = await repo.listFolderAncestors(newParent.id);
    if (ancestors.some((a) => a.id === folder.id)) {
      throw new FolderCycleError(folder.id, newParent.id);
    }
  }

  return repo.updateFolderRow(id, {
    parentId: input.parentId,
    position: input.position,
  });
}

export async function softDeleteFolder(
  ctx: KnowledgeContext,
  id: string
): Promise<void> {
  const folder = await getFolderInternal(ctx, id, false);
  const base = await repo.findBaseById(folder.knowledgeBaseId, true);
  if (!base) throw new KnowledgeBaseNotFoundError(folder.knowledgeBaseId);
  await assertBaseWritable(ctx, base);
  await repo.markFolderDeleted(id);
}

export async function restoreFolder(
  ctx: KnowledgeContext,
  id: string
): Promise<KnowledgeFolder> {
  const folder = await getFolderInternal(ctx, id, true);
  const base = await repo.findBaseById(folder.knowledgeBaseId, true);
  if (!base) throw new KnowledgeBaseNotFoundError(folder.knowledgeBaseId);
  await assertBaseVisible(ctx, base);
  await assertBaseWritable(ctx, base);
  await assertAncestorsActive(folder.parentId);
  return repo.restoreFolderRow(id);
}

async function getFolderInternal(
  ctx: KnowledgeContext,
  id: string,
  includeDeleted: boolean
): Promise<KnowledgeFolder> {
  const folder = await repo.findFolderById(id, includeDeleted);
  if (!folder) throw new FolderNotFoundError(id);
  assertSameWorkspace(folder.workspaceId, ctx.workspaceId, `folder ${id}`);
  return folder;
}
