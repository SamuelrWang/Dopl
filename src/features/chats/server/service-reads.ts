import "server-only";
import type { ChatDetail, ChatList, TrashedChat } from "../types";
import { ChatNotFoundError, ChatOutsideRetentionError } from "./errors";
import { mapChatRow, mapMessageRow, mapOwner, mapTrashedChatRow } from "./dto";
import * as repo from "./repository";
import { resolveChatsWindow } from "./retention";
import {
  canSeeChat,
  grantedTeamIdsFor,
  grantsForRows,
  profilesById,
  withFolderPrivacy,
  type ChatContext,
} from "./service-shared";

/**
 * Read-side chats service: the visibility-filtered list + single-chat
 * detail (transcript) reads. Both funnel through the shared visibility
 * gate + grant context in `service-shared`, then the free-plan retention
 * window (hide, never delete) resolved in `./retention`.
 */

/**
 * Everything the caller may read: own chats, workspace-shared ones, and
 * team-scoped ones granted to one of the caller's teams — minus any that
 * fall outside the free-plan retention window (excluded in the DB query).
 * `hiddenCount` reports how many the window hid so the UI can offer an
 * upgrade; 0 on Pro / full-history plans.
 */
export async function listChats(ctx: ChatContext): Promise<ChatList> {
  const { since } = await resolveChatsWindow(ctx.workspaceId);
  const [rows, hiddenCount] = await Promise.all([
    repo.listVisibleChats(ctx.workspaceId, ctx.userId, since),
    since ? repo.countHiddenChats(ctx.workspaceId, ctx.userId, since) : Promise.resolve(0),
  ]);
  const grants = await grantsForRows(ctx, rows);
  const visible = rows.filter((row) => canSeeChat(ctx, row, grants));
  const profiles = await profilesById(visible.map((r) => r.owner_id));
  const chats = visible.map((row) =>
    withFolderPrivacy(
      ctx,
      row,
      mapChatRow(
        row,
        mapOwner(row.owner_id, profiles.get(row.owner_id)),
        repo.countOf(row),
        grantedTeamIdsFor(ctx, row, grants.byChat)
      )
    )
  );
  return { chats, hiddenCount };
}

/**
 * Trash view (F-11): the caller's own soft-deleted chats, newest-trashed
 * first, so they can find one to restore with `restoreChat`. Owner-scoped
 * — deletion is owner-only, so restore is too. The retention window does
 * not apply to trash.
 */
export async function listTrash(ctx: ChatContext): Promise<TrashedChat[]> {
  const rows = await repo.listTrashedChats(ctx.workspaceId, ctx.userId);
  const profiles = await profilesById(rows.map((r) => r.owner_id));
  return rows.map((row) =>
    mapTrashedChatRow(
      row,
      mapOwner(row.owner_id, profiles.get(row.owner_id)),
      repo.countOf(row)
    )
  );
}

/**
 * Base detail read — visibility gate only, NO retention window. Used
 * internally by writes (`service-writes`) to echo back a just-written
 * chat: an owner backfilling an old session must get their chat back, not
 * a window denial.
 */
export async function readChatDetail(
  ctx: ChatContext,
  chatId: string
): Promise<ChatDetail> {
  const row = await repo.findChatById(ctx.workspaceId, chatId);
  if (!row) throw new ChatNotFoundError(chatId);
  const grants = await grantsForRows(ctx, [row]);
  if (!canSeeChat(ctx, row, grants)) throw new ChatNotFoundError(chatId);
  const [messages, profiles] = await Promise.all([
    repo.listMessages(chatId),
    profilesById([row.owner_id]),
  ]);
  return {
    ...withFolderPrivacy(
      ctx,
      row,
      mapChatRow(
        row,
        mapOwner(row.owner_id, profiles.get(row.owner_id)),
        messages.length,
        grantedTeamIdsFor(ctx, row, grants.byChat)
      )
    ),
    messages: messages.map(mapMessageRow),
  };
}

/**
 * Window-enforced detail read for browsing (web UI + MCP `get`). A chat
 * outside the free-plan retention window is hidden — never deleted — so
 * this throws `ChatOutsideRetentionError` for the route to convert into
 * the friendly upgrade envelope. `sessionDate`/`since` are `YYYY-MM-DD`
 * strings; lexical `<` equals date order, and the boundary itself is
 * DB-computed (see `retentionCutoff`).
 */
export async function getChat(ctx: ChatContext, chatId: string): Promise<ChatDetail> {
  const [{ since }, detail] = await Promise.all([
    resolveChatsWindow(ctx.workspaceId),
    readChatDetail(ctx, chatId),
  ]);
  if (since !== null && detail.sessionDate < since) {
    throw new ChatOutsideRetentionError(chatId);
  }
  return detail;
}
