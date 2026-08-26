import "server-only";
import { HttpError } from "@/shared/lib/http-error";
import { truncatePreview } from "@/shared/lib/preview";
import { listProfileSummaries } from "@/features/workspaces/server/repository";
import { workspaceSegment } from "@/features/workspaces/url";
import type {
  HomeChannel,
  HomeChannelsPayload,
  HomeLinkPublicInfo,
  HomePendingLink,
} from "../types";
import { isClaimable, linkState, mapLinkRow, type LinkContainerRow } from "./dto";
import * as repo from "./repository";

/**
 * Read side of home channels: the channels page, the caller's own legacy
 * pending links, and the pre-auth claim-page lookup.
 *
 * ⚠ NOTHING HERE IS WORKSPACE-SCOPED, so there is no `withWorkspaceAuth` above
 * it and no membership resolution behind it. The fence is the USER: every read
 * enters through `workspace_members.user_id = caller`, and the container it
 * lands on is by construction one the caller belongs to.
 */

/** Containers a page will render. A ceiling, not a page — home channels are an
 *  account's own conversations, not a feed. */
export const HOME_CHANNEL_LIMIT = 200;
/** Pending links a page will render. */
export const HOME_LINK_LIMIT = 50;

/**
 * Containers → channels.
 *
 * ⚠ A CONTAINER MISSING ITS CHANNEL IS STILL DROPPED. `HomeChannel` promises
 * something to open, and a card that opens nothing is worse than an absent one —
 * that is what the claim path's workspace-rollback exists to prevent producing.
 *
 * ⚠ A CONTAINER MISSING ITS PEER IS NOT (2026-08-24, the inversion). A solo
 * channel is the NORMAL first state of every home channel now: the operator
 * makes one, works in it with their agents, and a person arrives later or never.
 * `peer: null` is the answer, not a reason to hide the row.
 *
 * ONE FAN, not two: the open bound link joins the peers+channels tier, so the
 * chip costs no extra round trip (§9's home bullet).
 */
export async function hydrateChannels(
  containers: LinkContainerRow[],
  viewerId: string
): Promise<HomeChannel[]> {
  if (containers.length === 0) return [];
  const ids = containers.map((c) => c.id);
  const [peers, channels, links] = await Promise.all([
    repo.listContainerPeers(ids, viewerId),
    repo.listContainerChannels(ids),
    repo.listLinksByWorkspaces(ids, HOME_CHANNEL_LIMIT),
  ]);
  const [profiles, lastMessages] = await Promise.all([
    listProfileSummaries([...new Set(peers.values())]),
    repo.listLastMessages([...channels.values()].map((c) => c.id)),
  ]);

  const out: HomeChannel[] = [];
  for (const container of containers) {
    const channel = channels.get(container.id);
    if (!channel) continue;
    const peerId = peers.get(container.id);
    const profile = peerId ? profiles.get(peerId) : undefined;
    const last = lastMessages.get(channel.id);
    const link = links.get(container.id);
    out.push({
      workspaceId: container.id,
      workspaceSegment: workspaceSegment({
        slug: container.slug,
        publicId: container.public_id,
      }),
      channelId: channel.id,
      name: channel.name,
      peer: peerId
        ? {
            userId: peerId,
            displayName: profile?.displayName ?? null,
            email: profile?.email ?? null,
            avatarUrl: profile?.avatarUrl ?? null,
          }
        : null,
      createdAt: container.created_at,
      lastMessageAt: last?.at ?? null,
      lastMessagePreview: last ? truncatePreview(last.body) : null,
      // ⚠ Claimability is judged by the SAME predicate the claim gate uses — a
      // chip that says "invite out" over a link that 410s is the disagreement
      // `isClaimable` exists to prevent.
      linkOut: link && isClaimable(link) ? mapLinkRow(link) : null,
    });
  }
  return out;
}

/**
 * ONE container, hydrated — what every WRITE path returns after it has changed
 * something.
 *
 * ⚠ SHARED BY BOTH CLAIM BRANCHES AND BY CREATE, deliberately: it was a private
 * `one()` in `service-writes.ts` until the bound claim needed the same three
 * lines (2026-08-25), and copying it into `service-claim-bound.ts` would have
 * put the "a container with no channel is a 500, not an empty render" decision
 * in two files. `hydrateChannels` is the only thing that can drop a row, so the
 * error belongs beside it.
 */
export async function hydrateOneChannel(
  container: LinkContainerRow,
  viewerId: string
): Promise<HomeChannel> {
  const [channel] = await hydrateChannels([container], viewerId);
  if (!channel) {
    throw new HttpError(500, "CHANNEL_INCOMPLETE", "This container has no channel");
  }
  return channel;
}

/**
 * The caller's still-usable LEGACY UNBOUND links.
 *
 * ⚠ BOUND LINKS ARE NOT HERE — the repository filters `workspace_id IS NULL` in
 * the query, so a bound invitation appears exactly once, as its channel's
 * `linkOut`. Revoked rows are filtered in the query too; expired and exhausted
 * ones by the same predicate the claim gate uses.
 */
export async function listMyPendingLinks(
  userId: string
): Promise<HomePendingLink[]> {
  const rows = await repo.listLinksByCreator(userId, HOME_LINK_LIMIT);
  return rows.filter((row) => isClaimable(row)).map(mapLinkRow);
}

/** The whole home page in one round trip. */
export async function getHomeChannels(
  userId: string
): Promise<HomeChannelsPayload> {
  const [containers, pendingLinks] = await Promise.all([
    repo.listLinkContainers(userId, HOME_CHANNEL_LIMIT),
    listMyPendingLinks(userId),
  ]);
  return {
    channels: await hydrateChannels(containers, userId),
    pendingLinks,
  };
}

/**
 * What the claim page may show BEFORE the visitor signs in.
 *
 * ⚠ A DISPLAY NAME AND THREE BOOLEANS, and the omissions are the contract: no
 * email (an unauthenticated URL holder would harvest one per token), no user
 * id, and no fall-back from a null display name TO the email — a nameless
 * creator renders as nameless. Unknown token 404s so the endpoint is not an
 * oracle for which tokens exist.
 *
 * ⚠ IT DID NOT GROW A CHANNEL NAME WHEN LINKS BECAME BOUND (2026-08-24). A
 * bound token names a private channel, and the holder of the URL has no account
 * yet — "you are being invited to #q3-fundraise" is a leak, not a nicety.
 */
export async function getLinkPublicInfo(
  token: string
): Promise<HomeLinkPublicInfo> {
  const link = await repo.findLinkByToken(token);
  if (!link) {
    throw new HttpError(404, "LINK_NOT_FOUND", "This link is not valid");
  }
  const profiles = await listProfileSummaries([link.creator_user_id]);
  return {
    creatorDisplayName: profiles.get(link.creator_user_id)?.displayName ?? null,
    ...linkState(link),
  };
}
