import "server-only";
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

/** Read-side chats service: visibility-filtered list + single-chat detail.
 *  Both funnel through the visibility gate + grant context in
 *  `service-shared`, then the retention window (hide, never delete) from
 *  `./retention`. */

/** Own chats + workspace-shared + team-scoped ones granted to the caller's
 *  teams, minus anything outside the retention window (excluded in the DB
 *  query). `hiddenCount` = how many the window hid; 0 on full-history plans. */
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
  // ⚠ `truncated` is the READ's, not the filtered list's, and it is passed on
  // rather than folded into `hiddenCount`: they answer different questions —
  // one is "your plan hides older chats", the other is "this read did not reach
  // the end". A clip that rendered as a retention notice would offer an upgrade
  // as the remedy for a ceiling upgrading does not move (INVARIANTS §9).
  return { chats, hiddenCount, truncated };
}

/** ⚠ Visibility gate only, NO retention window. Used by `service-writes` to
 *  echo a just-written chat — an owner backfilling an old session must get
 *  their chat back, not a window denial. */
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

/** Window-enforced detail read for browsing (web UI + MCP `get`). Throws
 *  `ChatOutsideRetentionError` for the route to convert into the upgrade
 *  envelope. `sessionDate`/`since` are `YYYY-MM-DD`, so lexical `<` is date
 *  order; the boundary is DB-computed (`retentionCutoff`). */
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
