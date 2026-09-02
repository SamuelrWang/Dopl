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

/**
 * ⚠ Visibility gate only, NO retention window. Used by `service-writes` to echo
 * a just-written chat — an owner backfilling an old session must get their chat
 * back, not a window denial.
 *
 * 🔒 ⚠ **KEYED TO `ctx.workspaceId`, AND IT MUST STAY THAT WAY — IT IS THE WRITE
 * ECHO.** Every mutation in `service-writes.ts` returns through it, so the
 * tenancy it reads in is the tenancy that write landed in. The ID-RESOLVING read
 * is {@link getChat}; the split is A12's, restated for this feature
 * (INVARIANTS §T35).
 */
export async function readChatDetail(
  ctx: ChatContext,
  chatId: string
): Promise<ChatDetail> {
  const detail = await loadVisibleChat(ctx, chatId);
  if (!detail) throw new ChatNotFoundError(chatId);
  return detail;
}

/** The read both chat doors share: one chat, in ONE named container, through
 *  the visibility gate and the folder-privacy fold. `null` = not visible, which
 *  the callers turn into the single 404. */
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
 * Window-enforced detail read for browsing (web UI + MCP `get`). Throws
 * `ChatOutsideRetentionError` for the route to convert into the upgrade
 * envelope. `sessionDate`/`since` are `YYYY-MM-DD`, so lexical `<` is date
 * order; the boundary is DB-computed (`retentionCutoff`).
 *
 * 🔒 **THE READ DOOR, SO IT FOLLOWS THE ID (B2).** `workspace=` is optional on
 * the way in, and one that contradicts a resolvable id is IGNORED.
 *
 * ⚠ **THE RETENTION WINDOW IS THE RESOLVED CONTAINER'S, WHICH IS WHY THE TWO
 * READS ARE NO LONGER PARALLEL.** The window is a BILLING PLAN
 * (`retention.ts › resolveChatsWindow`), and a chat followed into another
 * container must be measured against THAT container's plan — asking the caller's
 * would let a free container's chat through on a paid caller's window, and hide
 * a paid container's chat from them. One extra round trip on this door, and it
 * is not optional.
 *
 * ⚠ **THE WINDOW IS NOT PART OF THE FOLLOW**, deliberately: a chat outside it
 * EXISTS and is visible, and says so with a distinct error the route turns into
 * an upgrade envelope. Folding it into `load` would make "too old" resolve as
 * "no such chat" and then quietly re-read the same chat in another container.
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
