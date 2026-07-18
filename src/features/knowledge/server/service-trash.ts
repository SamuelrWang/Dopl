import "server-only";
import { meetsMinRole } from "@/features/workspaces/types";
import {
  listGrantsForResources,
  listTeamIdsForUser,
} from "@/features/teams/server/repository";
import type { KnowledgeBase, KnowledgeContext } from "../types";
import { KnowledgeBaseNotFoundError } from "./errors";
import * as repo from "./repository";
import {
  assertBaseVisible,
  assertSameWorkspace,
  canSeeBase,
} from "./service-shared";

/**
 * Trash listing for the knowledge feature — visibility-filtered so the
 * trash never leaks other members' private or non-granted team-scoped
 * base names.
 */

/**
 * One trashed knowledge row, normalized for the cross-feature workspace
 * Trash aggregator (Phase 2). Bases/folders/entries collapse to a common
 * shape; `parentName` is the containing knowledge base (undefined for a
 * base itself). `deletedAt` is always set — these rows are soft-deleted.
 */
export interface TrashedKnowledgeItem {
  kind: "knowledge_base" | "knowledge_folder" | "knowledge_entry";
  id: string;
  name: string;
  deletedAt: string;
  parentName?: string;
}

/**
 * Flattened, visibility-filtered trash for the whole workspace — the
 * shape the workspace-trash aggregator consumes. Reuses `listTrash` for
 * the visibility gating, then resolves each folder/entry's containing
 * base name (the parent base may be LIVE, so it isn't always in the
 * trashed-bases set). Sorted newest-deletion-first across all kinds.
 */
export async function listTrashedForWorkspace(
  ctx: KnowledgeContext
): Promise<TrashedKnowledgeItem[]> {
  const deleted = await listTrash(ctx);
  const baseNames = new Map(deleted.bases.map((b) => [b.id, b.name]));
  const missing = [
    ...new Set(
      [...deleted.folders, ...deleted.entries]
        .map((r) => r.knowledgeBaseId)
        .filter((id) => !baseNames.has(id))
    ),
  ];
  for (const b of await repo.listBasesByIds(ctx.workspaceId, missing)) {
    baseNames.set(b.id, b.name);
  }
  const items: TrashedKnowledgeItem[] = [
    ...deleted.bases.map((b) => ({
      kind: "knowledge_base" as const,
      id: b.id,
      name: b.name,
      deletedAt: b.deletedAt as string,
    })),
    ...deleted.folders.map((f) => ({
      kind: "knowledge_folder" as const,
      id: f.id,
      name: f.name,
      deletedAt: f.deletedAt as string,
      parentName: baseNames.get(f.knowledgeBaseId),
    })),
    ...deleted.entries.map((e) => ({
      kind: "knowledge_entry" as const,
      id: e.id,
      name: e.title,
      deletedAt: e.deletedAt as string,
      parentName: baseNames.get(e.knowledgeBaseId),
    })),
  ];
  return items.sort((a, b) => b.deletedAt.localeCompare(a.deletedAt));
}

export async function listTrash(
  ctx: KnowledgeContext,
  baseId?: string
): Promise<repo.DeletedRows> {
  if (baseId) {
    // Validate the base belongs to this workspace before scoping.
    // Use includeDeleted=true so a soft-deleted base can still be
    // browsed via trash — but only by callers who may see it.
    const base = await repo.findBaseById(baseId, true);
    if (!base) throw new KnowledgeBaseNotFoundError(baseId);
    assertSameWorkspace(base.workspaceId, ctx.workspaceId, `knowledge base ${baseId}`);
    await assertBaseVisible(ctx, base);
  }
  const deleted = await repo.listDeletedForWorkspace(ctx.workspaceId, baseId);
  // Visibility filter — same rules as the live list (M-10 + team
  // scoping). Without it the trash leaks other members' private and
  // non-granted team-scoped bases' names. Trashed folders/entries may
  // belong to LIVE parents, so resolve every parent base first.
  const parents = new Map(deleted.bases.map((b) => [b.id, b]));
  const missingIds = [
    ...new Set(
      [...deleted.folders, ...deleted.entries]
        .map((r) => r.knowledgeBaseId)
        .filter((id) => !parents.has(id))
    ),
  ];
  for (const b of await repo.listBasesByIds(ctx.workspaceId, missingIds)) {
    parents.set(b.id, b);
  }
  const visibleIds = await visibleBaseIdSet(ctx, [...parents.values()]);
  return {
    bases: deleted.bases.filter((b) => visibleIds.has(b.id)),
    folders: deleted.folders.filter((f) => visibleIds.has(f.knowledgeBaseId)),
    entries: deleted.entries.filter((e) => visibleIds.has(e.knowledgeBaseId)),
  };
}

/**
 * Batch trash-visibility resolver. `filterTeamVisibleBases` can't be
 * reused here: it rides on `listEffectiveAccess`, whose teams-mode
 * index only covers LIVE bases — a trashed teams-mode base would
 * resolve null even for its own creator. This one checks grants
 * directly, so trashed rows resolve the same as live ones.
 */
async function visibleBaseIdSet(
  ctx: KnowledgeContext,
  bases: KnowledgeBase[]
): Promise<Set<string>> {
  const out = new Set<string>();
  const candidates = bases.filter((b) => canSeeBase(ctx, b));
  const isAdmin = meetsMinRole(ctx.role, "admin");
  const needGrants = candidates.filter(
    (b) =>
      b.accessMode === "teams" && b.createdBy !== ctx.userId && !isAdmin
  );
  const granted = new Set<string>();
  if (needGrants.length > 0) {
    const myTeams = new Set(
      await listTeamIdsForUser(ctx.workspaceId, ctx.userId)
    );
    if (myTeams.size > 0) {
      const grants = await listGrantsForResources(
        ctx.workspaceId,
        "knowledge_base",
        needGrants.map((b) => b.id)
      );
      for (const g of grants) {
        if (myTeams.has(g.teamId)) granted.add(g.resourceId);
      }
    }
  }
  for (const b of candidates) {
    if (
      b.accessMode !== "teams" ||
      b.createdBy === ctx.userId ||
      isAdmin ||
      granted.has(b.id)
    ) {
      out.add(b.id);
    }
  }
  return out;
}
