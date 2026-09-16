import "server-only";
import {
  CHANNEL_MENTION_LIST_LIMIT,
  MENTION_SNIPPET_MAX_CHARS,
} from "../constants";
import type { ChannelMention, MessageAuthorKind } from "../types";
import { authorAgentIdOf } from "../lib/agent-post-stamp";
import * as repoMentions from "./repository-mentions";
import * as repoSessions from "./repository-agent-facets";
import {
  profilesById,
  loadVisibleChannel,
  type ChannelContext,
} from "./service-shared";

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
/**
 * WHICH AGENT WROTE ONE INBOX ROW — the ONE parser, applied to this table's shape.
 * ⚠ Its own function so the id the FILTER keys on and the id the ROW renders are
 * the same derivation; two call sites spelling it apart is how a row gets dropped
 * for an agent it is not actually attributed to.
 */
function agentIdOfRow(row: repoMentions.MentionMessageRow): string | null {
  return authorAgentIdOf({
    clientMsgId: row.client_msg_id,
    metadata:
      row.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata)
        ? (row.metadata as Record<string, unknown>)
        : null,
  });
}

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
  // ⚠ ONE PAGE-WIDE JOIN FOR THE AGENT HALF — name, colour and liveness together
  // (`repository-sessions.ts › agentFacets`). The id still comes off the ONE
  // parser, so the inbox and the message it points at cannot name one agent
  // differently. Bounded by the page like the two reads beside it.
  const agentIds = rows
    .filter((row) => row.author_kind === "agent")
    .map((row) => agentIdOfRow(row))
    .filter((id): id is string => id !== null);
  const [read, profiles, agents] = await Promise.all([
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
    repoSessions.agentFacets([channel.workspace_id], agentIds),
  ]);

  const mentions = rows.map((row): ChannelMention => {
    const profile = row.author_user_id
      ? profiles.get(row.author_user_id)
      : undefined;
    const agentId = row.author_kind === "agent" ? agentIdOfRow(row) : null;
    const facet = agentId === null ? undefined : agents.get(agentId);
    return {
      messageId: row.id,
      seq: Number(row.seq),
      channelId: row.channel_id,
      threadId: threadIdOf(row.metadata),
      authorUserId: row.author_user_id,
      authorKind: row.author_kind as MessageAuthorKind,
      authorName: profile?.display_name || profile?.email || null,
      authorAvatarUrl: profile?.avatar_url ?? null,
      // ⚠ WHICH agent, and WHAT ITS OPERATOR CALLS IT — the id off the ONE parser
      // (`authorAgentIdOf`: the post stamp, else the server's own session key), the
      // name off the page join above. BOTH may be null and they are independent:
      // `null` is CANNOT SAY, never "not an agent" — `authorKind` answers that — and
      // every renderer falls back through name -> `#id` -> the bare noun
      // (INVARIANTS §11).
      authorAgentId: agentId,
      authorAgentName: facet?.displayName ?? null,
      // ⚠ THE AGENT'S IDENTITY COLOUR, the one the Agents tab and the transcript
      // already taught the reader. `null` is legitimate — a seventeenth live agent
      // in one room runs UNCOLOURED (`lib/agent-colors.ts`), so a renderer must
      // degrade rather than invent a hue.
      authorAgentColor: (facet?.color ?? null) as ChannelMention["authorAgentColor"],
      snippet: snippetOf(row.body),
      createdAt: row.created_at,
      read: read.has(row.id),
    };
  });
  // ⚠ **AN ENDED AGENT'S MENTIONS LEAVE THE LIST — FILTERED AT READ, NEVER
  // DELETED** (Samuel, 2026-09-15). The MESSAGE is untouched and still sits in the
  // transcript with its tag intact; what changes is what this list shows. A delete
  // would destroy a record to tidy a view, and `channel_mention_reads` rows would
  // outlive the thing they point at.
  //
  // ⚠ **"ENDED" IS "NOT LIVE IN `channel_sessions`"** — that table is a projection
  // of live desktop registries and an ended session is dropped from it
  // (`repository-sessions.ts › agentFacets` carries the argument).
  //
  // ⚠ **ONLY A ROW WE CAN ATTRIBUTE IS ELIGIBLE.** No agent id means CANNOT SAY,
  // not ENDED (INVARIANTS §11), so an older unstamped agent post and every human
  // post stay — dropping those would silently empty the inbox of exactly the rows
  // this feature could not explain.
  //
  // ⚠ **THE 50-CAP IS THE QUERY'S AND THIS TRIMS AFTER IT**, so a page can come
  // back shorter than the cap. `truncated` still describes the READ, which is the
  // honest thing for it to describe: it says more rows exist below the cut, and
  // that remains true whether or not this filter removed any.
  const live = mentions.filter(
    (m) => m.authorAgentId === null || (agents.get(m.authorAgentId)?.live ?? false)
  );
  return { mentions: live, truncated };
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
