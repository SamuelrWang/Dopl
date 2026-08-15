import "server-only";
import type { KnowledgeContext, KnowledgeEntry } from "../types";
import type {
  KnowledgeEntryCreateInput,
  KnowledgeEntryMoveInput,
  KnowledgeEntryUpdateInput,
} from "../schema";
import {
  EntryNotFoundError,
  FolderNotFoundError,
  KnowledgeBaseMismatchError,
  KnowledgeBaseNotFoundError,
  KnowledgeStaleVersionError,
} from "./errors";
import * as repo from "./repository";
import { scheduleEntryEmbedding } from "./embeddings";
import {
  assertAgentCanDelete,
  assertBaseWritable,
  assertSameWorkspace,
  canSeeBase,
  filterTeamVisibleBases,
} from "./service-shared";
import { getBaseById } from "./service-bases";
import { assertStorageHeadroom, bodyBytes } from "./service-storage";

/**
 * Knowledge entry reads + writes, plus `resolveEntryRefs` (the
 * visibility-gated id→name resolver for ontology knowledge attributes).
 */

export interface ListEntriesOpts {
  folderId?: string | null;
  includeBody?: boolean;
}

export async function listEntries(
  ctx: KnowledgeContext,
  baseId: string,
  opts: ListEntriesOpts = {}
): Promise<KnowledgeEntry[]> {
  const base = await getBaseById(ctx, baseId);
  return repo.listEntriesForBase(base.id, {
    folderId: opts.folderId,
    includeBody: opts.includeBody,
    includeDeleted: false,
  });
}

export async function getEntry(
  ctx: KnowledgeContext,
  id: string
): Promise<KnowledgeEntry> {
  const entry = await repo.findEntryById(id, false);
  if (!entry) throw new EntryNotFoundError(id);
  assertSameWorkspace(entry.workspaceId, ctx.workspaceId, `entry ${id}`);
  return entry;
}

export interface KnowledgeEntryRef {
  id: string;
  title: string;
  baseId: string;
  baseName: string;
}

/**
 * Names for a set of entry ids — display resolution for ontology
 * knowledge-attribute refs (`GET /api/knowledge/entries?ids=`). Applies
 * the SAME base-visibility gating as `listBases` (M-10 private/public +
 * api-key scope via `canSeeBase`, teams scope via `filterTeamVisibleBases`):
 * an entry whose base the caller can't read is silently dropped, never
 * leaked. Unknown / cross-workspace / trashed ids simply don't resolve.
 */
export async function resolveEntryRefs(
  ctx: KnowledgeContext,
  ids: string[]
): Promise<KnowledgeEntryRef[]> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return [];
  const entries = await repo.listEntriesByIds(ctx.workspaceId, unique);
  if (entries.length === 0) return [];
  const baseIds = [...new Set(entries.map((e) => e.knowledgeBaseId))];
  const bases = await repo.listBasesByIds(ctx.workspaceId, baseIds);
  const readable = await filterTeamVisibleBases(
    ctx,
    bases.filter((b) => b.deletedAt === null && canSeeBase(ctx, b))
  );
  const nameByBaseId = new Map(readable.map((b) => [b.id, b.name]));
  return entries.flatMap((e) => {
    const baseName = nameByBaseId.get(e.knowledgeBaseId);
    if (baseName === undefined) return [];
    return [{ id: e.id, title: e.title, baseId: e.knowledgeBaseId, baseName }];
  });
}

export async function createEntry(
  ctx: KnowledgeContext,
  input: KnowledgeEntryCreateInput
): Promise<KnowledgeEntry> {
  const base = await getBaseById(ctx, input.knowledgeBaseId);
  await assertBaseWritable(ctx, base);
  if (input.folderId) {
    const folder = await repo.findFolderById(input.folderId, false);
    if (!folder) throw new FolderNotFoundError(input.folderId);
    assertSameWorkspace(folder.workspaceId, ctx.workspaceId, "target folder");
    if (folder.knowledgeBaseId !== base.id) {
      throw new KnowledgeBaseMismatchError(
        `Folder ${input.folderId} belongs to a different knowledge base`
      );
    }
  }
  // Storage gate. A create is pure growth, so its delta is the whole body.
  await assertStorageHeadroom(ctx, base, bodyBytes(input.body));
  const created = await repo.insertEntry({
    workspaceId: ctx.workspaceId,
    knowledgeBaseId: base.id,
    folderId: input.folderId ?? null,
    title: input.title,
    excerpt: input.excerpt ?? null,
    body: input.body,
    entryType: input.entryType,
    position: input.position,
    createdBy: ctx.userId,
    source: ctx.source,
  });
  scheduleEntryEmbedding(created);
  return created;
}

