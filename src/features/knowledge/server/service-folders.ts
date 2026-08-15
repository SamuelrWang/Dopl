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
  assertAgentCanDelete,
  assertBaseWritable,
  assertSameWorkspace,
} from "./service-shared";
import { getBaseById } from "./service-bases";

/** Folder reads + writes, plus `getBaseTree` — the snapshot shared by REST and
 *  the MCP get_tree op. */

export async function listFolders(
  ctx: KnowledgeContext,
  baseId: string
): Promise<KnowledgeFolder[]> {
  const base = await getBaseById(ctx, baseId);
  return repo.listFoldersForBase(base.id, false);
}

/**
 * Base + folders + entries, metadata only (bodies stripped). ⚠ Lives here so
 * `GET /api/knowledge/bases/[baseId]/tree` and MCP get_tree share ONE
 * composition and ONE auth path.
 *
 * Entry paging is opt-in (`entryLimit` + `entryOffset`); folders always ship
 * in full. Without `entryLimit`: full snapshot, no extra fields, no count
 * query.
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
  // Atomic CAS gate closing the read→write race the pre-check can't: null =
  // concurrent write landed; re-fetch actual version, surface stale conflict.
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
    // Destination ancestry containing the moved folder = a loop. DB trigger is
    // the safety net; this gives the caller a clean domain error first.
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

/** PERMANENT delete of a folder and its whole subtree. No trash, no restore. */
export async function deleteFolder(
  ctx: KnowledgeContext,
  id: string
): Promise<void> {
  const folder = await getFolderInternal(ctx, id, false);
  const base = await repo.findBaseById(folder.knowledgeBaseId, true);
  if (!base) throw new KnowledgeBaseNotFoundError(folder.knowledgeBaseId);
  // F-10: honor the parent base's agent-read-only flag here too — an agent
  // API key can hit this route directly, not only via MCP.
  assertAgentCanDelete(ctx, base);
  await assertBaseWritable(ctx, base);
  await repo.hardDeleteFolder(ctx.workspaceId, id);
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
