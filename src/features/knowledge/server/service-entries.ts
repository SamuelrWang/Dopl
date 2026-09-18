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
import { audienceAdmits, resolveAgentAudience } from "./service-audience";
import {
  assertAgentCanDelete,
  assertBaseWritable,
  assertSameWorkspace,
  canSeeBase,
  baseGrantsFor,
  filterTeamVisibleBases,
} from "./service-shared";
import { getBaseById, readBaseById } from "./service-bases";
import { assertStorageHeadroom, bodyBytes } from "./service-storage";
// The capture is awaited, inside the request, after each write — a lost
// revision is a lost audit (`./service-revisions.ts`).
import { entryOpFor, entryPath, recordEntryRevision } from "./service-revisions";
import type { RevisionOp } from "@/features/revisions/types";

/** Entry reads + writes, plus `resolveEntryRefs` — the visibility-gated
 *  id→name resolver for ontology knowledge attributes. */

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

/**
 * One entry by id. It chases the entry up to its base and re-asks the base's own
 * question (2026-08-26): `assertSameWorkspace` alone let any workspace viewer
 * pull the body of an entry in a private base, and bypassed both the M-10
 * api-key tightening and the agent audience ceiling. Entry ids are cheap —
 * ontology `kind:"knowledge"` attributes ship raw entry-id arrays — so "you
 * need the id" was never the fence.
 *
 * `export.ts › buildEntryFile` had ALREADY worked this out for itself and
 * added its own `getBaseById`; that call is now redundant belt, left in place.
 *
 * A refusal is `EntryNotFoundError`, never the base's error: leaking
 * `KNOWLEDGE_BASE_NOT_FOUND` would confirm the guessed id names a real entry.
 */
export async function getEntry(
  ctx: KnowledgeContext,
  id: string
): Promise<KnowledgeEntry> {
  const entry = await repo.findEntryById(id, false);
  if (!entry) throw new EntryNotFoundError(id);
  assertSameWorkspace(entry.workspaceId, ctx.workspaceId, `entry ${id}`);
  await assertEntryBaseReadable(ctx, entry, id);
  return entry;
}

/**
 * The id-resolving read (B2) — the entry follows its BASE's id.
 *
 * An entry has no tenancy of its own to resolve, so it is not a row in the
 * resolver registry: `knowledge_entries` carries no `visibility` column and its
 * base is both its address and its fence. What follows the id is
 * `service-bases.ts › readBaseById`, and the base's two gates then run in the
 * container the BASE lives in.
 *
 * `knowledge_entries.workspace_id` is a denormalized copy of its base's; a row
 * where the two disagree is a broken row and resolves as the same single 404,
 * which is `EntryNotFoundError`, never the base's error.
 *
 * {@link getEntry} stays workspace-keyed and is the WRITE gate: `updateEntry`,
 * `moveEntry`, `deleteEntry` and `service-pins.ts` funnel through it
 * (INVARIANTS §T35).
 */
export async function readEntry(
  ctx: KnowledgeContext,
  id: string
): Promise<KnowledgeEntry> {
  const entry = await repo.findEntryById(id, false);
  if (!entry) throw new EntryNotFoundError(id);
  const base = await readEntryBase(ctx, entry.knowledgeBaseId);
  if (!base || base.workspaceId !== entry.workspaceId) {
    throw new EntryNotFoundError(id);
  }
  return entry;
}

/** {@link readBaseById}'s answer as a `null`. Composed rather than restated so a
 *  new gate on the base lookup reaches entry reads for free. */
async function readEntryBase(ctx: KnowledgeContext, baseId: string) {
  try {
    return await readBaseById(ctx, baseId);
  } catch (err) {
    if (err instanceof KnowledgeBaseNotFoundError) return null;
    throw err;
  }
}

/** `getBaseById`'s two gates (visibility + audience ceiling), re-answered as a
 *  404 about the ENTRY. */
async function assertEntryBaseReadable(
  ctx: KnowledgeContext,
  entry: KnowledgeEntry,
  id: string
): Promise<void> {
  try {
    await getBaseById(ctx, entry.knowledgeBaseId);
  } catch (err) {
    if (err instanceof KnowledgeBaseNotFoundError) throw new EntryNotFoundError(id);
    throw err;
  }
}

