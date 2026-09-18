import "server-only";
import { workspaceSegment } from "@/features/workspaces/url";
import { isClaimable, mapLinkRow, type ChannelLinkRow } from "@/shared/links/dto";
import { listProfileSummaries } from "@/features/workspaces/server/repository";
import type {
  Channel,
  ChannelContainer,
  ChannelDirectPeer,
  ChannelPeer,
  ChannelPendingLink,
} from "../types";
import { CHANNEL_PEER_LIMIT } from "../types";
import type { Role } from "@/features/workspaces/types";
import { mapChannelRow, type ChannelMemberRow, type ChannelRow } from "./dto";
import type { ChannelContext } from "./service-shared";
import { loadVisibleChannel, mayReadPublicChannels } from "./service-shared";
import * as repo from "./repository";
import * as repoMessages from "./repository-messages";
import * as collab from "./repository-collab";
import * as extras from "./repository-list-extras";
import { ACCOUNT_CHANNEL_LIMIT } from "./repository-account";
import { listMentionStamps } from "./repository-mentions";
import {
  mentionCutoff,
  mentionScanFloor,
  tallyMentions,
} from "./mention-tally";

/**
 * 🔒 **THE ONE CHANNEL-LIST PROJECTION — `GET /api/channels` at BOTH SCOPES**
 * (Samuel's ruling R-26 (b), 2026-09-17: *one endpoint*). *"Which channels am I
 * in, and what is their state"* was answered by THREE types off THREE routes into
 * THREE client caches; this file is the one answer, and `types-list.ts` is its row.
 *
 * ── WHAT DIFFERS PER SCOPE IS THE FENCE, AND ONLY THE FENCE ────────────────
 *
 * - **`container`** — membership of the named container is already proved by
 *   `withWorkspaceAuth`. The visible set is `repository.ts › listChannels`: the
 *   caller's own private rooms plus the PUBLIC ones at `viewer`+ (a guest gets no
 *   public arm).
 * - **`account`** — the fence is `channel_members.user_id = <caller>`, through
 *   `repository-account.ts › listMyChannelMemberships`. **MEMBERSHIP, not
 *   visibility**: a public channel the caller never joined is not here.
 *
 * ⚠ **THE HYDRATION BELOW IS SHARED BY BOTH.** A field computed in one branch and
 * not the other is the fork R-26 removed; a future scope that needs one the others
 * do not is a new argument, not a new branch here.
 *
 * ⚠ **BOUNDED FANS, NEVER A PER-ROW QUERY** (§9). Two tiers — the ids-and-rows
 * tier, then the tier that needs those ids — and every read is one `.in()`.
 */

/**
 * Mention stamps one list read will scan.
 *
 * ⚠ **A NON-REPORTING CEILING**, on the terms §9 sanctions for a badge: the scan
 * is already floored at the OLDEST watermark on the page, so reaching this means
 * the caller has that many unread mentions across the page, and the badge then
 * UNDER-counts rather than claiming there is nothing.
 */
export const CHANNEL_MENTION_SCAN_LIMIT = 500;

/**
 * Roster rows one list read will pull. ⚠ The per-channel cap is
 * `CHANNEL_PEER_LIMIT`; this is the ceiling over the whole page, so a page of
 * large channels clips the LAST channels' faces rather than the query.
 */
const PEER_ROW_LIMIT = 2_000;

/** Bound links one list read will pull — at most one per container by unique
 *  index, so this is a safety ceiling rather than a page. */
const LINK_ROW_LIMIT = 500;

// ⚠ **THE ACCOUNT CEILING IS `repository-account.ts › ACCOUNT_CHANNEL_LIMIT`,
// IMPORTED RATHER THAN RESTATED** — the same bound over the same fence, and this
// read disagreeing with `GET /api/channels/account/status` about how many rooms an
// account has is the drift one projection exists to remove. ⚠ **A REPORTED
// ceiling**: the answer carries `truncated` (§9, P35).

/** Everything a row needs that is not on its own `channels` row. */
interface ListExtras {
  counts: Map<string, number>;
  lasts: Map<string, string>;
  online: Map<string, number>;
  directPeers: Map<string, ChannelDirectPeer>;
  containers: Map<string, ChannelContainer>;
  roles: Map<string, Role>;
  peers: Map<string, ChannelPeer[]>;
  mentions: Map<string, number>;
  links: Map<string, ChannelPendingLink>;
}

