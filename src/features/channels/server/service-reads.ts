import "server-only";
import type {
  Channel,
  ChannelMember,
  ChannelMessage,
} from "../types";
import type { MessageReadQuery } from "../schema";
import { ChannelNotFoundError } from "./errors";
import {
  mapChannelRow,
  mapMemberRow,
  mapMessageRow,
  type ChannelMemberRow,
  type ChannelRow,
} from "./dto";
import * as repo from "./repository";
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
  });
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
  const [counts, lasts] = await Promise.all([
    repo.memberCounts(ids),
    repo.lastMessages(ids),
  ]);
  const extras: ChannelExtras = { counts, lasts };
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
  const [counts, lasts] = await Promise.all([
    repo.memberCounts([channel.id]),
    repo.lastMessages([channel.id]),
  ]);
  return toChannelDto(channel, membership, { counts, lasts });
}

/** The channel's roster (visible to members + viewers of a public channel). */
export async function listChannelMembers(
  ctx: ChannelContext,
  ref: string
): Promise<ChannelMember[]> {
  const { channel } = await loadVisibleChannel(ctx, ref);
  const rows = await repo.listMembers(channel.id);
  const profiles = await profilesById(rows.map((r) => r.user_id));
  return rows.map((row) => mapMemberRow(row, profiles.get(row.user_id)));
}

async function hydrateMessages(
  rows: Awaited<ReturnType<typeof repo.listMessages>>
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
 * Cursor-based message read (`seq > since`, ascending, capped at `limit`).
 * A member's read advances their `last_read_at` watermark as a
 * best-effort side-effect (the chosen read-tracking mechanism), so viewing
 * the thread — including a realtime-triggered refetch — clears its unread
 * state. Non-members reading a public channel don't have a watermark to
 * move.
 */
export async function readMessages(
  ctx: ChannelContext,
  ref: string,
  query: MessageReadQuery
): Promise<ChannelMessage[]> {
  const { channel, membership } = await loadVisibleChannel(ctx, ref);
  const rows = await repo.listMessages(channel.id, {
    since: query.since,
    limit: query.limit,
  });
  const messages = await hydrateMessages(rows);
  if (membership) {
    try {
      await repo.updateLastRead(channel.id, ctx.userId, new Date().toISOString());
    } catch {
      // Best-effort — a failed watermark bump must not fail the read.
    }
  }
  return messages;
}

/**
 * Resolve a channel ref to its id after validating the caller may read it.
 * The await route calls this once to resolve the ref, then re-checks access
 * cheaply each tick via `revalidateAwaitAccess` (a long poll must not keep
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
 * Per-tick access recheck for the await long-poll. The channel must still
 * exist (a soft-delete stamps `deleted_at`, which `findChannelById` filters
 * out) and, for a PRIVATE channel, the caller must still be a member.
 * Either loss throws `ChannelNotFoundError` (-> 404) so the poll loop ends
 * instead of leaking a channel the caller can no longer see. Two indexed
 * lookups — cheap enough to run every ~1.5s tick.
 */
export async function revalidateAwaitAccess(
  ctx: ChannelContext,
  channelId: string
): Promise<void> {
  const channel = await repo.findChannelById(ctx.workspaceId, channelId);
  if (!channel) throw new ChannelNotFoundError(channelId);
  if (channel.visibility !== "public") {
    const membership = await repo.findMembership(channelId, ctx.userId);
    if (!membership) throw new ChannelNotFoundError(channelId);
  }
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
  since: number | undefined
): Promise<ChannelMessage[]> {
  const rows = await repo.listMessages(channelId, { since, limit: 200 });
  return hydrateMessages(rows);
}
