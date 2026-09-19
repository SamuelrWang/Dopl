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
import { getBaseById, readBaseInContext } from "./service-bases";
// Awaited, after the write, inside the request (`./service-revisions.ts`).
import { recordFolderRevision } from "./service-revisions";
import { headingNames } from "./service-sections";

/** Folder reads + writes, plus `getBaseTree` — the snapshot shared by REST and
 *  the MCP get_tree op. */

export async function listFolders(
  ctx: KnowledgeContext,
  baseId: string
): Promise<KnowledgeFolder[]> {
  // A read by id, so it follows the id — see {@link getBaseTree}.
  const { value: base } = await readBaseInContext(ctx, baseId);
  return repo.listFoldersForBase(base.id, false);
}

/**
 * Base + folders + entries, metadata only (bodies stripped). Lives here so
 * `GET /api/knowledge/bases/[baseId]/tree` and MCP get_tree share ONE
 * composition and ONE auth path.
 *
 * Entry paging is opt-in (`entryLimit` + `entryOffset`); folders always ship in
 * full. Without `entryLimit`: full snapshot, no extra fields, no count query.
 *
 * 🔒 **`headings` IS OPT-IN AND IT COSTS THE BODY COLUMN** (Wave 4 a1,
 * 2026-09-18). Deriving a heading list means reading the markdown, so the one
 * optimisation this snapshot has ever had — `includeBody: false`, which is why
 * the web sidebar can render a 400-entry base — is exactly what the flag turns
 * off. So it is a FLAG rather than a default: the app's tree pane never sends
 * it, and the agent surface, which is paged and called rarely, always does.
 *
 * ⚠ **THE BODIES ARE DROPPED BEFORE THIS RETURNS.** A snapshot that carried
 * them would hand every caller of this one composition a payload two orders of
 * magnitude larger than the one it asked for; the headings ride in their OWN
 * key, so `entries` keeps the shape `check-knowledge-type-drift.ts` pins.
 */
export async function getBaseTree(
  ctx: KnowledgeContext,
  baseId: string,
  opts?: { entryLimit: number; entryOffset: number },
  extra?: { headings?: boolean }
): Promise<{
  base: KnowledgeBase;
  folders: KnowledgeFolder[];
  entries: KnowledgeEntry[];
  entryTotal?: number;
  nextEntryCursor?: string | null;
  entryHeadings?: Record<string, string[]>;
}> {
  // A read by id follows the id, and everything under it is keyed on `base.id`
  // rather than on a workspace, so the snapshot is the base's own wherever it
  // lives (F-470).
  const { value: base } = await readBaseInContext(ctx, baseId);
  const wantHeadings = extra?.headings === true;
  const [folders, loaded, entryTotal] = await Promise.all([
    repo.listFoldersForBase(base.id, false),
    repo.listEntriesForBase(base.id, {
      includeBody: wantHeadings,
      includeDeleted: false,
      ...(opts ? { limit: opts.entryLimit, offset: opts.entryOffset } : {}),
    }),
    opts ? repo.countEntriesForBase(base.id) : Promise.resolve(undefined),
  ]);
  let entryHeadings: Record<string, string[]> | undefined;
  let entries = loaded;
  if (wantHeadings) {
    entryHeadings = {};
    for (const e of loaded) {
      const names = headingNames(e.body ?? "");
      if (names.length > 0) entryHeadings[e.id] = names;
    }
    entries = loaded.map((e) => ({ ...e, body: "" }));
  }
  if (!opts || entryTotal === undefined)
    return { base, folders, entries, ...(entryHeadings ? { entryHeadings } : {}) };
  const nextOffset = opts.entryOffset + entries.length;
  return {
    base,
    folders,
    entries,
    entryTotal,
    nextEntryCursor: nextOffset < entryTotal ? String(nextOffset) : null,
    ...(entryHeadings ? { entryHeadings } : {}),
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
  const created = await repo.insertFolder({
    workspaceId: ctx.workspaceId,
    knowledgeBaseId: base.id,
    parentId: input.parentId ?? null,
    name: input.name,
    description: input.description ?? null,
    position: input.position,
    createdBy: ctx.userId,
  });
  await recordFolderRevision(ctx, created, "create");
  return created;
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
  // A name change is a `rename`; a description-only change is an `edit` with no
  // body — honest, and never restorable (`revisions › restoreRevision`).
  await recordFolderRevision(ctx, saved, patch.name !== undefined ? "rename" : "edit");
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

  const moved = await repo.updateFolderRow(id, {
    parentId: input.parentId,
    position: input.position,
  });
  await recordFolderRevision(ctx, moved, "move");
  return moved;
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
  // One revision for the FOLDER, not one per row the cascade took: a
  // per-descendant fan would be an unbounded write inside a request.
  await recordFolderRevision(ctx, folder, "delete");
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
