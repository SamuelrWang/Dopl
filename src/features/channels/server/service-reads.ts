import "server-only";
import type {
  Channel,
  ChannelAgent,
  ChannelDirectPeer,
  ChannelMember,
  ChannelMessage,
  ChannelReadEntry,
  ChannelThread,
} from "../types";
import type { MessageReadQuery } from "../schema";
import { ChannelNotFoundError, TaskNotFoundError } from "./errors";
import { mapAgentRow } from "./agents-dto";
import {
  mapChannelRow,
  mapMemberRow,
  mapTaskRow,
  type ChannelMemberRow,
  type ChannelRow,
} from "./dto";
import * as repo from "./repository";
import * as repoAgents from "./repository-agents";
import * as repoMessages from "./repository-messages";
import * as repoTasks from "./repository-tasks";
import * as collab from "./repository-collab";
import * as workspaceRepo from "@/features/workspaces/server/repository";
import type { MemberPresence } from "./dto";
import {
  hydrateMessages,
  loadVisibleChannel,
  mayReadPublicChannels,
  profilesById,
  type ChannelContext,
} from "./service-shared";
// ⚠ ONE-WAY, AND THE DIRECTION IS THE POINT: this file reads the artifact
// service; the artifact service must never read this one back. Both take the
// hydrator from `service-shared.ts`, which is what keeps that true.
import { foldPage } from "./service-artifacts";
import { takeLineBudget } from "../lib/transcript-line-budget";

/**
 * Read-side channels service: visibility-filtered list, single-channel header,
 * roster, cursor-based message reads — all through `service-shared`'s visibility
 * gate. A member's message read doubles as the read-watermark update.
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
    // Off the caller's own membership row, already loaded for `role` and the
    // watermark — the sidebar's Favorites section adds no read.
    favoritedAt: membership?.favorited_at ?? null,
    onlineMemberCount: extras.online.get(row.id) ?? 0,
    directPeer: extras.directPeers.get(row.id) ?? null,
  });
}

/**
 * Resolve the rendered peer for every direct channel in `rows`, hydrated from
 * the roster. ⚠ Resolved LIVE, never stored as truth — a display name/avatar
 * changes. One profile fetch for the whole page.
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
  presence: Map<string, MemberPresence>
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
    // ⚠ A GUEST GETS NO PUBLIC ARM (2026-08-26) — the list half of the fence
    // `loadVisibleChannel` applies to a single ref. Without it a container's
    // public channel appears in a guest's list and every route then admits it.
    includePublic: mayReadPublicChannels(ctx),
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
  const memberIds = rows.map((r) => r.user_id);
  const [profiles, presence, workspaceRoles] = await Promise.all([
    profilesById(memberIds),
    collab.presenceForWorkspace(ctx.workspaceId),
    // ⚠ WORKSPACE role, for the "Guest" pill — the channel row's role is only
    // owner/member. Bounded to the roster's own ids (§9). No workspace row →
    // null → "not a guest".
    workspaceRepo.listMemberRolesByUserIds(ctx.workspaceId, memberIds),
  ]);
  // ⚠ Private-preference scrub (notify_scope + agent_tool_profile only on the
  // caller's own row) is enforced inside `mapMemberRow`.
  return rows.map((row) =>
    mapMemberRow(row, profiles.get(row.user_id), {
      viewerUserId: ctx.userId,
      presence: presence.get(row.user_id),
      workspaceRole: workspaceRoles.get(row.user_id) ?? null,
    })
  );
}

/**
 * ⚠ **THE HYDRATOR MOVED DOWN INTO `service-shared.ts`** (2026-09-06, A4 second
 * slice), shared with `service-artifacts.ts`: wiring the fold into the read
 * below would otherwise have made this file import the artifact service that
 * imports it. The arrow was NOT reversed. Its two page-wide joins stay
 * page-wide — `agentNamesFor` costs a purely human page nothing (2026-09-04).
 */

/**
 * Cursor-based message read — forward from `since`, BACKWARD from `before`, or
 * the newest page when neither is given, capped at `limit` and optionally scoped
 * to ONE thread (`query.thread` → `metadata.taskId`). A member's read advances
 * `last_read_at` best-effort; a non-member on a public channel has none to move.
 *
 * ⚠ A THREAD-SCOPED read moves NO watermark: content-derived and monotonic, it
 * would jump over every unrelated older message and mark those read unseen.
 *
 * ⚠ A `before` PAGE MOVES NO WATERMARK EITHER — belt on braces, since a page of
 * HISTORY can only fail the monotonic `>` test below. Skipping it says the
 * intent out loud and saves a re-derive per page of scrollback.
 */
export async function readMessages(
  ctx: ChannelContext,
  ref: string,
  query: MessageReadQuery
): Promise<ChannelMessage[]> {
  return (await readMessagePage(ctx, ref, query)).messages;
}

