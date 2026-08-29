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
 * An EMPTY `peers` is the answer, not a reason to hide the row.
 *
 * ✅ **`peers` IS A LIST AND `peer` IS ITS HEAD — F-307 closed here (2026-08-26).
 * THIS IS THE ONE PLACE THE TWO ARE RELATED**, and that is the whole point of
 * deriving rather than reading twice: a second site computing `peer` from
 * anything other than `peers[0]` re-opens the finding in a form no test would
 * catch. The repository hands the list back in a TOTAL order (`joined_at ASC,
 * user_id ASC`), so `peer` means "the member who joined first" rather than
 * "whichever row came back first".
 *
 * ONE FAN, not two: the open bound link joins the peers+channels tier, so the
 * chip costs no extra round trip (§9's home bullet). ⚠ **The profile tier now
 * widens with the ROSTERS** — a container contributes one id per member instead
 * of at most one — and it is still ONE `.in()` over the de-duplicated set, so
 * the shape §9 forbids (a query per row) is unchanged.
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
    listProfileSummaries([...new Set([...peers.values()].flat())]),
    repo.listLastMessages([...channels.values()].map((c) => c.id)),
  ]);

  const out: HomeChannel[] = [];
  for (const container of containers) {
    const channel = channels.get(container.id);
    if (!channel) continue;
    // ⚠ A MEMBER WITH NO PROFILE ROW IS KEPT, NOT DROPPED. `listProfileSummaries`
    // answers only for ids it finds, and a face the operator cannot name is
    // still a person in the room — dropping them would under-count the stack and
    // silently shrink the roster the row claims to show.
    const roster = (peers.get(container.id) ?? []).map((userId) => {
      const profile = profiles.get(userId);
      return {
        userId,
        displayName: profile?.displayName ?? null,
        email: profile?.email ?? null,
        avatarUrl: profile?.avatarUrl ?? null,
      };
    });
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
      peers: roster,
      // ⚠ DERIVED, never a second read (see the docblock). Back-compat for a
      // cache written before `peers` existed, and now a STATED rule: the member
      // who joined first.
      peer: roster[0] ?? null,
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
 * ONE home channel, for a host that already knows WHICH container it wants —
 * the guest web route `/c/{workspaceId}` (spec: `docs/specs/guest-web-channel.md`).
 *
 * ⚠ IT IS THE FENCE PLUS THE HYDRATION, AND NOTHING ELSE. The authz is
 * `findMemberContainer`'s (repository-containers.ts): active membership of a
 * `kind='link'` container, ABSENT rather than forbidden, and it refuses a
 * STANDARD workspace the caller genuinely belongs to. So `null` here means
 * three different things on purpose — not a container, not a member, not a link
 * container — and the page answers all three with `notFound()`. Any branch that
 * told them apart would make the URL an existence oracle for container ids.
 *
 * ⚠ NOT A FILTER OVER `getHomeChannels`. That read is capped
 * (`HOME_CHANNEL_LIMIT`), so scanning its page for one id would 404 a channel
 * the caller really has once they hold more than the cap.
 *
 * ⚠ A CONTAINER WITH NO CHANNEL STILL THROWS 500 — `hydrateOneChannel` owns
 * that decision for every write path already, and a guest route is not the
 * place to invent a quieter answer for a half-built container.
 */
export async function getHomeChannel(
  userId: string,
  workspaceId: string
): Promise<HomeChannel | null> {
  const container = await repo.findMemberContainer(workspaceId, userId);
  if (!container) return null;
  return hydrateOneChannel(container, userId);
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