function toDto(
  row: ChannelRow,
  membership: ChannelMemberRow | null,
  e: ListExtras
): Channel {
  // ⚠ A row whose container did not come back still renders, addressed by id with
  // no segment: dropping it would hide a channel because a JOIN was torn, and the
  // kind falls to `standard` through the same default absent `kind` takes (§4A).
  const container = e.containers.get(row.workspace_id) ?? {
    id: row.workspace_id,
    kind: "standard" as const,
    segment: "",
  };
  return mapChannelRow(row, {
    memberCount: e.counts.get(row.id) ?? 0,
    lastMessageAt: e.lasts.get(row.id) ?? null,
    role: (membership?.role as Channel["role"]) ?? null,
    lastReadAt: membership?.last_read_at ?? null,
    notifyScope: (membership?.notify_scope as Channel["myNotifyScope"]) ?? null,
    agentToolProfile:
      (membership?.agent_tool_profile as Channel["myAgentToolProfile"]) ?? null,
    // Off the caller's own membership row, already loaded for `role` and the
    // watermark — the Favorites section adds no read.
    favoritedAt: membership?.favorited_at ?? null,
    onlineMemberCount: e.online.get(row.id) ?? 0,
    directPeer: e.directPeers.get(row.id) ?? null,
    container,
    workspaceRole: e.roles.get(row.workspace_id) ?? null,
    peers: e.peers.get(row.id) ?? [],
    mentionCount: e.mentions.get(row.id) ?? 0,
    linkOut: e.links.get(row.workspace_id) ?? null,
  });
}

/**
 * Resolve the rendered peer for every DIRECT channel, hydrated from the roster.
 * ⚠ Resolved LIVE, never stored as truth.
 */
/** The other party in every DM on the page — identity, so never sampled. */
function directPeerIds(
  rows: ChannelRow[],
  memberIds: Map<string, string[]>,
  selfId: string
): string[] {
  const out: string[] = [];
  for (const row of rows) {
    if (!row.is_direct) continue;
    const ids = memberIds.get(row.id) ?? [];
    const peerId = ids.find((id) => id !== selfId) ?? ids[0];
    if (peerId) out.push(peerId);
  }
  return out;
}

function buildDirectPeers(
  rows: ChannelRow[],
  memberIds: Map<string, string[]>,
  selfId: string,
  profiles: Map<string, { displayName: string | null; avatarUrl: string | null }>
): Map<string, ChannelDirectPeer> {
  const out = new Map<string, ChannelDirectPeer>();
  for (const row of rows) {
    if (!row.is_direct) continue;
    const ids = memberIds.get(row.id) ?? [];
    const peerId = ids.find((id) => id !== selfId) ?? ids[0];
    if (!peerId) continue;
    const p = profiles.get(peerId);
    out.set(row.id, {
      userId: peerId,
      displayName: p?.displayName ?? null,
      avatarUrl: p?.avatarUrl ?? null,
    });
  }
  return out;
}

/** Per-channel online-member counts from the presence map. */
function onlineCounts(
  memberIds: Map<string, string[]>,
  presence: Map<string, { online: boolean }>
): Map<string, number> {
  const out = new Map<string, number>();
  for (const [channelId, userIds] of memberIds) {
    let n = 0;
    for (const userId of userIds) if (presence.get(userId)?.online) n += 1;
    out.set(channelId, n);
  }
  return out;
}

/**
 * THE SHARED SECOND TIER — given the rows a fence admitted and the caller's own
 * membership rows, produce every extra field.
 *
 * ⚠ `presence` is handed IN because the two scopes source it differently: a
 * container read has one workspace to ask about, an account read has N.
 */
