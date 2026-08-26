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
  filterTeamVisibleBases,
} from "./service-shared";
import { getBaseById } from "./service-bases";
import { assertStorageHeadroom, bodyBytes } from "./service-storage";

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
 * One entry by id.
 *
 * 🔒 IT CHASES THE ENTRY UP TO ITS BASE AND RE-ASKS THE BASE'S OWN QUESTION
 * (2026-08-26). This used to check `assertSameWorkspace` and nothing else, and
 * that was a hole with three tenants: (1) `GET /api/knowledge/entries/[entryId]`
 * runs at the viewer default, so ANY workspace viewer could pull the body of an
 * entry in a `visibility='private'` base they cannot see — the service-role
 * route was strictly WIDER than the RLS policy behind it, which correctly
 * requires `public OR created_by = auth.uid()`; (2) the M-10 tightening (a
 * workspace-scoped key never sees a private base) was bypassed; (3) the AUDIENCE
 * CEILING was bypassed, so a locked agent credential could read an ungranted
 * base's entries one id at a time. ⚠ **Entry ids are obtainable** — ontology
 * attributes of `kind:"knowledge"` ship raw entry-id arrays and `dopl_ontology`
 * is an auto-allowed read tool — so "you need the id" was never the fence.
 *
 * ⚠ `export.ts › buildEntryFile` had ALREADY worked this out for itself and
 * added its own `getBaseById` beside the comment *"getEntry only checks
 * workspace — gate on base visibility too"*. That call is now redundant rather
 * than load-bearing, and it is deliberately left in place as belt: a second
 * `getBaseById` on a row already in hand is one memoized lookup, and deleting it
 * would remove the evidence that this file's gate is what closed it.
 *
 * ⚠ A refusal is `EntryNotFoundError`, NOT the base's error — "this entry does
 * not exist", "its base is invisible to you" and "its base is outside your
 * audience" are ONE answer, the same 404-not-403 rule `service-bases.ts`
 * applies one level up. Leaking `KNOWLEDGE_BASE_NOT_FOUND` here would tell a
 * caller that the id it guessed was a real entry in a base it may not see.
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

/** `getBaseById`'s two gates (visibility + audience ceiling), re-answered as a
 *  404 about the ENTRY. Composed rather than restated so a new gate added to the
 *  foundational lookup reaches entry reads for free. */
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
 * Names for a set of entry ids (`GET /api/knowledge/entries?ids=`).
 * ⚠ Applies the SAME base-visibility gating as `listBases` — `canSeeBase` for
 * M-10 + api-key scope, `filterTeamVisibleBases` for teams, AND the agent
 * AUDIENCE CEILING. Entries under an unreadable base are silently DROPPED, never
 * leaked; unknown / cross-workspace / trashed ids simply don't resolve.
 *
 * 🔒 THE CEILING HALF WAS MISSING UNTIL 2026-08-26, and this route is the one
 * that makes entry ids cheap: ontology attributes of `kind:"knowledge"` ship raw
 * entry-id arrays, so an agent under the ceiling could resolve 100 ids per
 * request against bases that were never granted into its container. It is the
 * `listBases` filter verbatim — `resolveAgentAudience` once for the request,
 * `audienceAdmits` per base — so the two lists cannot answer differently.
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
  const audience = await resolveAgentAudience(ctx);
  const readable = (
    await filterTeamVisibleBases(
      ctx,
      bases.filter((b) => b.deletedAt === null && canSeeBase(ctx, b))
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
  await repo.hardDeleteEntry(ctx.workspaceId, id);
}
