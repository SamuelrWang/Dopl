import "server-only";
import { meetsMinRole } from "@/features/workspaces/types";
import {
  deleteGrantsForResource,
  deleteGrantsForResources,
  insertReadGrantsForResources,
  insertReadGrantsIfMissing,
  listGrantsForResources,
  listTeamIdsForUser,
} from "@/features/teams/server/repository";
import type { ChatFolder } from "../types";
import type { ChatFolderUpdateInput } from "../schema";
import {
  ChatFolderConflictError,
  ChatFolderNotFoundError,
  ChatForbiddenError,
} from "./errors";
import { mapFolderRow } from "./dto";
import type { ChatFolderRow } from "./dto";
import * as repo from "./repository";
import {
  UNIQUE_VIOLATION,
  folderGrantIds,
  stripNulDeep,
  type ChatContext,
} from "./service-shared";

/**
 * Folder-side chats service: personal folder CRUD plus the authoritative
 * scope propagation — re-scoping a folder aligns the sharing columns and
 * replaces the grant set of every chat filed in it.
 */

export async function listFolders(ctx: ChatContext): Promise<ChatFolder[]> {
  const rows = await repo.listFolders(ctx.workspaceId, ctx.userId);
  const teamScoped = rows.filter((r) => r.access_mode === "teams");
  const byFolder = new Map<string, string[]>();
  if (teamScoped.length > 0) {
    const grants = await listGrantsForResources(
      ctx.workspaceId,
      "chat_folder",
      teamScoped.map((r) => r.id)
    );
    for (const g of grants) {
      byFolder.set(g.resourceId, [...(byFolder.get(g.resourceId) ?? []), g.teamId]);
    }
  }
  return rows.map((row) => mapFolderRow(row, byFolder.get(row.id) ?? []));
}

export async function createFolder(ctx: ChatContext, rawName: string): Promise<ChatFolder> {
  const name = stripNulDeep(rawName); // F-7: no NUL into the folder name
  try {
    return mapFolderRow(await repo.insertFolder(ctx.workspaceId, ctx.userId, name));
  } catch (err) {
    if (repo.pgErrorCode(err) === UNIQUE_VIOLATION) {
      throw new ChatFolderConflictError(name);
    }
    throw err;
  }
}

/**
 * Rename and/or re-scope a folder. The folder's scope is authoritative,
 * so a scope change propagates to every chat filed in it: sharing
 * columns are aligned and each chat's grant set is replaced with the
 * folder's. Team-grant permission mirrors the chat rule (non-admins
 * grant only teams they belong to, plus already-granted ones).
 */
export async function updateFolderForUser(
  ctx: ChatContext,
  folderId: string,
  rawPatch: ChatFolderUpdateInput
): Promise<ChatFolder> {
  const patch = stripNulDeep(rawPatch); // F-7: no NUL into the folder name
  const folder = await repo.findFolderById(ctx.workspaceId, ctx.userId, folderId);
  if (!folder) throw new ChatFolderNotFoundError(folderId);

  let sharingPatch: { visibility?: string; access_mode?: string } = {};
  let grantTeamIds: string[] | null = null;
  if (patch.visibility !== undefined) {
    const wantsTeams = patch.visibility === "public" && patch.accessMode === "teams";
    sharingPatch = {
      visibility: patch.visibility,
      access_mode: wantsTeams ? "teams" : "workspace",
    };
    if (wantsTeams) {
      grantTeamIds = [...new Set(patch.teamIds ?? [])];
      const isAdmin = ctx.role !== null && meetsMinRole(ctx.role, "admin");
      if (!isAdmin && grantTeamIds.length > 0) {
        const [myTeams, existing] = await Promise.all([
          listTeamIdsForUser(ctx.workspaceId, ctx.userId),
          listGrantsForResources(ctx.workspaceId, "chat_folder", [folder.id]),
        ]);
        const allowed = new Set([...myTeams, ...existing.map((g) => g.teamId)]);
        if (grantTeamIds.some((id) => !allowed.has(id))) {
          throw new ChatForbiddenError("grant teams you don't belong to");
        }
      }
    }
  }

  let row: ChatFolderRow;
  try {
    row = await repo.updateFolder(folder.id, {
      ...(patch.name !== undefined ? { name: patch.name } : {}),
      ...sharingPatch,
    });
  } catch (err) {
    if (repo.pgErrorCode(err) === UNIQUE_VIOLATION) {
      throw new ChatFolderConflictError(patch.name ?? folder.name);
    }
    throw err;
  }

  if (patch.visibility !== undefined) {
    // Folder grants are replace-set, then the scope + grants propagate
    // to every filed chat so the invariant holds.
    await deleteGrantsForResource(ctx.workspaceId, "chat_folder", row.id);
    if (grantTeamIds && grantTeamIds.length > 0) {
      await insertReadGrantsIfMissing(
        ctx.workspaceId,
        "chat_folder",
        row.id,
        grantTeamIds
      );
    }
    await repo.updateChatsScopeInFolder(row.id, row.visibility, row.access_mode);
    // SET-AT-A-TIME, not row-at-a-time. This used to loop delete+insert per
    // filed chat — 2N serial round-trips on one save, unbounded in N, which
    // put a 200-chat folder past the gateway timeout. The grant set is the
    // same for every chat in the folder, so it is one `.in()` delete plus one
    // array upsert (chunked only to keep the request itself bounded).
    const chatIds = await repo.listChatIdsInFolder(row.id);
    await deleteGrantsForResources(ctx.workspaceId, "chat", chatIds);
    if (grantTeamIds && grantTeamIds.length > 0) {
      await insertReadGrantsForResources(
        ctx.workspaceId,
        "chat",
        chatIds,
        grantTeamIds
      );
    }
  }

  return mapFolderRow(row, grantTeamIds ?? (await folderGrantIds(ctx, row)));
}

export async function deleteFolderForUser(
  ctx: ChatContext,
  folderId: string
): Promise<void> {
  const folder = await repo.findFolderById(ctx.workspaceId, ctx.userId, folderId);
  if (!folder) throw new ChatFolderNotFoundError(folderId);
  await repo.deleteFolder(folder.id);
}
