import "server-only";
import { readResourceById } from "@/shared/tenancy/read-resource";
import type { ChatDetail, ChatList } from "../types";
import { ChatNotFoundError, ChatOutsideRetentionError } from "./errors";
import { mapChatRow, mapMessageRow, mapOwner } from "./dto";
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

/** Read-side chats: visibility gate (`service-shared`) then retention window
 *  (`./retention`; hide, never delete). */

/** Own + shared + team-granted chats inside the retention window.
 *  `hiddenCount` = how many the window hid. */
export async function listChats(ctx: ChatContext): Promise<ChatList> {
  const { since } = await resolveChatsWindow(ctx.workspaceId);
  const [{ rows, truncated }, hiddenCount] = await Promise.all([
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
  // ⚠ `truncated` (read hit the ceiling) stays separate from `hiddenCount`
  // (plan hides older chats) — upgrading doesn't lift the ceiling (INVARIANTS §9).
  return { chats, hiddenCount, truncated };
}

/**
 * ⚠ Visibility gate only, NO retention window — the write echo, so a
 * backfilled old session comes back.
 *
 * 🔒 ⚠ MUST stay keyed to `ctx.workspaceId` (reads where the write landed).
 * The id-resolving read is {@link getChat} (INVARIANTS §T35).
 */
export async function readChatDetail(
  ctx: ChatContext,
  chatId: string
): Promise<ChatDetail> {
  const detail = await loadVisibleChat(ctx, chatId);
  if (!detail) throw new ChatNotFoundError(chatId);
  return detail;
}

/** Shared by both doors: one chat in ONE container, gated + folder-privacy
 *  folded. `null` = not visible (→ 404). */
async function loadVisibleChat(
  ctx: ChatContext,
  chatId: string
): Promise<ChatDetail | null> {
  const row = await repo.findChatById(ctx.workspaceId, chatId);
  if (!row) return null;
  const grants = await grantsForRows(ctx, [row]);
  if (!canSeeChat(ctx, row, grants)) return null;
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
 * Window-enforced detail read (web UI + MCP `get`); throws
 * `ChatOutsideRetentionError` → upgrade envelope. `YYYY-MM-DD` so lexical `<`
 * is date order.
 *
 * 🔒 THE READ DOOR — follows the id (B2); a contradicting `workspace=` is ignored.
 *
 * ⚠ The window is the RESOLVED container's plan (`retention.ts ›
 * resolveChatsWindow`), not the caller's — else a paid caller's window would
 * expose a free container's chat. Hence the sequential round trip.
 *
 * ⚠ The window is NOT part of the follow: "too old" must not resolve as "no
 * such chat" and re-read elsewhere.
 */
export async function getChat(ctx: ChatContext, chatId: string): Promise<ChatDetail> {
  const hit = await readResourceById(ctx, "chat", chatId, loadVisibleChat);
  if (!hit) throw new ChatNotFoundError(chatId);
  const { since } = await resolveChatsWindow(hit.ctx.workspaceId);
  if (since !== null && hit.value.sessionDate < since) {
    throw new ChatOutsideRetentionError(chatId);
  }
  return hit.value;
}
