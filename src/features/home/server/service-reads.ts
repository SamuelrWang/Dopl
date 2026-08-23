import "server-only";
import { HttpError } from "@/shared/lib/http-error";
import { truncatePreview } from "@/shared/lib/preview";
import { listProfileSummaries } from "@/features/workspaces/server/repository";
import { workspaceSegment } from "@/features/workspaces/url";
import type {
  HomeLinkPublicInfo,
  HomePendingLink,
  HomeRelationship,
  HomeRelationshipsPayload,
} from "../types";
import { isClaimable, linkState, mapLinkRow, type LinkContainerRow } from "./dto";
import * as repo from "./repository";

/**
 * Read side of home channels: the relationships page, the caller's own pending
 * links, and the pre-auth claim-page lookup.
 *
 * ⚠ NOTHING HERE IS WORKSPACE-SCOPED, so there is no `withWorkspaceAuth` above
 * it and no membership resolution behind it. The fence is the USER: every read
 * enters through `workspace_members.user_id = caller`, and the container it
 * lands on is by construction one the caller belongs to.
 */

/** Containers a page will render. A ceiling, not a page — relationships are an
 *  account's contacts, not a feed. */
export const HOME_RELATIONSHIP_LIMIT = 200;
/** Pending links a page will render. */
export const HOME_LINK_LIMIT = 50;

/**
 * Containers → relationships. ⚠ A container missing its peer or its direct
 * channel is DROPPED, not rendered half-built: `HomeRelationship` promises a
 * person and a channel to open, and a card that can do neither is worse than an
 * absent one.
 */
export async function hydrateRelationships(
  containers: LinkContainerRow[],
  viewerId: string
): Promise<HomeRelationship[]> {
  if (containers.length === 0) return [];
  const ids = containers.map((c) => c.id);
  const [peers, channels] = await Promise.all([
    repo.listContainerPeers(ids, viewerId),
    repo.listContainerDirectChannels(ids),
  ]);
  const [profiles, lastMessages] = await Promise.all([
    listProfileSummaries([...new Set(peers.values())]),
    repo.listLastMessages([...channels.values()]),
  ]);

  const out: HomeRelationship[] = [];
  for (const container of containers) {
    const peerId = peers.get(container.id);
    const channelId = channels.get(container.id);
    if (!peerId || !channelId) continue;
    const profile = profiles.get(peerId);
    const last = lastMessages.get(channelId);
    out.push({
      workspaceId: container.id,
      workspaceSegment: workspaceSegment({
        slug: container.slug,
        publicId: container.public_id,
      }),
      channelId,
      peer: {
        userId: peerId,
        displayName: profile?.displayName ?? null,
        email: profile?.email ?? null,
        avatarUrl: profile?.avatarUrl ?? null,
      },
      connectedAt: container.created_at,
      lastMessageAt: last?.at ?? null,
      lastMessagePreview: last ? truncatePreview(last.body) : null,
    });
  }
  return out;
}

/** The caller's still-usable links. Revoked rows are filtered in the query;
 *  expired and exhausted ones by the same predicate the claim gate uses. */
export async function listMyPendingLinks(
  userId: string
): Promise<HomePendingLink[]> {
  const rows = await repo.listLinksByCreator(userId, HOME_LINK_LIMIT);
  return rows.filter((row) => isClaimable(row)).map(mapLinkRow);
}

/** The whole home page in one round trip. */
export async function getHomeRelationships(
  userId: string
): Promise<HomeRelationshipsPayload> {
  const [containers, pendingLinks] = await Promise.all([
    repo.listLinkContainers(userId, HOME_RELATIONSHIP_LIMIT),
    listMyPendingLinks(userId),
  ]);
  return {
    relationships: await hydrateRelationships(containers, userId),
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