export async function updateEntry(
  ctx: KnowledgeContext,
  id: string,
  patch: KnowledgeEntryUpdateInput,
  expectedUpdatedAt?: string
): Promise<KnowledgeEntry> {
  const entry = await getEntry(ctx, id);
  const base = await repo.findBaseById(entry.knowledgeBaseId, true);
  if (!base) throw new KnowledgeBaseNotFoundError(entry.knowledgeBaseId);
  await assertBaseWritable(ctx, base);
  if (expectedUpdatedAt && entry.updatedAt !== expectedUpdatedAt) {
    throw new KnowledgeStaleVersionError(expectedUpdatedAt, entry.updatedAt);
  }
  // Storage gate, on the NET delta. `patch.body === undefined` leaves the
  // column alone, so a title/position-only patch has no delta at all — and a
  // shrink is negative, which `assertStorageHeadroom` waves through even when
  // the base is already over cap (that edit is the way OUT of the hole).
  if (patch.body !== undefined) {
    await assertStorageHeadroom(
      ctx,
      base,
      bodyBytes(patch.body) - bodyBytes(entry.body)
    );
  }
  const saved = await repo.updateEntryRow(
    id,
    {
      title: patch.title,
      // Pass through as-is: undefined skips the column, null clears it.
      excerpt: patch.excerpt,
      body: patch.body,
      entryType: patch.entryType,
      position: patch.position,
      lastEditedBy: ctx.userId,
      lastEditedSource: ctx.source,
    },
    expectedUpdatedAt
  );
  // null = atomic CAS lost the race (a concurrent write landed between
  // the read above and this write). Re-fetch for the actual version.
  if (saved === null) {
    const fresh = await getEntry(ctx, id);
    throw new KnowledgeStaleVersionError(expectedUpdatedAt!, fresh.updatedAt);
  }
  // Content changed → refresh chunk embeddings in the background.
  // (Position/folder-only patches skip; the hash check inside would
  // no-op anyway, but don't even schedule.)
  if (patch.title !== undefined || patch.body !== undefined) {
    scheduleEntryEmbedding(saved);
  }
  return saved;
}

export async function moveEntry(
  ctx: KnowledgeContext,
  id: string,
  input: KnowledgeEntryMoveInput
): Promise<KnowledgeEntry> {
  const entry = await getEntry(ctx, id);
  const base = await repo.findBaseById(entry.knowledgeBaseId, true);
  if (!base) throw new KnowledgeBaseNotFoundError(entry.knowledgeBaseId);
  await assertBaseWritable(ctx, base);

  if (input.folderId !== null) {
    const folder = await repo.findFolderById(input.folderId, false);
    if (!folder) throw new FolderNotFoundError(input.folderId);
    assertSameWorkspace(folder.workspaceId, ctx.workspaceId, "destination folder");
    if (folder.knowledgeBaseId !== entry.knowledgeBaseId) {
      throw new KnowledgeBaseMismatchError(
        `Cannot move entry ${id} across knowledge bases`
      );
    }
  }

  return repo.updateEntryRow(id, {
    folderId: input.folderId,
    position: input.position,
    lastEditedBy: ctx.userId,
    lastEditedSource: ctx.source,
  });
}

/**
 * PERMANENTLY delete an entry. No trash, no restore (2026-08-07). Gates
 * unchanged from the old soft-delete path.
 */
export async function deleteEntry(
  ctx: KnowledgeContext,
  id: string
): Promise<void> {
  const entry = await getEntry(ctx, id);
  const base = await repo.findBaseById(entry.knowledgeBaseId, true);
  if (!base) throw new KnowledgeBaseNotFoundError(entry.knowledgeBaseId);
  // F-10: honor the parent base's agent-read-only flag on the by-id delete
  // route too (an agent API key can hit this directly, not just via MCP).
  assertAgentCanDelete(ctx, base);
  await assertBaseWritable(ctx, base);
  await repo.hardDeleteEntry(ctx.workspaceId, id);
}
