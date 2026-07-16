import "server-only";
import { meetsMinRole } from "@/features/workspaces/types";
import {
  deleteGrantsForResource,
  insertReadGrantsIfMissing,
  listGrantsForResources,
  listTeamIdsForUser,
} from "@/features/teams/server/repository";
import type { Chat, ChatDetail } from "../types";
import type {
  ChatAppendInput,
  ChatExportInput,
  ChatUpdateInput,
} from "../schema";
import {
  ChatFolderNotFoundError,
  ChatFolderScopeError,
  ChatForbiddenError,
} from "./errors";
import { mapChatRow, mapOwner } from "./dto";
import type { ChatFolderRow, ChatRow } from "./dto";
import * as repo from "./repository";
import { getChat } from "./service-reads";
import {
  UNIQUE_VIOLATION,
  deriveFormat,
  messagePayload,
  profilesById,
  requireOwnChat,
  resolveOrCreateFolderRow,
  syncChatGrantsToFolder,
  type ChatContext,
} from "./service-shared";

/**
 * Write-side chats service: agent-facing export (create / idempotent
 * re-export) plus the owner-only mutations (append transcript, update
 * header + sharing/folder, delete). Reads back through `getChat` so the
 * caller gets the visibility-filtered detail.
 */

// ─── Export (create / idempotent re-export) ─────────────────────────

/**
 * Agent-facing export. When `clientSessionId` matches one of the
 * caller's earlier exports, the chat's header and transcript are
 * replaced in place (visibility, pinned state, and folder are kept
 * unless the payload names a folder) — re-exporting a session never
 * duplicates it. `format` is derived from the messages, never taken
 * from the caller.
 */
export async function exportChat(
  ctx: ChatContext,
  input: ChatExportInput
): Promise<ChatDetail> {
  // Filing into a folder means inheriting the folder's sharing — the
  // folder's scope is authoritative, so any caller-passed visibility is
  // superseded when a folder is named.
  const folderRow = input.folder
    ? await resolveOrCreateFolderRow(ctx, input.folder)
    : null;
  const folderId = folderRow?.id ?? null;
  const inherited = folderRow
    ? { visibility: folderRow.visibility, access_mode: folderRow.access_mode }
    : null;

  const existing = input.clientSessionId
    ? await repo.findChatByClientSession(ctx.workspaceId, ctx.userId, input.clientSessionId)
    : null;

  const header = {
    title: input.title,
    overview: input.overview,
    source: input.source,
    project: input.project ?? null,
    format: deriveFormat(input.messages),
    ...(input.sessionDate ? { session_date: input.sessionDate } : {}),
    deliverables: input.deliverables,
    learnings: input.learnings,
    exported_at: new Date().toISOString(),
  };
  const payload = messagePayload(input.messages);

  let chat: ChatRow;
  if (existing) {
    chat = await repo.updateChat(existing.id, {
      ...header,
      ...(folderId ? { folder_id: folderId, ...inherited } : {}),
    });
    await repo.replaceMessages(chat.id, ctx.workspaceId, payload);
  } else {
    try {
      chat = await repo.insertChat({
        workspace_id: ctx.workspaceId,
        owner_id: ctx.userId,
        folder_id: folderId,
        client_session_id: input.clientSessionId ?? null,
        visibility: input.visibility,
        ...header,
        ...(inherited ?? {}),
      });
    } catch (err) {
      // Lost a first-export race on client_session_id — converge on the
      // winner's row and treat this call as the re-export it now is.
      const raced =
        repo.pgErrorCode(err) === UNIQUE_VIOLATION && input.clientSessionId
          ? await repo.findChatByClientSession(
              ctx.workspaceId,
              ctx.userId,
              input.clientSessionId
            )
          : null;
      if (!raced) throw err;
      chat = await repo.updateChat(raced.id, {
        ...header,
        ...(folderId ? { folder_id: folderId, ...inherited } : {}),
      });
    }
    try {
      await repo.replaceMessages(chat.id, ctx.workspaceId, payload);
    } catch (err) {
      // Never leave a header-only chat behind: a create whose transcript
      // write failed is rolled back so the caller's retry starts clean.
      if (!existing && !input.clientSessionId) {
        await repo.deleteChat(chat.id).catch(() => {});
      }
      throw err;
    }
  }

  // Inheritance covers grants too: a chat filed into a team-scoped
  // folder gets the folder's team grant set (replace-set).
  if (folderRow) {
    await syncChatGrantsToFolder(ctx, chat.id, folderRow);
  }

  return getChat(ctx, chat.id);
}

// ─── Mutations (owner-only) ─────────────────────────────────────────

