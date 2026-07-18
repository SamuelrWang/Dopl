import "server-only";
import type { KnowledgeContext } from "../types";
import {
  EntryNotFoundError,
  FolderNotFoundError,
  KnowledgeBaseNotFoundError,
  KnowledgeNotTrashedError,
} from "./errors";
import * as repo from "./repository";
import {
  assertAgentCanDelete,
  assertBaseVisible,
  assertBaseWritable,
  assertSameWorkspace,
} from "./service-shared";

/**
 * Permanent-delete (purge) of a single trashed base / folder / entry —
 * the hard-delete counterpart to the soft-delete + restore paths in
 * `service-base-writes` / `service-folders` / `service-entries`.
 *
 * Every purge:
 *   - resolves the row (including trashed) and asserts it's in THIS
 *     workspace (cross-workspace → mismatch error),
 *   - runs the same visibility + authorization gates as delete: a base
 *     the caller can't SEE 404s (`assertBaseVisible`); an agent may not
 *     purge a base flagged `agent_write_enabled=false` (`assertAgentCanDelete`);
 *     the caller needs `edit` on the base (`assertBaseWritable`),
 *   - refuses a LIVE row — purge only ever removes soft-deleted rows
 *     (`KnowledgeNotTrashedError`).
 *
 * FK cascades finish the job: a base's folders/entries go via
 * `knowledge_base_id ON DELETE CASCADE`; a folder's descendant folders via
 * `parent_id ON DELETE CASCADE` while its trashed entries (which are
 * `folder_id ON DELETE SET NULL`) are removed explicitly in the repo.
 */

export async function purgeBase(
  ctx: KnowledgeContext,
  id: string
): Promise<void> {
  const base = await repo.findBaseById(id, true);
  if (!base) throw new KnowledgeBaseNotFoundError(id);
  assertSameWorkspace(base.workspaceId, ctx.workspaceId, `knowledge base ${id}`);
  await assertBaseVisible(ctx, base);
  if (base.deletedAt === null) {
    throw new KnowledgeNotTrashedError("knowledge base", id);
  }
  assertAgentCanDelete(ctx, base);
  await assertBaseWritable(ctx, base);
  await repo.purgeBaseRow(ctx.workspaceId, id);
}

export async function purgeFolder(
  ctx: KnowledgeContext,
  id: string
): Promise<void> {
  const folder = await repo.findFolderById(id, true);
  if (!folder) throw new FolderNotFoundError(id);
  assertSameWorkspace(folder.workspaceId, ctx.workspaceId, `folder ${id}`);
  const base = await repo.findBaseById(folder.knowledgeBaseId, true);
  if (!base) throw new KnowledgeBaseNotFoundError(folder.knowledgeBaseId);
  await assertBaseVisible(ctx, base);
  if (folder.deletedAt === null) {
    throw new KnowledgeNotTrashedError("knowledge folder", id);
  }
  assertAgentCanDelete(ctx, base);
  await assertBaseWritable(ctx, base);
  await repo.purgeFolderRow(ctx.workspaceId, id);
}

export async function purgeEntry(
  ctx: KnowledgeContext,
  id: string
): Promise<void> {
  const entry = await repo.findEntryById(id, true);
  if (!entry) throw new EntryNotFoundError(id);
  assertSameWorkspace(entry.workspaceId, ctx.workspaceId, `entry ${id}`);
  const base = await repo.findBaseById(entry.knowledgeBaseId, true);
  if (!base) throw new KnowledgeBaseNotFoundError(entry.knowledgeBaseId);
  await assertBaseVisible(ctx, base);
  if (entry.deletedAt === null) {
    throw new KnowledgeNotTrashedError("knowledge entry", id);
  }
  assertAgentCanDelete(ctx, base);
  await assertBaseWritable(ctx, base);
  await repo.purgeEntryRow(ctx.workspaceId, id);
}
