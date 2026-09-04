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
  KnowledgeSectionAmbiguousError,
  KnowledgeStaleVersionError,
  PathTraversalError,
} from "./errors";
import {
  appendSection,
  replaceSection,
} from "@/shared/knowledge/markdown-sections";
import {
  ensureFolderPath,
  parsePath,
  resolvePath,
  type ResolvedPath,
} from "./path";
import * as repo from "./repository";
import { scheduleEntryEmbedding } from "./embeddings";
import { assertAgentCanDelete, assertBaseWritable, errorCode } from "./service-shared";
import { getBaseById, readBaseInContext } from "./service-bases";
import { assertStorageHeadroom, bodyBytes } from "./service-storage";

/**
 * Path-based reads + writes. Paths = `/`-separated folder.name + entry.title.
 * Unique partial index prevents path ambiguity.
 */

export interface WriteFileByPathInput {
  body?: string;
  title?: string;
  /** ≤300 chars. `undefined` leaves existing excerpt; `null` clears it. */
  excerpt?: string | null;
  /** Optimistic-concurrency precondition. Only applies when path resolves to
   *  an existing entry; stale value → 412. */
  expectedUpdatedAt?: string;
  /**
   * Replace ONE `#`/`##`/`###` section instead of the whole document — `body`
   * is then that section's new content.
   *
   * ⚠ **THE MERGE IS SERVER-SIDE AND UNDER THE SAME PRECONDITION.** It reads
   * the stored body, splices, and writes — all against the row
   * `expectedUpdatedAt` was just checked on, so a sectioned write is exactly as
   * safe as a whole-body one and no safer. A caller that merged client-side
   * would be merging onto a body it fetched in a different request.
   *
   * ⚠ **A HEADING THAT DOES NOT EXIST IS APPENDED, NOT REFUSED**, at `##`, and
   * the result says so ({@link WriteFileByPathResult.sectionCreated}). An
   * AMBIGUOUS heading refuses: overwriting the wrong section is unrecoverable.
   */
  section?: string;
}

export interface WriteFileByPathResult {
  entry: KnowledgeEntry;
  base: KnowledgeBase;
  /** `true` when `section` named no existing heading and one was appended. */
  sectionCreated?: boolean;
}

/**
 * Entry at `path`, full body.
 * Throws PathTraversalError on non-final segment miss; EntryNotFoundError when
 * only final segment missing OR path resolves to folder/root.
 */
export async function readFileByPath(
  ctx: KnowledgeContext,
  baseId: string,
  path: string
): Promise<KnowledgeEntry> {
  // 🔒 **THE ONE PATH OP THAT FOLLOWS THE ID (B2), AND IT MUST RESOLVE THE
  // PATH IN THE CONTAINER THE FOLLOW LANDED IN.** `readBaseById`'s door already
  // let `GET /api/knowledge/bases/<id>` name a base on the caller's personal
  // shelf from any container they are in (rulings B10/#18); this read composed
  // the WORKSPACE-KEYED lookup instead, so the same id answered
  // `KNOWLEDGE_BASE_MISMATCH` here — a base you could open and could not read,
  // F-604's shape one layer up. ⚠ **READ ONLY**: every write below keeps
  // `getBaseById`, because a write that follows an id across a tenancy boundary
  // is a ruling nobody has made (INVARIANTS §T35).
  const { ctx: baseCtx, value: base } = await readBaseInContext(ctx, baseId);
  const resolved = await resolvePath(baseCtx, base.id, path);
  if (resolved.kind === "not_found") {
    throwIfIntermediateMissing(path, resolved);
    throw new EntryNotFoundError(path);
  }
  if (resolved.kind !== "entry") {
    throw new EntryNotFoundError(path);
  }
  return resolved.entry;
}

/** Throws PathTraversalError only for non-final-segment misses; leaf miss no-ops
 *  (caller decides if fatal). */
function throwIfIntermediateMissing(
  path: string,
  resolved: Extract<ResolvedPath, { kind: "not_found" }>
): void {
  const segments = parsePath(path);
  const resolvedDepth = resolved.lastFolder
    ? // lastFolder depth needs a parent walk; instead take first index matching
      // missingSegment — anywhere but last ⇒ intermediate miss.
      segments.indexOf(resolved.missingSegment)
    : 0;
  if (resolvedDepth !== -1 && resolvedDepth < segments.length - 1) {
    throw new PathTraversalError(path, resolved.missingSegment);
  }
}

/** Upsert entry by path, mkdir -p'ing parents on create; title defaults to the
 *  last segment. Throws KnowledgePathConflictError on a FOLDER path
 *  (ambiguous), AgentWriteDisabledError on an agent with the toggle off. */