/**
 * THE READ, WITH THE CHANNEL ID IT RESOLVED — the one body behind both
 * {@link readMessages} and {@link readTranscript}.
 *
 * ⚠ **ONE GATE READ, ONE HYDRATE, ONE WATERMARK RULE.** The fold needs the
 * channel id; `readTranscript` calling `readMessages` and re-resolving the ref
 * would run the visibility gate twice and give the watermark a second place to
 * be decided. `readMessages`'s signature and behaviour are untouched — the
 * pollers, the hold and the desktop all call it.
 */
async function readMessagePage(
  ctx: ChannelContext,
  ref: string,
  query: MessageReadQuery
): Promise<{ channelId: string; messages: ChannelMessage[]; hasMore: boolean }> {
  const { channel, membership } = await loadVisibleChannel(ctx, ref);
  const fetched = await repoMessages.listMessages(channel.id, {
    since: query.since,
    before: query.before,
    limit: query.limit,
    threadId: query.thread,
  });
  // ⚠ **ONE QUERY, TRIMMED HERE — keyset untouched**, before hydration so the
  // page-wide joins pay only for returned rows. Rule and `hasMore`:
  // `lib/transcript-line-budget.ts › takeLineBudget`.
  const { rows, hasMore } = takeLineBudget(fetched, query.limit, query.lineBudget);
  const messages = await hydrateMessages(rows, ctx.workspaceId);
  if (
    membership &&
    query.thread === undefined &&
    query.before === undefined &&
    messages.length > 0
  ) {
    // ⚠ Watermark = newest message SHOWN, written only when it ADVANCES.
    // Writing now() on every read emits a `channel_members` UPDATE — itself a
    // subscribed realtime event — so every tab re-fires every other tab in a
    // permanent refetch loop.
    const newest = messages.reduce(
      (max, m) => (Date.parse(m.createdAt) > Date.parse(max) ? m.createdAt : max),
      messages[0].createdAt
    );
    const current = membership.last_read_at;
    if (current === null || Date.parse(newest) > Date.parse(current)) {
      try {
        await repo.updateLastRead(channel.id, ctx.userId, newest);
      } catch {
        // ⚠ Best-effort — a failed watermark bump must not fail the read.
      }
    }
  }
  return { channelId: channel.id, messages, hasMore };
}

/**
 * THE TRANSCRIPT AS THE WIRE CARRIES IT: the page, plus its folded rendering
 * **only when something actually folded**.
 *
 * ⚠ **THE FOLD IS A RENDERING OF THE PAGE, NOT A FILTER ON IT.** The read above
 * runs unchanged — same gate, same rows, same watermark.
 *
 * ⚠ **IT FOLDS ONLY THE DEFAULT PAGE**, decided in `foldPage`
 * (`readNamesMessages`): a thread-scoped read and a bounded `since`+`before`
 * window always return their messages. Callers must not second-guess it.
 *
 * ⚠ **`entries === null` MEANS "NOTHING ON THIS PAGE IS IN AN ARTIFACT", NOT
 * "THIS SERVER CANNOT FOLD".** Carrying both in full would double the bytes of
 * every ordinary transcript read. (`readEntries` — entries without the page —
 * was deleted 2026-09-06; no caller ever arrived.)
 *
 * ⚠ **`hasMore` IS THE SERVER'S ANSWER TO "IS THERE OLDER HISTORY", AND THE
 * CLIENT MAY NOT RE-DERIVE IT (2026-09-08).** A line-budgeted page is SHORT BY
 * DESIGN, so `rows.length === pageSize` would read "exhausted" on the first page
 * of a channel of long messages. `lib/transcript-line-budget.ts ›
 * takeLineBudget` owns the rule.
 *
 * ⚠ **`messages` STAYS COMPLETE, AND THAT IS DELIBERATE.** Design §4 warns the
 * fold is "honestly breaking for artifact-unaware clients", so an older client
 * keeps showing the run rather than losing rows. When every renderer reads
 * `entries`, `messages` is what gets dropped — not the other way round.
 */
export async function readTranscript(
  ctx: ChannelContext,
  ref: string,
  query: MessageReadQuery
): Promise<{
  messages: ChannelMessage[];
  entries: ChannelReadEntry[] | null;
  hasMore: boolean;
}> {
  const { channelId, messages, hasMore } = await readMessagePage(ctx, ref, query);
  const entries = await foldPage(channelId, messages, {
    since: query.since,
    before: query.before,
    thread: query.thread,
  });
  const folded = entries.some((entry) => entry.type === "artifact");
  return { messages, entries: folded ? entries : null, hasMore };
}

