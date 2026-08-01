import "server-only";
import type {
  Channel,
  ChannelDirectPeer,
  ChannelMember,
  ChannelMessage,
  ChannelThreadDetail,
} from "../types";
import type { MessageReadQuery } from "../schema";
import { ChannelNotFoundError, TaskNotFoundError } from "./errors";
import {
  mapChannelRow,
  mapMemberRow,
  mapMessageRow,
  mapTaskRow,
  type ChannelMemberRow,
  type ChannelRow,
} from "./dto";
import * as repo from "./repository";
import * as repoMessages from "./repository-messages";
import * as repoTasks from "./repository-tasks";
import * as collab from "./repository-collab";
import type { DerivedPresence } from "./repository-collab";
import {
  listThreadParticipants,
  participantsByThread,
} from "./service-participants";
import {
  loadVisibleChannel,
  profilesById,
  type ChannelContext,
} from "./service-shared";

/**
 * Read-side channels service: the visibility-filtered list, single-channel
 * header, roster, and cursor-based message reads. All funnel through the
 * shared visibility gate in `service-shared`. A member's message read
 * doubles as the read-watermark update (last_read_at) — see `readMessages`.
 */

interface ChannelExtras {
  counts: Map<string, number>;
  lasts: Map<string, string>;
  /** channelId -> count of members whose agent is currently online. */
  online: Map<string, number>;
  /** channelId -> resolved peer, for direct channels only. */
  directPeers: Map<string, ChannelDirectPeer>;
}

function toChannelDto(
  row: ChannelRow,
  membership: ChannelMemberRow | null,
  extras: ChannelExtras
): Channel {
  return mapChannelRow(row, {
    memberCount: extras.counts.get(row.id) ?? 0,
    lastMessageAt: extras.lasts.get(row.id) ?? null,
    role: (membership?.role as Channel["role"]) ?? null,
    lastReadAt: membership?.last_read_at ?? null,
    notifyScope: (membership?.notify_scope as Channel["myNotifyScope"]) ?? null,
    agentToolProfile:
      (membership?.agent_tool_profile as Channel["myAgentToolProfile"]) ?? null,
    onlineMemberCount: extras.online.get(row.id) ?? 0,
    directPeer: extras.directPeers.get(row.id) ?? null,
  });
}

/**
 * Resolve the rendered peer for every direct channel in `rows` — the OTHER
 * member (not the caller), hydrated with display name + avatar from the roster.
 * The peer is resolved LIVE (never stored as truth): a display name / avatar
 * can change. One profile fetch for the whole page.
 */
async function buildDirectPeers(
  rows: ChannelRow[],
  memberIds: Map<string, string[]>,
  selfId: string
): Promise<Map<string, ChannelDirectPeer>> {
  const peerByChannel = new Map<string, string>();
  for (const row of rows) {
    if (!row.is_direct) continue;
    const ids = memberIds.get(row.id) ?? [];
    const peerId = ids.find((id) => id !== selfId) ?? ids[0];
    if (peerId) peerByChannel.set(row.id, peerId);
  }
  if (peerByChannel.size === 0) return new Map();
  const profiles = await profilesById([...new Set(peerByChannel.values())]);
  const out = new Map<string, ChannelDirectPeer>();
  for (const [channelId, peerId] of peerByChannel) {
    const p = profiles.get(peerId);
    out.set(channelId, {
      userId: peerId,
      displayName: p?.display_name ?? null,
      avatarUrl: p?.avatar_url ?? null,
    });
  }
  return out;
}

/** Per-channel online-member counts from the workspace presence map. */
function onlineCounts(
  memberIds: Map<string, string[]>,
  presence: Map<string, DerivedPresence>
): Map<string, number> {
  const out = new Map<string, number>();
  for (const [channelId, userIds] of memberIds) {
    let n = 0;
    for (const userId of userIds) {
      if (presence.get(userId)?.online) n += 1;
    }
    out.set(channelId, n);
  }
  return out;
}

/** Every channel the caller may see, newest-active first. */
export async function listChannels(
  ctx: ChannelContext,
  includeArchived: boolean
): Promise<Channel[]> {
  const myMemberships = await repo.listMyMemberships(ctx.workspaceId, ctx.userId);
  const membershipByChannel = new Map(
    myMemberships.map((m) => [m.channel_id, m])
  );
  const rows = await repo.listChannels(ctx.workspaceId, {
    memberChannelIds: [...membershipByChannel.keys()],
    includeArchived,
  });
  const ids = rows.map((r) => r.id);
  const [counts, lasts, memberIds, presence] = await Promise.all([
    repo.memberCounts(ids),
    repoMessages.lastMessages(ids),
    collab.channelMemberUserIds(ids),
    collab.presenceForWorkspace(ctx.workspaceId),
  ]);
  const extras: ChannelExtras = {
    counts,
    lasts,
    online: onlineCounts(memberIds, presence),
    directPeers: await buildDirectPeers(rows, memberIds, ctx.userId),
  };
  return rows.map((row) =>
    toChannelDto(row, membershipByChannel.get(row.id) ?? null, extras)
  );
}