export async function writeFileByPath(
  ctx: KnowledgeContext,
  baseId: string,
  path: string,
  input: WriteFileByPathInput = {}
): Promise<WriteFileByPathResult> {
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
    // undefined preserves existing title/body (CREATE below must default
    // title to leafName instead).
    if (
      input.expectedUpdatedAt &&
      resolved.entry.updatedAt !== input.expectedUpdatedAt
    ) {
      throw new KnowledgeStaleVersionError(
        input.expectedUpdatedAt,
        resolved.entry.updatedAt
      );
    }
    // ⚠ THE SECTION MERGE HAPPENS HERE, between the precondition and the
    // storage gate: it is the merged body that gets written, so it is the
    // merged body the gate has to weigh.
    const merged = mergeSection(resolved.entry.body, input);
    // Storage gate on NET delta, before write. `body === undefined` preserves
    // column ⇒ no delta; shrink is negative and always allowed.
    if (merged.body !== undefined) {
      await assertStorageHeadroom(
        ctx,
        base,
        bodyBytes(merged.body) - bodyBytes(resolved.entry.body)
      );
    }
    let saved;
    try {
      saved = await repo.updateEntryRow(
        resolved.entry.id,
        {
          title: input.title,
          body: merged.body,
          // As-is: undefined skips column, null clears.
          excerpt: input.excerpt,
          lastEditedBy: ctx.userId,
          lastEditedSource: ctx.source,
        },
        input.expectedUpdatedAt
      );
    } catch (err) {
      // Rename onto sibling title trips unique (kb, folder, title) index —
      // surface 409, not raw 500.
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
    if (input.title !== undefined || merged.body !== undefined) {
      scheduleEntryEmbedding(saved);
    }
    return { entry: saved, base, sectionCreated: merged.created };
  }

  // Not found + precondition ⇒ target vanished concurrently. Refuse rather
  // than silently creating a duplicate.
  if (input.expectedUpdatedAt) {
    throw new KnowledgeStaleVersionError(input.expectedUpdatedAt, "deleted");
  }

  // ⚠ A `section` on a CREATE writes an entry that IS that one section — the
  // heading included, so the document the caller goes on to address by heading
  // is the document that was made.
  const createdBody =
    input.section === undefined
      ? input.body
      : appendSection("", input.section, input.body ?? "");

  // ⚠ Storage gate BEFORE mkdir -p: refusing after creating parents leaves
  // empty scaffolding for a write that never landed.
  await assertStorageHeadroom(ctx, base, bodyBytes(createdBody));

  const parentFolder = await ensureFolderPath(ctx, base.id, parentSegments);
  let created;
  try {
    created = await repo.insertEntry({
      workspaceId: ctx.workspaceId,
      knowledgeBaseId: base.id,
      folderId: parentFolder?.id ?? null,
      title: input.title ?? leafName,
      excerpt: input.excerpt ?? null,
      body: createdBody ?? "",
      createdBy: ctx.userId,
      source: ctx.source,
    });
  } catch (err) {
    // Title/leaf already names an active entry here ⇒ unique (kb, folder,
    // title) violation. Map 23505 to the 409 move ops return.
    if (errorCode(err) === "23505") {
      throw new KnowledgePathConflictError(
        [...parentSegments, input.title ?? leafName].join("/")
      );
    }
    throw err;
  }
  scheduleEntryEmbedding(created);
  return {
    entry: created,
    base,
    sectionCreated: input.section === undefined ? undefined : true,
  };
}

/**
 * Splice `input.body` into ONE section of `current`, or leave the write whole.
 *
 * ⚠ **`section` WITHOUT `body` IS A NO-OP, NOT AN ERASURE.** `body: undefined`
 * already means "leave the column alone" on this path (it is how a title-only
 * rename works), and a section argument must not change what an absent body
 * means.
 */
function mergeSection(
  current: string,
  input: WriteFileByPathInput
): { body: string | undefined; created?: boolean } {
  if (input.section === undefined || input.body === undefined) {
    return { body: input.body };
  }
  const spliced = replaceSection(current, input.section, input.body);
  if (spliced.ok) return { body: spliced.body, created: false };
  if (spliced.reason === "SECTION_AMBIGUOUS") {
    throw new KnowledgeSectionAmbiguousError(
      input.section,
      spliced.matches.map((m) => m.line)
    );
  }
  return { body: appendSection(current, input.section, input.body), created: true };
}

/**
 * mkdir -p a folder. Leaf already an entry ⇒ KnowledgePathConflictError.
 * `description` (≤300 chars) applies to the LEAF only; mkdir-p'd parents stay
 * description-less. Re-calling on an existing folder UPDATES its description —
 * the sanctioned "set folder summary without touching contents" path;
 * `undefined` leaves it as-is.
 */
export async function createFolderByPath(
  ctx: KnowledgeContext,
  baseId: string,
  path: string,
  description?: string | null
): Promise<KnowledgeFolder> {
  const base = await getBaseById(ctx, baseId);
  await assertBaseWritable(ctx, base);

  const segments = parsePath(path);
  if (segments.length === 0) {
    throw new KnowledgePathConflictError(path);
  }

  const resolved = await resolvePath(ctx, base.id, path);
  if (resolved.kind === "entry") {
    throw new KnowledgePathConflictError(path);
  }

  const folder = await ensureFolderPath(ctx, base.id, segments);
  if (!folder) throw new KnowledgePathConflictError(path);
  // Only when supplied, so plain mkdir-p re-call never clobbers a description.
  if (description !== undefined) {
    return repo.updateFolderRow(folder.id, { description });
  }
  return folder;
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
  const base = await getBaseById(ctx, baseId);
  // F-10: block agent deletes in a base read-only to agents.
  assertAgentCanDelete(ctx, base);
  await assertBaseWritable(ctx, base);
  const resolved = await resolvePath(ctx, base.id, path);
  if (resolved.kind === "root") {
    throw new KnowledgePathConflictError("Cannot delete the base root.");
  }
  if (resolved.kind === "not_found") {
    throw new PathTraversalError(path, resolved.missingSegment);
  }
  if (resolved.kind === "folder") {
    await repo.hardDeleteFolder(ctx.workspaceId, resolved.folder.id);
    return { kind: "folder", id: resolved.folder.id };
  }
  await repo.hardDeleteEntry(ctx.workspaceId, resolved.entry.id);
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
  // 🔒 A READ, so it follows the id — see {@link readFileByPath}.
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
