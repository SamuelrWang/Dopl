import "server-only";
import {
  CHANNEL_MENTION_LIST_LIMIT,
  MENTION_SNIPPET_MAX_CHARS,
} from "../constants";
import type { ChannelMention, MessageAuthorKind } from "../types";
import * as repoMentions from "./repository-mentions";
import { profilesById, loadVisibleChannel, type ChannelContext } from "./service-shared";

/**
 * THE MENTIONS INBOX — read and write.
 *
 * A mention is a message whose server-stamped `metadata.mentionedUserIds`
 * carries the viewer's id (`service-writes-metadata-mentions.ts`); read-state
 * is a ROW PER READ in `channel_mention_reads` (migration `20260818140000`),
 * because the inbox marks individual items read OUT OF ORDER and a cursor
 * cannot express that.
 *
 * ⚠ THE UNREAD COUNT IS NOT HERE, AND MUST NOT BE. It is client-side arithmetic
 * over this projection (wiring plan Phase 6, decision 3) — a second server
 * derivation of the same set is a badge free to disagree with the list it sits
 * above, which is the presence/sidebar-window shape (INVARIANTS §7).
 */

/** Snippet = the body's leading run, clipped, whitespace collapsed. ⚠ Clipped
 *  by CHARACTERS, and an ellipsis is appended only when something was dropped —
 *  a row that ends in "…" is a claim that there is more. */
function snippetOf(body: string): string {
  const flat = body.replace(/\s+/g, " ").trim();
  if (flat.length <= MENTION_SNIPPET_MAX_CHARS) return flat;
  return `${flat.slice(0, MENTION_SNIPPET_MAX_CHARS).trimEnd()}…`;
}

/** `metadata.taskId` off a stored row — the navigate target. Same three-line
 *  reader the v2 view-model uses; the key is the storage-boundary name. */
function threadIdOf(metadata: unknown): string | null {
  if (typeof metadata !== "object" || metadata === null) return null;
  const value = (metadata as Record<string, unknown>).taskId;
  return typeof value === "string" && value.length > 0 ? value : null;
}

/**
 * MY mentions in one channel, newest first, plus whether the read clipped.
 *
 * ⚠ SCOPED TO `ctx.userId`, WHICH IS NEVER READ FROM THE BODY. "Whose inbox"
 * is not a parameter — this projection can only ever answer for the caller,
 * the same discipline the consent read carries (INVARIANTS §6). Channel
 * visibility is `loadVisibleChannel`'s gate, so a channel you cannot read
 * cannot be probed for who is mentioned in it.
 *
 * ⚠ `truncated` is load-bearing and must be carried through the client
 * boundary (INVARIANTS §9): the inbox is a record nothing leaves, so the bound
 * is real, and a clipped page that renders like an exhausted one is the bug.
 *
 * ⚠ NOTHING DOWNSTREAM RE-SORTS THE PAGE. The LIMIT clipped against `seq DESC`,
 * so a re-sorted page is the wrong rows in a plausible order.
 */
export async function listMyChannelMentions(
  ctx: ChannelContext,
  ref: string
): Promise<{ mentions: ChannelMention[]; truncated: boolean }> {
  const { channel } = await loadVisibleChannel(ctx, ref);
  const { rows, truncated } = await repoMentions.listMentionMessages(
    channel.id,
    ctx.userId,
    CHANNEL_MENTION_LIST_LIMIT
  );
  if (rows.length === 0) return { mentions: [], truncated };

  // Both reads are bounded BY THE PAGE: the read-state lookup is `IN` the ids
  // just fetched, and the profile hydration is the distinct authors of those
  // same rows. Neither is sized by the workspace.
  const [read, profiles] = await Promise.all([
    repoMentions.listMentionReads(
      ctx.userId,
      channel.id,
      rows.map((row) => row.id)
    ),
    profilesById(
      rows
        .map((row) => row.author_user_id)
        .filter((id): id is string => id !== null)
    ),
  ]);

  const mentions = rows.map((row): ChannelMention => {
    const profile = row.author_user_id
      ? profiles.get(row.author_user_id)
      : undefined;
    return {
      messageId: row.id,
      seq: Number(row.seq),
      channelId: row.channel_id,
      threadId: threadIdOf(row.metadata),
      authorUserId: row.author_user_id,
      authorKind: row.author_kind as MessageAuthorKind,
      authorName: profile?.display_name || profile?.email || null,
      authorAvatarUrl: profile?.avatar_url ?? null,
      snippet: snippetOf(row.body),
      createdAt: row.created_at,
      read: read.has(row.id),
    };
  });
  return { mentions, truncated };
}

/**
 * Mark mentions read. Returns how many of the named ids were ACCEPTED, i.e.
 * really are messages in this channel that tag the caller.
 *
 * ⚠ IDEMPOTENT, AND `marked` IS NOT A COUNT OF ROWS WRITTEN. Re-marking an
 * already-read mention is `ON CONFLICT DO NOTHING` and still counts as
 * accepted — the caller asked for a state, and the state holds. A count of
 * INSERTED rows would make the second click of a double click report failure.
 *
 * ⚠ AN ID THAT IS NOT MINE IS DROPPED, NOT 403'd. The client's page and the
 * server's page can legitimately disagree by a message (a mention edited out of
 * existence cannot happen, but a channel switch mid-flight can), and the honest
 * answer to "mark these read" for a row that is not the caller's mention is
 * that there was nothing to mark. Nothing is written for it, which is the whole
 * security property: the filter is the authorization.
 */
export async function markMentionsRead(
  ctx: ChannelContext,
  ref: string,
  messageIds: string[]
): Promise<{ marked: number }> {
  const { channel } = await loadVisibleChannel(ctx, ref);
  const accepted = await repoMentions.findMentionMessageIds(
    channel.id,
    ctx.userId,
    [...new Set(messageIds)]
  );
  await repoMentions.insertMentionReads(
    accepted.map((messageId) => ({
      user_id: ctx.userId,
      message_id: messageId,
      channel_id: channel.id,
      workspace_id: channel.workspace_id,
    }))
  );
  return { marked: accepted.length };
}