export async function appendMessages(
  ctx: ChatContext,
  chatId: string,
  input: ChatAppendInput
): Promise<ChatDetail> {
  const chat = await requireOwnChat(ctx, chatId, "append to it");
  await repo.appendMessagesTx(chat.id, ctx.workspaceId, messagePayload(input.messages));
  // The transcript's verbatim mix may have changed — keep format honest.
  const allMessages = await repo.listMessages(chat.id);
  const format = deriveFormat(
    allMessages.map((m) => ({ verbatim: m.verbatim ?? undefined }))
  );
  if (format !== chat.format) {
    await repo.updateChat(chat.id, { format });
  }
  return getChat(ctx, chat.id);
}

export async function updateChatHeader(
  ctx: ChatContext,
  chatId: string,
  patch: ChatUpdateInput
): Promise<Chat> {
  const chat = await requireOwnChat(ctx, chatId, "update it");

  // Resolve the folder move first — inheritance and the filed-chat
  // sharing guard both depend on where the chat ends up.
  let folderPatch: { folder_id: string | null } | undefined;
  let targetFolder: ChatFolderRow | null = null;
  if (patch.folderId !== undefined) {
    if (patch.folderId !== null) {
      targetFolder = await repo.findFolderById(ctx.workspaceId, ctx.userId, patch.folderId);
      if (!targetFolder) throw new ChatFolderNotFoundError(patch.folderId);
    }
    folderPatch = { folder_id: patch.folderId };
  } else if (patch.folder !== undefined) {
    if (patch.folder !== null) {
      targetFolder = await resolveOrCreateFolderRow(ctx, patch.folder);
    }
    folderPatch = { folder_id: targetFolder?.id ?? null };
  }

  // Filed chats inherit their folder's sharing — a direct visibility
  // change is rejected unless this same patch unfiles the chat. (The
  // schema already blocks visibility combined with filing INTO a folder.)
  if (
    patch.visibility !== undefined &&
    chat.folder_id !== null &&
    !(folderPatch && folderPatch.folder_id === null)
  ) {
    const currentFolder = await repo.findFolderById(
      ctx.workspaceId,
      ctx.userId,
      chat.folder_id
    );
    throw new ChatFolderScopeError(currentFolder?.name ?? "its folder");
  }

  // Sharing scope. Going team-scoped replaces the grant set wholesale;
  // any other scope drops all grants. Non-admin owners may only grant
  // teams they belong to (plus already-granted teams, which the share
  // UI renders locked) — mirrors the KB rule. Moving into a folder
  // instead inherits the folder's scope + grants.
  let sharingPatch: { visibility?: string; access_mode?: string } = {};
  let grantTeamIds: string[] | null = null;
  if (targetFolder) {
    sharingPatch = {
      visibility: targetFolder.visibility,
      access_mode: targetFolder.access_mode,
    };
  } else if (patch.visibility !== undefined) {
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
          listGrantsForResources(ctx.workspaceId, "chat", [chat.id]),
        ]);
        const allowed = new Set([...myTeams, ...existing.map((g) => g.teamId)]);
        if (grantTeamIds.some((id) => !allowed.has(id))) {
          throw new ChatForbiddenError("grant teams you don't belong to");
        }
      }
    }
  }

  const row = await repo.updateChat(chat.id, {
    ...(patch.title !== undefined ? { title: patch.title } : {}),
    ...(patch.overview !== undefined ? { overview: patch.overview } : {}),
    ...(patch.project !== undefined ? { project: patch.project } : {}),
    ...(patch.sessionDate !== undefined ? { session_date: patch.sessionDate } : {}),
    ...sharingPatch,
    ...(patch.pinned !== undefined ? { pinned: patch.pinned } : {}),
    ...(patch.deliverables !== undefined ? { deliverables: patch.deliverables } : {}),
    ...(patch.learnings !== undefined ? { learnings: patch.learnings } : {}),
    ...(folderPatch ?? {}),
  });

  if (targetFolder) {
    // Inheritance covers grants too — the chat adopts the folder's set.
    await syncChatGrantsToFolder(ctx, chat.id, targetFolder);
  } else if (patch.visibility !== undefined) {
    // Replace-set semantics: clear, then re-insert the new grant set.
    await deleteGrantsForResource(ctx.workspaceId, "chat", chat.id);
    if (grantTeamIds && grantTeamIds.length > 0) {
      await insertReadGrantsIfMissing(ctx.workspaceId, "chat", chat.id, grantTeamIds);
    }
  }

  const [count, profiles] = await Promise.all([
    repo.countMessages(row.id),
    profilesById([row.owner_id]),
  ]);
  // Keep the returned grant set honest even when sharing wasn't touched.
  const teamIds =
    grantTeamIds ??
    (row.access_mode === "teams"
      ? (await listGrantsForResources(ctx.workspaceId, "chat", [row.id])).map(
          (g) => g.teamId
        )
      : []);
  return mapChatRow(
    row,
    mapOwner(row.owner_id, profiles.get(row.owner_id)),
    count,
    teamIds
  );
}

export async function deleteChat(ctx: ChatContext, chatId: string): Promise<void> {
  const chat = await requireOwnChat(ctx, chatId, "delete it");
  await repo.deleteChat(chat.id);
}