async function hydrate(
  rows: ChannelRow[],
  memberships: Map<string, ChannelMemberRow>,
  viewerId: string,
  presence: Map<string, { online: boolean }>
): Promise<ListExtras> {
  const ids = rows.map((r) => r.id);
  const workspaceIds = [...new Set(rows.map((r) => r.workspace_id))];
  // ⚠ THE CUTOFFS ARE BUILT BEFORE THE SCAN because the scan's floor is their
  // MINIMUM. A channel the caller is not a member of gets NO cutoff and therefore
  // no badge — `Channel.unread`'s `isMember` clause, in this shape.
  const cutoffs = new Map<string, string>();
  for (const row of rows) {
    const mine = memberships.get(row.id);
    if (mine === undefined) continue;
    cutoffs.set(row.id, mentionCutoff(mine.last_read_at, row.created_at));
  }
  const [counts, lasts, memberIds, containers, roles, peerIds, links, stamps] =
    await Promise.all([
      repo.memberCounts(ids),
      repoMessages.lastMessages(ids),
      collab.channelMemberUserIds(ids),
      extras.listContainers(workspaceIds),
      extras.listMyContainerRoles(workspaceIds, viewerId),
      extras.listChannelPeerIds(ids, viewerId, CHANNEL_PEER_LIMIT, PEER_ROW_LIMIT),
      extras.listLinksByWorkspaces(workspaceIds, LINK_ROW_LIMIT),
      listMentionStamps(
        [...cutoffs.keys()],
        viewerId,
        mentionScanFloor([...cutoffs.values()]),
        CHANNEL_MENTION_SCAN_LIMIT
      ),
    ]);
  // ONE profile read for the page: the roster samples and the direct peers share
  // it, so faces cost no second query.
  // ⚠ **THE DIRECT PEERS ARE UNIONED IN EXPLICITLY, NOT INHERITED FROM THE ROSTER
  // SAMPLE.** `listChannelPeerIds` clips at `PEER_ROW_LIMIT` across the WHOLE page,
  // so in a container with more than that many memberships a DM's peer can fall
  // out of the sample — and a peer with no profile row reads as `displayName:
  // null`, which `channel-display.ts` then resolves through the OPEN channel's
  // roster, labelling the DM with a different person's name. A DM's peer is
  // identity, never a sample.
  const profiles = await listProfileSummaries([
    ...new Set([
      ...[...peerIds.values()].flat(),
      ...directPeerIds(rows, memberIds, viewerId),
    ]),
  ]);
  const peers = new Map<string, ChannelPeer[]>();
  for (const [channelId, userIds] of peerIds) {
    peers.set(
      channelId,
      // ⚠ A MEMBER WITH NO PROFILE ROW IS KEPT, NOT DROPPED — a face the operator
      // cannot name is still a person in the room, and dropping them would
      // silently shrink the roster the row claims to show.
      userIds.map((userId) => {
        const p = profiles.get(userId);
        return {
          userId,
          displayName: p?.displayName ?? null,
          email: p?.email ?? null,
          avatarUrl: p?.avatarUrl ?? null,
        };
      })
    );
  }
  return {
    counts,
    lasts,
    online: onlineCounts(memberIds, presence),
    directPeers: buildDirectPeers(rows, memberIds, viewerId, profiles),
    containers: mapContainers(containers),
    roles,
    peers,
    mentions: tallyMentions(stamps, cutoffs),
    links: mapLinks(links),
  };
}

/** `workspaces` rows → the typed address on every channel row (R-32). */
function mapContainers(
  rows: Map<string, extras.ContainerRow>
): Map<string, ChannelContainer> {
  const out = new Map<string, ChannelContainer>();
  for (const [id, row] of rows) {
    out.set(id, {
      id,
      // ⚠ ABSENT READS AS `standard` — §4A's default, which outlives the column's
      // apply because a narrowed projection or an older row carries none.
      kind: row.kind ?? "standard",
      segment: workspaceSegment({ slug: row.slug, publicId: row.public_id }),
    });
  }
  return out;
}

/** Open BOUND links → the row's chip. ⚠ Claimability is judged by the SAME
 *  predicate the claim gate uses, or a chip says "invite out" over a link that
 *  410s. */
function mapLinks(
  rows: Map<string, ChannelLinkRow>
): Map<string, ChannelPendingLink> {
  const out = new Map<string, ChannelPendingLink>();
  for (const [workspaceId, row] of rows) {
    if (isClaimable(row)) out.set(workspaceId, mapLinkRow(row));
  }
  return out;
}

/**
 * `scope=container` — every channel the caller may see in ONE container.
 *
 * ⚠ **A GUEST GETS NO PUBLIC ARM** (2026-08-26), the list half of the fence
 * `loadVisibleChannel` applies to a single ref.
 */
