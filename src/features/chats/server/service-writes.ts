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
  ChatNotFoundError,
} from "./errors";
import { mapChatRow, mapOwner } from "./dto";
import type { ChatFolderRow, ChatRow } from "./dto";
import * as repo from "./repository";
import { resolveChatsWindow } from "./retention";
import { readChatDetail } from "./service-reads";
import {
  UNIQUE_VIOLATION,
  deriveFormat,
  messagePayload,
  profilesById,
  requireOwnChat,
  resolveOrCreateFolderRow,
  stripNulDeep,
  syncChatGrantsToFolder,
  type ChatContext,
} from "./service-shared";
import type { MessagePayload } from "./repository";

/**
 * Write-side chats service: agent-facing export (create / idempotent
 * re-export) plus the owner-only mutations (append transcript, update
 * header + sharing/folder, delete). Reads back through `readChatDetail`
 * (visibility-filtered, but WITHOUT the retention window) so echoing a
 * just-written chat never 403s on a backfilled old session.
 */

// ─── Export (create / idempotent re-export) ─────────────────────────

/**
 * Agent-facing export. When `clientSessionId` matches one of the caller's
 * earlier exports, the chat is UPDATED in place, PRESERVING BY DEFAULT
 * (F-8 / F-9): a header field is overwritten only when the caller passes
 * it (an omitted field keeps its stored value instead of being cleared),
 * and the transcript is reconciled — messages are upserted by position
 * and any added via op="append" are kept — so a re-export never wipes
 * history. A fresh export inserts header + transcript in ONE transaction
 * (F-12), so a failed write can't leave a 0-message orphan. All incoming
 * text is stripped of NUL first (F-7). `format` is derived from the
 * messages, never taken from the caller.
 */
export async function exportChat(
  ctx: ChatContext,
  rawInput: ChatExportInput
): Promise<ChatDetail> {
  // Drop any NUL (U+0000) before it reaches Postgres — a stray one used to
  // 500 the whole export (and orphan a header pre-F-12).
  const input = stripNulDeep(rawInput);

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

  const payload = messagePayload(input.messages);

  const existing = input.clientSessionId
    ? await repo.findChatByClientSession(ctx.workspaceId, ctx.userId, input.clientSessionId)
    : null;
  if (existing) {
    return reexportChat(ctx, existing, input, folderRow, payload);
  }

  // Fresh export: header + transcript in one transaction (no orphan).
  let chat: ChatRow;
  try {
    chat = await repo.createChatWithMessages(
      {
        workspace_id: ctx.workspaceId,
        owner_id: ctx.userId,
        folder_id: folderId,
        client_session_id: input.clientSessionId ?? null,
        visibility: inherited?.visibility ?? input.visibility ?? "private",
        access_mode: inherited?.access_mode ?? "workspace",
        title: input.title,
        overview: input.overview ?? "",
        source: input.source ?? "other",
        project: input.project ?? null,
        format: deriveFormat(input.messages),
        ...(input.sessionDate ? { session_date: input.sessionDate } : {}),
        deliverables: input.deliverables ?? [],
        learnings: input.learnings ?? [],
        exported_at: new Date().toISOString(),
      },
      payload
    );
  } catch (err) {
    // Lost a first-export race on client_session_id — converge on the
    // winner's row and treat this call as the re-export it now is.
    if (repo.pgErrorCode(err) === UNIQUE_VIOLATION && input.clientSessionId) {
      const raced = await repo.findChatByClientSession(
        ctx.workspaceId,
        ctx.userId,
        input.clientSessionId
      );
      if (raced) return reexportChat(ctx, raced, input, folderRow, payload);
    }
    throw err;
  }

  // Inheritance covers grants too: a chat filed into a team-scoped folder
  // gets the folder's team grant set (replace-set).
  if (folderRow) {
    await syncChatGrantsToFolder(ctx, chat.id, folderRow);
  }

  // Echo back the owner's just-written chat without the retention window —
  // a backfilled old session must not 403 on the response.
  return readChatDetail(ctx, chat.id);
}

/**
 * Idempotent re-export of an existing chat: overwrite only the header
 * fields the caller actually passed (preserve the rest), reconcile the
 * transcript non-destructively (upsert by position, keep appended
 * history), and revive the chat if it had been soft-deleted. `format` is
 * recomputed from the reconciled transcript so a partial re-export can't
 * leave it stale.
 */