/** Single channel header + the caller's viewer state (Track B `open`). */
export async function getChannel(
  ctx: ChannelContext,
  ref: string
): Promise<Channel> {
  const { channel, membership } = await loadVisibleChannel(ctx, ref);
  const [counts, lasts, memberIds, presence] = await Promise.all([
    repo.memberCounts([channel.id]),
    repoMessages.lastMessages([channel.id]),
    collab.channelMemberUserIds([channel.id]),
    collab.presenceForWorkspace(ctx.workspaceId),
  ]);
  return toChannelDto(channel, membership, {
    counts,
    lasts,
    online: onlineCounts(memberIds, presence),
    directPeers: await buildDirectPeers([channel], memberIds, ctx.userId),
  });
}

/** The channel's roster (visible to members + viewers of a public channel). */
export async function listChannelMembers(
  ctx: ChannelContext,
  ref: string
): Promise<ChannelMember[]> {
  const { channel } = await loadVisibleChannel(ctx, ref);
  const rows = await repo.listMembers(channel.id);
  const [profiles, presence] = await Promise.all([
    profilesById(rows.map((r) => r.user_id)),
    collab.presenceForWorkspace(ctx.workspaceId),
  ]);
  // The private-preference scrub (notify_scope + agent_tool_profile are shown
  // only on the caller's own row) is enforced inside `mapMemberRow` — pass the
  // viewer and it holds for every roster read.
  return rows.map((row) =>
    mapMemberRow(row, profiles.get(row.user_id), {
      viewerUserId: ctx.userId,
      presence: presence.get(row.user_id),
    })
  );
}

async function hydrateMessages(
  rows: Awaited<ReturnType<typeof repoMessages.listMessages>>
): Promise<ChannelMessage[]> {
  const authorIds = rows
    .map((r) => r.author_user_id)
    .filter((id): id is string => id !== null);
  const profiles = await profilesById(authorIds);
  return rows.map((row) =>
    mapMessageRow(row, row.author_user_id ? profiles.get(row.author_user_id) : undefined)
  );
}

/**
 * Cursor-based message read (`seq > since`, ascending, capped at `limit`),
 * optionally scoped to ONE thread (`query.thread` -> `metadata.taskId`).
 * A member's read advances their `last_read_at` watermark as a
 * best-effort side-effect (the chosen read-tracking mechanism), so viewing
 * the thread — including a realtime-triggered refetch — clears its unread
 * state. Non-members reading a public channel don't have a watermark to
 * move.
 *
 * A THREAD-SCOPED read moves NO watermark. The watermark is content-derived
 * (the newest message SHOWN) and monotonic, so a filtered read would jump it
 * over every unrelated message older than the thread's latest post and mark
 * those read without anyone having seen them. Reading one exchange is not
 * viewing the channel; the unfiltered read is still the only thing that
 * clears the channel's unread state.
 */
export async function readMessages(
  ctx: ChannelContext,
  ref: string,
  query: MessageReadQuery
): Promise<ChannelMessage[]> {
  const { channel, membership } = await loadVisibleChannel(ctx, ref);
  const rows = await repoMessages.listMessages(channel.id, {
    since: query.since,
    limit: query.limit,
    threadId: query.thread,
  });
  const messages = await hydrateMessages(rows);
  if (membership && query.thread === undefined && messages.length > 0) {
    // Watermark = newest message SHOWN, written only when it advances.
    // Writing now() on every read made each realtime-triggered refetch emit
    // a channel_members UPDATE, which is itself a subscribed realtime event:
    // every open tab re-fired every other tab in a permanent refetch loop
    // (the 2026-07-27 CPU incident). Content-derived + monotonic = a refetch
    // that shows nothing new writes nothing and the cycle terminates.
    const newest = messages.reduce(
      (max, m) => (Date.parse(m.createdAt) > Date.parse(max) ? m.createdAt : max),
      messages[0].createdAt
    );
    const current = membership.last_read_at;
    if (current === null || Date.parse(newest) > Date.parse(current)) {
      try {
        await repo.updateLastRead(channel.id, ctx.userId, newest);
      } catch {
        // Best-effort — a failed watermark bump must not fail the read.
      }
    }
  }
  return messages;
}