export async function listChannels(ctx: ChannelContext): Promise<Channel[]> {
  const myMemberships = await repo.listMyMemberships(ctx.workspaceId, ctx.userId);
  const memberships = new Map(myMemberships.map((m) => [m.channel_id, m]));
  const rows = await repo.listChannels(ctx.workspaceId, {
    memberChannelIds: [...memberships.keys()],
    includePublic: mayReadPublicChannels(ctx),
  });
  const presence = await collab.presenceForWorkspace(ctx.workspaceId);
  const e = await hydrate(rows, memberships, ctx.userId, presence);
  return rows.map((row) => toDto(row, memberships.get(row.id) ?? null, e));
}

/**
 * `scope=account` — every channel the caller is a MEMBER of, across every
 * container of every kind, in one read.
 *
 * ⚠ **THE FENCE IS THE USER**: every read enters through the caller's own
 * `channel_members` rows, so a channel they do not belong to is never NAMED by any
 * query here.
 *
 * ⚠ **A ROW CARRIES ITS OWN CONTAINER KIND** (`Channel.container.kind`), which is
 * how a host that wants only home channels narrows — POSITIVELY. Filtering HERE
 * would rebuild `/api/home/channels` inside the one route.
 *
 * ⚠ **`truncated` IS REPORTED** (§9, P35), where the deleted /home read carried
 * three silent ceilings. The MENTION scan stays non-reporting: a badge that
 * under-counts is a nudge, not a claim about the list.
 */
export async function listAccountChannels(
  userId: string,
  lockedWorkspaceId: string | null
): Promise<{ channels: Channel[]; truncated: boolean }> {
  const { rows, truncated } = await extras.listAccountChannelRows(
    userId,
    lockedWorkspaceId,
    ACCOUNT_CHANNEL_LIMIT
  );
  if (rows.length === 0) return { channels: [], truncated };
  const memberships = await extras.listMyMembershipsByChannel(
    rows.map((r) => r.id),
    userId
  );
  const presence = await collab.presenceForWorkspaces([
    ...new Set(rows.map((r) => r.workspace_id)),
  ]);
  const e = await hydrate(rows, memberships, userId, presence);
  return {
    channels: rows.map((row) => toDto(row, memberships.get(row.id) ?? null, e)),
    truncated,
  };
}

/**
 * ONE channel, hydrated through the SAME projection — what every WRITE path
 * answers with, so a row from a mutation echo and a row from the list are the same
 * shape. ⚠ It is the only reason a write needs no second DTO.
 */
export async function hydrateOneChannel(
  row: ChannelRow,
  membership: ChannelMemberRow | null,
  viewerId: string
): Promise<Channel> {
  const memberships = new Map(membership ? [[row.id, membership]] : []);
  const presence = await collab.presenceForWorkspaces([row.workspace_id]);
  const e = await hydrate([row], memberships, viewerId, presence);
  return toDto(row, membership, e);
}

/**
 * Single channel header + the caller's viewer state (Track B `open`) — the same
 * projection one row at a time, behind the SAME visibility gate the list uses.
 */
export async function getChannel(
  ctx: ChannelContext,
  ref: string
): Promise<Channel> {
  const { channel, membership } = await loadVisibleChannel(ctx, ref);
  return hydrateOneChannel(channel, membership, ctx.userId);
}

/**
 * ONE channel by id inside a known container, hydrated through the SAME
 * projection — what the HOME write paths answer with (create, and both claim
 * branches), so a channel handed back by a mint and one read off the list are the
 * same shape.
 *
 * ⚠ **NO VISIBILITY GATE HERE, DELIBERATELY.** Every caller has just proved
 * membership by WRITING (`createHomeChannel` minted the container, `claimBoundLink`
 * inserted the member row). Adding `loadVisibleChannel` would re-read a fact the
 * transaction above it established — and would answer NOT-FOUND on the one path
 * where a replica lag makes the membership row arrive late.
 *
 * ⚠ `null` when the container has no channel. The CALLER decides what that means:
 * the home write paths call it a 500, because a container with no channel is the
 * state their rollbacks exist to prevent producing.
 */
export async function hydrateChannelById(
  workspaceId: string,
  channelId: string,
  viewerId: string
): Promise<Channel | null> {
  const [row, membership] = await Promise.all([
    repo.findChannelById(workspaceId, channelId),
    repo.findMembership(channelId, viewerId),
  ]);
  if (!row) return null;
  return hydrateOneChannel(row, membership, viewerId);
}