export interface KnowledgeEntryRef {
  id: string;
  title: string;
  baseId: string;
  baseName: string;
}

/**
 * Names for a set of entry ids (`GET /api/knowledge/entries?ids=`). It is the
 * `listBases` filter verbatim — `canSeeBase`, `filterTeamVisibleBases` and the
 * agent audience ceiling — so the two lists cannot answer differently. Entries
 * under an unreadable base are silently dropped.
 *
 * The ceiling half was missing until 2026-08-26, and this route is what makes
 * entry ids cheap: 100 ids per request against bases never granted in.
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
  const [audience, granted] = await Promise.all([
    resolveAgentAudience(ctx),
    baseGrantsFor(ctx, bases),
  ]);
  const readable = (
    await filterTeamVisibleBases(
      ctx,
      bases.filter((b) => b.deletedAt === null && canSeeBase(ctx, b, granted))
    )
  ).filter((b) => audienceAdmits(audience, b.id));
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
  // Storage gate: a create is pure growth, delta = whole body.
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
  await recordEntryRevision(ctx, created, "create");
  return created;
}

/** What a RESTORE asks this write to record instead of its derived op — see
 *  `./service-revisions-read.ts › restoreEntryRevision`. */
export interface EntryWriteRevision {
  op: RevisionOp;
  summary: string;
}

export async function updateEntry(
  ctx: KnowledgeContext,
  id: string,
  patch: KnowledgeEntryUpdateInput,
  expectedUpdatedAt?: string,
  revision?: EntryWriteRevision
): Promise<KnowledgeEntry> {
  const entry = await getEntry(ctx, id);
  const base = await repo.findBaseById(entry.knowledgeBaseId, true);
  if (!base) throw new KnowledgeBaseNotFoundError(entry.knowledgeBaseId);
  await assertBaseWritable(ctx, base);
  if (expectedUpdatedAt && entry.updatedAt !== expectedUpdatedAt) {
    throw new KnowledgeStaleVersionError(expectedUpdatedAt, entry.updatedAt);
  }
  // Storage gate on the NET delta. `patch.body === undefined` leaves the
  // column alone (no delta); a shrink is negative and `assertStorageHeadroom`
  // waves it through even over cap — that edit is the way OUT of the hole.
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
      // As-is: undefined skips column, null clears.
      excerpt: patch.excerpt,
      body: patch.body,
      entryType: patch.entryType,
      position: patch.position,
      lastEditedBy: ctx.userId,
      lastEditedSource: ctx.source,
    },
    expectedUpdatedAt
  );
  // null = CAS lost the race to a concurrent write. Re-fetch actual version.
  if (saved === null) {
    const fresh = await getEntry(ctx, id);
    throw new KnowledgeStaleVersionError(expectedUpdatedAt!, fresh.updatedAt);
  }
  // Content changed → refresh chunk embeddings in background. Position/folder
  // -only patches skip scheduling entirely (the hash check would no-op).
  if (patch.title !== undefined || patch.body !== undefined) {
    scheduleEntryEmbedding(saved);
  }
  await recordEntryRevision(ctx, saved, revision?.op ?? entryOpFor(patch), {
    summary: revision?.summary ?? null,
  });
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

  const moved = await repo.updateEntryRow(id, {
    folderId: input.folderId,
    position: input.position,
    lastEditedBy: ctx.userId,
    lastEditedSource: ctx.source,
  });
  await recordEntryRevision(ctx, moved, "move");
  return moved;
}

/** PERMANENT delete of an entry. No trash, no restore. */
export async function deleteEntry(
  ctx: KnowledgeContext,
  id: string
): Promise<void> {
  const entry = await getEntry(ctx, id);
  const base = await repo.findBaseById(entry.knowledgeBaseId, true);
  if (!base) throw new KnowledgeBaseNotFoundError(entry.knowledgeBaseId);
  // F-10: honor the parent base's agent-read-only flag here too — an agent
  // API key can hit this route directly, not only via MCP.
  assertAgentCanDelete(ctx, base);
  await assertBaseWritable(ctx, base);
  // path derived before the row goes: `entryPath` walks the folder chain, and
  // the delete's snapshot is the only surviving copy — deletes are permanent.
  const path = await entryPath(entry);
  await repo.hardDeleteEntry(ctx.workspaceId, id);
  await recordEntryRevision(ctx, entry, "delete", { path });
}
