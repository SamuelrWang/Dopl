import "server-only";
import { supabaseAdmin } from "@/shared/supabase/admin";
import { slugify } from "@/shared/lib/slug/slugify";
import type {
  KnowledgeBase,
  KnowledgeFolder,
  KnowledgeEntry,
  KnowledgeContext,
} from "../types";
import type {
  KnowledgeBaseCreateInput,
  KnowledgeBaseUpdateInput,
  KnowledgeFolderCreateInput,
  KnowledgeFolderUpdateInput,
  KnowledgeFolderMoveInput,
  KnowledgeEntryCreateInput,
  KnowledgeEntryUpdateInput,
  KnowledgeEntryMoveInput,
} from "../schema";
import {
  AgentWriteDisabledError,
  EntryNotFoundError,
  FolderCycleError,
  FolderNotFoundError,
  KnowledgeBaseMismatchError,
  KnowledgeBaseNotFoundError,
  KnowledgeBaseSlugConflictError,
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
import { buildSeedKnowledgeBases } from "./seed";

/**
 * Service layer for the knowledge feature.
 *
 * Single source of truth — REST handlers (Item 2) and MCP tools (Item 4)
 * both call into this. The service:
 *   - Builds `KnowledgeContext` from auth metadata at the route boundary.
 *   - Enforces the per-base `agent_write_enabled` toggle for any
 *     `source: "agent"` mutation.
 *   - Resolves slugs / IDs into rows, validates workspace scope, throws
 *     domain errors that the route layer maps to HTTP responses.
 *   - Walks the folder tree for cycle detection on `moveFolder`.
 *   - Lazy-seeds brand-new workspaces with the legacy fixtures via
 *     `listBases`.
 *
 * The repository (`./repository.ts`) does raw I/O and bypasses RLS via
 * the service-role client — so every method here MUST filter by
 * `ctx.workspaceId` (or chase a row up to a base and verify scope) to
 * stop cross-workspace leakage.
 */

const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;
const SLUG_RETRY_MAX = 3;

// ─── Context construction ───────────────────────────────────────────

export interface AuthLike {
  userId: string;
  workspaceId: string;
  apiKeyId?: string | null;
}

/**
 * Translates a `withWorkspaceAuth` (or MCP equivalent) auth result into
 * a `KnowledgeContext`. Source is derived from the presence of an API
 * key — session callers are users; API-key callers are agents.
 */
export function buildKnowledgeContext(auth: AuthLike): KnowledgeContext {
  return {
    workspaceId: auth.workspaceId,
    userId: auth.userId,
    source: auth.apiKeyId ? "agent" : "user",
  };
}

// ─── Base reads ─────────────────────────────────────────────────────

/**
 * Returns active knowledge bases for the workspace. Triggers a lazy
 * seed when the workspace has zero bases AND was created within the
 * last 24 hours — keeps the empty-state nice for fresh workspaces
 * without re-seeding mature workspaces that intentionally cleared
 * everything.
 */
export async function listBases(
  ctx: KnowledgeContext
): Promise<KnowledgeBase[]> {
  const existing = await repo.listBasesForWorkspace(ctx.workspaceId, false);
  if (existing.length > 0) return existing;
  const workspaceCreatedAt = await fetchWorkspaceCreatedAt(ctx.workspaceId);
  if (
    workspaceCreatedAt !== null &&
    Date.now() - workspaceCreatedAt.getTime() < TWENTY_FOUR_HOURS_MS
  ) {
    await seedWorkspace(ctx);
    return repo.listBasesForWorkspace(ctx.workspaceId, false);
  }
  return existing;
}

export async function getBaseById(
  ctx: KnowledgeContext,
  id: string
): Promise<KnowledgeBase> {
  const base = await repo.findBaseById(id, false);
  if (!base) throw new KnowledgeBaseNotFoundError(id);
  assertSameWorkspace(base.workspaceId, ctx.workspaceId, `knowledge base ${id}`);
  return base;
}

export async function getBaseBySlug(
  ctx: KnowledgeContext,
  slug: string
): Promise<KnowledgeBase> {
  const base = await repo.findBaseBySlug(ctx.workspaceId, slug, false);
  if (!base) throw new KnowledgeBaseNotFoundError(slug);
  return base;
}

// ─── Base writes ────────────────────────────────────────────────────

export async function createBase(
  ctx: KnowledgeContext,
  input: KnowledgeBaseCreateInput
): Promise<KnowledgeBase> {
  // Agent gate: creating a base is a workspace-level action, but the
  // toggle is per-base — it doesn't apply to creation. (You can't have
  // a base with the toggle off until that base exists.) Agent-origin
  // creates are allowed by default; tighten in Item 4 if needed.

  let attempt = 0;
  let baseSlug =
    input.slug ?? deriveSlug(input.name, await listSlugs(ctx.workspaceId));

  while (true) {
    try {
      return await repo.insertBase({
        workspaceId: ctx.workspaceId,
        name: input.name,
        slug: baseSlug,
        description: input.description ?? null,
        agentWriteEnabled: input.agentWriteEnabled ?? false,
        createdBy: ctx.userId,
      });
    } catch (err) {
      const code = errorCode(err);
      if (code === "23505" && attempt < SLUG_RETRY_MAX) {
        attempt += 1;
        baseSlug = deriveSlug(input.name, await listSlugs(ctx.workspaceId));
        continue;
      }
      // Retries exhausted on slug collision — surface a clean 409
      // rather than a raw Postgres error.
      if (code === "23505") {
        throw new KnowledgeBaseSlugConflictError(baseSlug);
      }
      throw err;
    }
  }
}

export async function updateBase(
  ctx: KnowledgeContext,
  id: string,
  patch: KnowledgeBaseUpdateInput
): Promise<KnowledgeBase> {
  const base = await getBaseById(ctx, id);
  // Updating the toggle itself is a settings change — agents can't
  // flip it, regardless of the toggle's current state. Other writes
  // (name, description, slug) honor the toggle if it's off.
  if (ctx.source === "agent" && patch.agentWriteEnabled !== undefined) {
    throw new AgentWriteDisabledError(base.id);
  }
  if (ctx.source === "agent" && !base.agentWriteEnabled) {
    throw new AgentWriteDisabledError(base.id);
  }
  if (patch.slug && patch.slug !== base.slug) {
    const taken = await repo.listBaseSlugsForWorkspace(ctx.workspaceId);
    if (taken.includes(patch.slug)) {
      throw new KnowledgeBaseSlugConflictError(patch.slug);
    }
  }
  try {
    return await repo.updateBaseRow(id, {
      name: patch.name,
      slug: patch.slug,
      // Pass through as-is: undefined skips the column, null clears it.
      description: patch.description,
      agentWriteEnabled: patch.agentWriteEnabled,
    });
  } catch (err) {
    // Catch the rare race where two concurrent PATCHes both passed
    // the pre-check and one collides on UPDATE.
    if (errorCode(err) === "23505" && patch.slug) {
      throw new KnowledgeBaseSlugConflictError(patch.slug);
    }
    throw err;
  }
}

export async function softDeleteBase(
  ctx: KnowledgeContext,
  id: string
): Promise<void> {
  const base = await getBaseById(ctx, id);
  if (ctx.source === "agent" && !base.agentWriteEnabled) {
    throw new AgentWriteDisabledError(base.id);
  }
  await repo.markBaseDeleted(id);
}

export async function restoreBase(
  ctx: KnowledgeContext,
  id: string
): Promise<KnowledgeBase> {
  const base = await repo.findBaseById(id, true);
  if (!base) throw new KnowledgeBaseNotFoundError(id);
  assertSameWorkspace(base.workspaceId, ctx.workspaceId, `knowledge base ${id}`);
  if (ctx.source === "agent" && !base.agentWriteEnabled) {
    throw new AgentWriteDisabledError(base.id);
  }
  return repo.restoreBaseRow(id);
}

// ─── Folder reads ───────────────────────────────────────────────────

export async function listFolders(
  ctx: KnowledgeContext,
  baseId: string
): Promise<KnowledgeFolder[]> {
  const base = await getBaseById(ctx, baseId);
  return repo.listFoldersForBase(base.id, false);
}

/**
 * Snapshot of a base + its folders + entries (metadata only — bodies
 * stripped). Used by `GET /api/knowledge/bases/[baseId]/tree` and
 * (eventually) MCP `kb_list_tree`. Lives here so REST and MCP share
 * one composition and one auth path.
 */
export async function getBaseTree(
  ctx: KnowledgeContext,
  baseId: string
): Promise<{
  base: KnowledgeBase;
  folders: KnowledgeFolder[];
  entries: KnowledgeEntry[];
}> {
  const base = await getBaseById(ctx, baseId);
  const [folders, entries] = await Promise.all([
    repo.listFoldersForBase(base.id, false),
    repo.listEntriesForBase(base.id, { includeBody: false, includeDeleted: false }),
  ]);
  return { base, folders, entries };
}

// ─── Folder writes ──────────────────────────────────────────────────

export async function createFolder(
  ctx: KnowledgeContext,
  input: KnowledgeFolderCreateInput
): Promise<KnowledgeFolder> {
  const base = await getBaseById(ctx, input.knowledgeBaseId);
  await assertAgentWriteAllowed(ctx, base);
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
  await assertAgentWriteAllowed(ctx, base);
  if (expectedUpdatedAt && folder.updatedAt !== expectedUpdatedAt) {
    throw new KnowledgeStaleVersionError(expectedUpdatedAt, folder.updatedAt);
  }
  return repo.updateFolderRow(id, patch);
}

export async function moveFolder(
  ctx: KnowledgeContext,
  id: string,
  input: KnowledgeFolderMoveInput
): Promise<KnowledgeFolder> {
  const folder = await getFolderInternal(ctx, id, false);
  const base = await repo.findBaseById(folder.knowledgeBaseId, true);
  if (!base) throw new KnowledgeBaseNotFoundError(folder.knowledgeBaseId);
  await assertAgentWriteAllowed(ctx, base);

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
  await assertAgentWriteAllowed(ctx, base);
  await repo.markFolderDeleted(id);
}

export async function restoreFolder(
  ctx: KnowledgeContext,
  id: string
): Promise<KnowledgeFolder> {
  const folder = await getFolderInternal(ctx, id, true);
  const base = await repo.findBaseById(folder.knowledgeBaseId, true);
  if (!base) throw new KnowledgeBaseNotFoundError(folder.knowledgeBaseId);
  await assertAgentWriteAllowed(ctx, base);
  return repo.restoreFolderRow(id);
}

// ─── Entry reads ────────────────────────────────────────────────────

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

// ─── Entry writes ───────────────────────────────────────────────────

export async function createEntry(
  ctx: KnowledgeContext,
  input: KnowledgeEntryCreateInput
): Promise<KnowledgeEntry> {
  const base = await getBaseById(ctx, input.knowledgeBaseId);
  await assertAgentWriteAllowed(ctx, base);
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
  return repo.insertEntry({
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
  await assertAgentWriteAllowed(ctx, base);
  if (expectedUpdatedAt && entry.updatedAt !== expectedUpdatedAt) {
    throw new KnowledgeStaleVersionError(expectedUpdatedAt, entry.updatedAt);
  }
  return repo.updateEntryRow(id, {
    title: patch.title,
    // Pass through as-is: undefined skips the column, null clears it.
    excerpt: patch.excerpt,
    body: patch.body,
    entryType: patch.entryType,
    position: patch.position,
    lastEditedBy: ctx.userId,
    lastEditedSource: ctx.source,
  });
}

export async function moveEntry(
  ctx: KnowledgeContext,
  id: string,
  input: KnowledgeEntryMoveInput
): Promise<KnowledgeEntry> {
  const entry = await getEntry(ctx, id);
  const base = await repo.findBaseById(entry.knowledgeBaseId, true);
  if (!base) throw new KnowledgeBaseNotFoundError(entry.knowledgeBaseId);
  await assertAgentWriteAllowed(ctx, base);

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

export async function softDeleteEntry(
  ctx: KnowledgeContext,
  id: string
): Promise<void> {
  const entry = await getEntry(ctx, id);
  const base = await repo.findBaseById(entry.knowledgeBaseId, true);
  if (!base) throw new KnowledgeBaseNotFoundError(entry.knowledgeBaseId);
  await assertAgentWriteAllowed(ctx, base);
  await repo.markEntryDeleted(id);
}

export async function restoreEntry(
  ctx: KnowledgeContext,
  id: string
): Promise<KnowledgeEntry> {
  const entry = await repo.findEntryById(id, true);
  if (!entry) throw new EntryNotFoundError(id);
  assertSameWorkspace(entry.workspaceId, ctx.workspaceId, `entry ${id}`);
  const base = await repo.findBaseById(entry.knowledgeBaseId, true);
  if (!base) throw new KnowledgeBaseNotFoundError(entry.knowledgeBaseId);
  await assertAgentWriteAllowed(ctx, base);
  return repo.restoreEntryRow(id);
}

// ─── Path-based reads + writes ──────────────────────────────────────
//
// Item 4: agent-friendly addressing. Path syntax: `/`-separated names
// (folder.name + entry.title). The unique partial index from the Item 4
// migration prevents path ambiguity.

export interface WriteFileByPathInput {
  body?: string;
  title?: string;
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
): Promise<KnowledgeEntry> {
  const base = await getBaseById(ctx, baseId);
  await assertAgentWriteAllowed(ctx, base);

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
    return repo.updateEntryRow(resolved.entry.id, {
      title: input.title,
      body: input.body,
      lastEditedBy: ctx.userId,
      lastEditedSource: ctx.source,
    });
  }

  // Not found — mkdir -p parents, then create.
  const parentFolder = await ensureFolderPath(ctx, base.id, parentSegments);
  return repo.insertEntry({
    workspaceId: ctx.workspaceId,
    knowledgeBaseId: base.id,
    folderId: parentFolder?.id ?? null,
    title: input.title ?? leafName,
    body: input.body ?? "",
    createdBy: ctx.userId,
    source: ctx.source,
  });
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
  await assertAgentWriteAllowed(ctx, base);

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
  await assertAgentWriteAllowed(ctx, base);
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
  await assertAgentWriteAllowed(ctx, base);

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

// ─── Trash ──────────────────────────────────────────────────────────

export async function listTrash(
  ctx: KnowledgeContext,
  baseId?: string
): Promise<repo.DeletedRows> {
  if (baseId) {
    // Validate the base belongs to this workspace before scoping.
    // Use includeDeleted=true so a soft-deleted base can still be
    // browsed via trash.
    const base = await repo.findBaseById(baseId, true);
    if (!base) throw new KnowledgeBaseNotFoundError(baseId);
    assertSameWorkspace(base.workspaceId, ctx.workspaceId, `knowledge base ${baseId}`);
  }
  return repo.listDeletedForWorkspace(ctx.workspaceId, baseId);
}

/**
 * Hard-delete every soft-deleted row in the workspace older than
 * `beforeIso`. Idempotent — repeated calls only re-process rows that
 * weren't already purged.
 */
export async function purgeTrashOlderThan(
  ctx: KnowledgeContext,
  beforeIso: string
): Promise<{ deleted: number }> {
  // Only allow user-origin purges. Agents would otherwise be able to
  // wipe trash with no visible UI cue. Tighten to admin-role-only at
  // the route layer in Item 2.
  if (ctx.source === "agent") {
    throw new AgentWriteDisabledError("trash");
  }
  return repo.hardDeleteOlderThan(ctx.workspaceId, beforeIso);
}

// ─── Agent-write enforcement ────────────────────────────────────────

/**
 * Throws `AgentWriteDisabledError` when the caller is acting as an
 * agent and the base's toggle is off. User-origin callers always pass.
 *
 * Centralized so every write goes through one check — never inline the
 * `ctx.source === "agent" && !base.agentWriteEnabled` test elsewhere.
 */
export async function assertAgentWriteAllowed(
  ctx: KnowledgeContext,
  base: KnowledgeBase
): Promise<void> {
  if (ctx.source !== "agent") return;
  if (!base.agentWriteEnabled) {
    throw new AgentWriteDisabledError(base.id);
  }
}

// ─── Seeding ────────────────────────────────────────────────────────

/**
 * Idempotent — skips entirely if the workspace already has any active
 * base. Inserts each fixture as a base + its root entries (folders are
 * empty in the legacy fixtures).
 */
export async function seedWorkspace(
  ctx: KnowledgeContext
): Promise<{ basesCreated: number }> {
  const existing = await repo.listBasesForWorkspace(ctx.workspaceId, false);
  if (existing.length > 0) return { basesCreated: 0 };

  const fixtures = buildSeedKnowledgeBases();
  const taken = await repo.listBaseSlugsForWorkspace(ctx.workspaceId);
  let basesCreated = 0;

  for (const fixture of fixtures) {
    const slug = deriveSlug(fixture.slug, taken);
    taken.push(slug);
    const base = await repo.insertBase({
      workspaceId: ctx.workspaceId,
      name: fixture.name,
      slug,
      description: fixture.description,
      agentWriteEnabled: fixture.agentWriteEnabled ?? false,
      createdBy: ctx.userId,
    });
    basesCreated += 1;

    for (const entryInput of fixture.rootEntries) {
      await repo.insertEntry({
        workspaceId: ctx.workspaceId,
        knowledgeBaseId: base.id,
        folderId: null,
        title: entryInput.title,
        excerpt: entryInput.excerpt,
        body: entryInput.body,
        entryType: entryInput.entryType,
        position: entryInput.position,
        createdBy: ctx.userId,
        // Seed inserts are system-origin, not agent edits — even when
        // an agent triggers the lazy seed via listBases, the rows
        // themselves should record `last_edited_source = 'user'`.
        source: "user",
      });
    }
    // Folder seeding deferred — legacy fixtures are flat. When Item 3
    // introduces nested seed data, recurse `fixture.rootFolders` here.
  }

  return { basesCreated };
}

// ─── Internal helpers ───────────────────────────────────────────────

async function listSlugs(workspaceId: string): Promise<string[]> {
  return repo.listBaseSlugsForWorkspace(workspaceId);
}

function deriveSlug(input: string, taken: string[]): string {
  return slugify(input, "knowledge-base", taken);
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

function assertSameWorkspace(
  rowWorkspaceId: string,
  ctxWorkspaceId: string,
  description: string
): void {
  if (rowWorkspaceId !== ctxWorkspaceId) {
    throw new KnowledgeBaseMismatchError(
      `${description} belongs to a different workspace`
    );
  }
}

function errorCode(err: unknown): string | null {
  if (err && typeof err === "object" && "code" in err) {
    return (err as { code?: string }).code ?? null;
  }
  return null;
}

async function fetchWorkspaceCreatedAt(
  workspaceId: string
): Promise<Date | null> {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("workspaces")
    .select("created_at")
    .eq("id", workspaceId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return new Date((data as { created_at: string }).created_at);
}