/**
 * Resolve a channel ref to its id after validating the caller may read it.
 * The await hold calls this once to resolve the ref — it is a FULL access
 * check, so the hold's tick-0 read is already covered — then re-checks
 * periodically via `revalidateAwaitAccess` (a long poll must not keep
 * streaming a channel that was deleted or a membership that was revoked
 * mid-poll).
 */
export async function resolveReadableChannelId(
  ctx: ChannelContext,
  ref: string
): Promise<string> {
  const { channel } = await loadVisibleChannel(ctx, ref);
  return channel.id;
}

/**
 * Access recheck for the await long-poll. The channel must still exist (a
 * soft-delete stamps `deleted_at`, which the lookup filters out) and, for a
 * PRIVATE channel, the caller must still be a member. Either loss throws
 * `ChannelNotFoundError` (-> 404) so the hold ends instead of leaking a
 * channel the caller can no longer see.
 *
 * Two indexed lookups, both projected to the columns the decision actually
 * reads (`findChannelAccess` / `hasMembership`, ~120 bytes total instead of
 * ~840): this is the hold's dominant egress line item, so it never pulls a
 * row it will not look at. WHEN it runs is the caller's business — see
 * `awaitNewMessages` (first held tick, every `AWAIT_REVALIDATE_EVERY_TICKS`
 * after, and unconditionally before any message is returned).
 */
export async function revalidateAwaitAccess(
  ctx: ChannelContext,
  channelId: string
): Promise<void> {
  const channel = await repo.findChannelAccess(ctx.workspaceId, channelId);
  if (!channel) throw new ChannelNotFoundError(channelId);
  if (channel.visibility !== "public") {
    const isMember = await repo.hasMembership(channelId, ctx.userId);
    if (!isMember) throw new ChannelNotFoundError(channelId);
  }
}

/**
 * Existence probe behind one await tick: is anything past `since`? The hold
 * runs this instead of a row read for every tick after the first, and only
 * calls `pollChannelMessages` once it hits (Q8).
 */
export async function hasNewMessages(
  channelId: string,
  since: number | undefined,
  excludeAuthor?: string
): Promise<boolean> {
  return repoMessages.hasMessagesAfter(channelId, since, excludeAuthor);
}

/**
 * One await poll on an already-validated channel id: the messages with
 * `seq > since` (ascending). Unlike `readMessages` this does NOT move the
 * read watermark — an agent's background long-poll is a listener, not a
 * human viewing the thread. The bounded sleep-loop lives in the route
 * (`maxDuration`/`runtime`).
 */
export async function pollChannelMessages(
  channelId: string,
  since: number | undefined,
  excludeAuthor?: string
): Promise<ChannelMessage[]> {
  const rows = await repoMessages.listMessages(channelId, {
    since,
    limit: 200,
    excludeAuthor,
  });
  return hydrateMessages(rows);
}

/**
 * Every task in a channel the caller may read, newest first. Feeds the web's
 * `Map<taskId, overlay>` that layers authoritative status / title / mode onto
 * the message thread. Read access is gated by the same visibility rule as the
 * transcript (public channel, or the caller is a member).
 *
 * Each thread carries its PARTICIPANT SET (`[]` when it has none) — the
 * breakout room's membership, hydrated in ONE grouped query for the whole page
 * rather than one per card. Participant sets are channel-visible for the same
 * reason threads are: breakouts separate attention, not visibility (§8).
 */
export async function listChannelTasks(
  ctx: ChannelContext,
  ref: string
): Promise<ChannelThreadDetail[]> {
  const { channel } = await loadVisibleChannel(ctx, ref);
  const rows = await repoTasks.listTasksByChannel(channel.id);
  const participants = await participantsByThread(rows.map((row) => row.id));
  return rows.map((row) => ({
    ...mapTaskRow(row),
    participants: participants.get(row.id) ?? [],
  }));
}

/**
 * One task by id, scoped to a channel the caller may read. Read access is the
 * same visibility rule as the transcript (public channel, or the caller is a
 * member). A task id that does not resolve to a task IN THIS channel is a
 * `TaskNotFoundError` (→ 404) — the id can't be probed across channels.
 */
export async function getChannelTask(
  ctx: ChannelContext,
  ref: string,
  taskId: string
): Promise<ChannelThreadDetail> {
  const { channel } = await loadVisibleChannel(ctx, ref);
  const row = await repoTasks.findTaskByChannelAndId(channel.id, taskId);
  if (!row) throw new TaskNotFoundError(taskId);
  return {
    ...mapTaskRow(row),
    participants: await listThreadParticipants(row.id),
  };
}
