import "server-only";
import type { Chat, ChatDetail } from "../types";
import { ChatNotFoundError } from "./errors";
import { mapChatRow, mapMessageRow, mapOwner } from "./dto";
import * as repo from "./repository";
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
 * gate + grant context in `service-shared`.
 */

/** Everything the caller may read: own chats, workspace-shared ones, and
 *  team-scoped ones granted to one of the caller's teams. */
export async function listChats(ctx: ChatContext): Promise<Chat[]> {
  const rows = await repo.listVisibleChats(ctx.workspaceId, ctx.userId);
  const grants = await grantsForRows(ctx, rows);
  const visible = rows.filter((row) => canSeeChat(ctx, row, grants));
  const profiles = await profilesById(visible.map((r) => r.owner_id));
  return visible.map((row) =>
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
}

export async function getChat(ctx: ChatContext, chatId: string): Promise<ChatDetail> {
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