/**
 * Resolve a channel ref to its id after validating read access. ⚠ A FULL access
 * check, covering the await hold's tick-0 read; the hold then re-checks via
 * `revalidateAwaitAccess`, since a long poll must not keep streaming a channel
 * deleted or a membership revoked mid-poll.
 */
export async function resolveReadableChannelId(
  ctx: ChannelContext,
  ref: string
): Promise<string> {
  const { channel } = await loadVisibleChannel(ctx, ref);
  return channel.id;
}

/**
 * Access recheck for the await long-poll. Channel must still exist (soft-delete
 * stamps `deleted_at`, which the lookup filters) and, for a PRIVATE channel, the
 * caller must still be a member. Either loss throws `ChannelNotFoundError` so
 * the hold ends rather than leaking a channel the caller cannot see.
 *
 * ⚠ Two indexed lookups projected to the columns the decision reads
 * (`findChannelAccess` / `hasMembership`) — the hold's dominant egress line item.
 */
export async function revalidateAwaitAccess(
  ctx: ChannelContext,
  channelId: string
): Promise<void> {
  const channel = await repo.findChannelAccess(ctx.workspaceId, channelId);
  if (!channel) throw new ChannelNotFoundError(channelId);
  // ⚠ `mayReadPublicChannels` MIRRORS `loadVisibleChannel`'s gate EXACTLY — the
  // SAME question one tick later. A guest gets no public arm here either, or the
  // entry gate would refuse a channel the hold would keep streaming.
  if (channel.visibility !== "public" || !mayReadPublicChannels(ctx)) {
    const isMember = await repo.hasMembership(channelId, ctx.userId);
    if (!isMember) throw new ChannelNotFoundError(channelId);
  }
}

/**
 * Existence probe behind one await tick: is anything past `since`? The hold runs
 * this instead of a row read on every tick after the first, and only calls
 * `pollChannelMessages` once it hits.
 */
export async function hasNewMessages(
  channelId: string,
  since: number | undefined,
  excludeAuthor?: string
): Promise<boolean> {
  return repoMessages.hasMessagesAfter(channelId, since, excludeAuthor);
}

/**
 * One await poll on an already-validated channel id. ⚠ Unlike `readMessages`
 * this does NOT move the read watermark — a background long-poll is a listener,
 * not a human viewing the thread. Bounded sleep-loop lives in the route.
 */
export async function pollChannelMessages(
  channelId: string,
  workspaceId: string,
  since: number | undefined,
  excludeAuthor?: string
): Promise<ChannelMessage[]> {
  const rows = await repoMessages.listMessages(channelId, {
    since,
    limit: 200,
    excludeAuthor,
  });
  return hydrateMessages(rows, workspaceId);
}

/**
 * Every task in a channel the caller may read, MOST RECENTLY ACTIVE FIRST, and
 * whether the read clipped. One read behind both the web's `Map<taskId,
 * overlay>` and the MCP `list_threads` listing, so the two surfaces cannot
 * disagree about which thread is live. Gated by the transcript's visibility rule.
 *
 * ⚠ `truncated` is not decoration: threads never leave this list, so a clipped
 * list rendering like an exhausted one is the bug (INVARIANTS §9). Never drop it.
 */
export async function listChannelTasks(
  ctx: ChannelContext,
  ref: string
): Promise<{ threads: ChannelThread[]; truncated: boolean }> {
  const { channel } = await loadVisibleChannel(ctx, ref);
  const { rows, truncated } = await repoTasks.listTasksByChannel(channel.id);
  return { threads: rows.map(mapTaskRow), truncated };
}

/**
 * THE ATTRIBUTION ROSTER — every named agent that ever existed in this channel.
 * All that is left of the named-agent surface: the transcript must turn a stored
 * `metadata.author_agent_id` back into the handle it rendered that day, or an
 * old agent message silently loses its name.
 *
 * Visibility is the CHANNEL's read gate, so an outsider cannot enumerate a
 * room's history. ⚠ Dismissed rows are INCLUDED — they are the ones most likely
 * to own old messages.
 */
export async function listAgents(
  ctx: ChannelContext,
  ref: string
): Promise<ChannelAgent[]> {
  const { channel } = await loadVisibleChannel(ctx, ref);
  const rows = await repoAgents.listAgentsByChannel(channel.id);
  return rows.map(mapAgentRow);
}

/**
 * One task by id, scoped to a channel the caller may read. ⚠ A task id not
 * resolving to a task IN THIS channel is a `TaskNotFoundError` — ids cannot be
 * probed across channels.
 */
export async function getChannelTask(
  ctx: ChannelContext,
  ref: string,
  taskId: string
): Promise<ChannelThread> {
  const { channel } = await loadVisibleChannel(ctx, ref);
  const row = await repoTasks.findTaskByChannelAndId(channel.id, taskId);
  if (!row) throw new TaskNotFoundError(taskId);
  return mapTaskRow(row);
}