async function reexportChat(
  ctx: ChatContext,
  existing: ChatRow,
  input: ChatExportInput,
  folderRow: ChatFolderRow | null,
  payload: MessagePayload
): Promise<ChatDetail> {
  const folderId = folderRow?.id ?? null;
  const inherited = folderRow
    ? { visibility: folderRow.visibility, access_mode: folderRow.access_mode }
    : null;

  const chat = await repo.updateChat(existing.id, {
    title: input.title,
    exported_at: new Date().toISOString(),
    // Re-exporting a session revives it if it had been trashed.
    deleted_at: null,
    ...(input.overview !== undefined ? { overview: input.overview } : {}),
    ...(input.source !== undefined ? { source: input.source } : {}),
    ...(input.project !== undefined ? { project: input.project ?? null } : {}),
    ...(input.sessionDate ? { session_date: input.sessionDate } : {}),
    ...(input.deliverables !== undefined ? { deliverables: input.deliverables } : {}),
    ...(input.learnings !== undefined ? { learnings: input.learnings } : {}),
    ...(folderId ? { folder_id: folderId, ...inherited } : {}),
  });

  await repo.mergeMessages(chat.id, ctx.workspaceId, payload);

  // Keep format honest against the reconciled transcript (re-sent ∪ kept).
  const all = await repo.listMessages(chat.id);
  const format = deriveFormat(all.map((m) => ({ verbatim: m.verbatim ?? undefined })));
  if (format !== chat.format) {
    await repo.updateChat(chat.id, { format });
  }

  if (folderRow) {
    await syncChatGrantsToFolder(ctx, chat.id, folderRow);
  }
  return readChatDetail(ctx, chat.id);
}

// ─── Mutations (owner-only) ─────────────────────────────────────────

export async function appendMessages(
  ctx: ChatContext,
  chatId: string,
  rawInput: ChatAppendInput
): Promise<ChatDetail> {
  const input = stripNulDeep(rawInput);
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

  const [{ since }, detail] = await Promise.all([
    resolveChatsWindow(ctx.workspaceId),
    readChatDetail(ctx, chat.id),
  ]);
  // The append itself is always allowed, but the echo must not become a
  // retention-window bypass: appending one message to a >90-day chat on a
  // free workspace can't be used to read the whole hidden transcript back.
  // `messageCount` stays honest (set inside readChatDetail); only the
  // transcript body is withheld. Consumers (MCP `op=append`) read the count,
  // not the messages, so this stays compatible.
  if (since !== null && detail.sessionDate < since) {
    return { ...detail, messages: [] };
  }
  return detail;
}

export async function updateChatHeader(
  ctx: ChatContext,
  chatId: string,
  rawPatch: ChatUpdateInput
): Promise<Chat> {
  const patch = stripNulDeep(rawPatch);
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

/**
 * Soft-delete (F-11): hide the chat from active reads but keep it
 * restorable from trash — no more irrecoverable physical delete.
 */
export async function deleteChat(ctx: ChatContext, chatId: string): Promise<void> {
  const chat = await requireOwnChat(ctx, chatId, "delete it");
  await repo.softDeleteChat(ctx.workspaceId, chat.id);
}

/**
 * Restore a soft-deleted chat (owner-only). Resolves the chat FROM TRASH
 * (an active or unknown chat reads as not found), then clears its
 * `deleted_at`.
 */
export async function restoreChat(ctx: ChatContext, chatId: string): Promise<Chat> {
  const row = await repo.findDeletedChatById(ctx.workspaceId, chatId);
  if (!row) throw new ChatNotFoundError(chatId);
  if (row.owner_id !== ctx.userId || ctx.apiKeyWorkspaceId) {
    throw new ChatForbiddenError("restore it");
  }
  const restored = await repo.restoreChatRow(ctx.workspaceId, row.id);
  const [count, profiles] = await Promise.all([
    repo.countMessages(restored.id),
    profilesById([restored.owner_id]),
  ]);
  return mapChatRow(
    restored,
    mapOwner(restored.owner_id, profiles.get(restored.owner_id)),
    count
  );
}
