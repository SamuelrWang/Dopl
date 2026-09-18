import "server-only";
import { HttpError } from "@/shared/lib/http-error";
import { listProfileSummaries } from "@/features/workspaces/server/repository";
import type { Channel, ChannelPendingLink } from "@/features/channels/types";
import { hydrateChannelById } from "@/features/channels/server/service";
import type { HomeLinkPublicInfo } from "../types";
import { isClaimable, linkState, mapLinkRow, type LinkContainerRow } from "./dto";
import * as repo from "./repository";

/**
 * Read side of the home surface: the caller's own LEGACY unbound links, the
 * pre-auth claim-page lookup, and ONE container hydrated for a write echo.
 *
 * 🔒 **THE CHANNEL LIST LEFT THIS FILE IN WAVE 3 (R-26 (b)).** There is one
 * projection now — `channels/server/service-list.ts`, read at `?scope=account`.
 * **Do not re-derive a home-shaped channel row here.**
 *
 * ⚠ NOTHING HERE IS WORKSPACE-SCOPED, so there is no `withWorkspaceAuth` above it.
 * The fence is the USER: every read enters through a row keyed on the caller.
 */

/** Pending links a page will render. ⚠ A NON-REPORTING ceiling on §9's sanctioned
 *  terms for this family — links are an account's own invitations, not a feed. */
export const HOME_LINK_LIMIT = 50;

/**
 * ONE container, hydrated through the CHANNELS projection — what every home WRITE
 * path returns after it has changed something (create, and both claim branches).
 *
 * 🔒 **IT RETURNS `Channel`, THE ONE ROW TYPE**, so a write echo and a list row are
 * the same shape. ⚠ **A CONTAINER WITH NO CHANNEL IS A 500, NOT AN EMPTY RENDER** —
 * the state the create/claim rollbacks exist to prevent producing, and the decision
 * lives here rather than in each write.
 */
export async function hydrateOneChannel(
  container: LinkContainerRow,
  viewerId: string
): Promise<Channel> {
  const channels = await repo.listContainerChannels([container.id]);
  const inside = channels.get(container.id);
  const channel = inside
    ? await hydrateChannelById(container.id, inside.id, viewerId)
    : null;
  if (!channel) {
    throw new HttpError(500, "CHANNEL_INCOMPLETE", "This container has no channel");
  }
  return channel;
}

/**
 * ONE home channel, for a host that already knows WHICH container it wants — the
 * guest web route `/c/{workspaceId}` (`docs/specs/guest-web-channel.md`).
 *
 * ⚠ IT IS THE FENCE PLUS THE HYDRATION AND NOTHING ELSE. The authz is
 * `findMemberContainer`'s: active membership of a `kind='link'` container, ABSENT
 * rather than forbidden, and it refuses a STANDARD workspace the caller genuinely
 * belongs to. So `null` means three different things on purpose — not a container,
 * not a member, not a link container — and the page answers all three with
 * `notFound()`. Any branch that told them apart would make the URL an existence
 * oracle for container ids.
 *
 * ⚠ NOT A FILTER OVER THE ACCOUNT LIST, which is capped: scanning its page for one
 * id would 404 a channel the caller really has once they hold more than the cap.
 */
export async function getHomeChannel(
  userId: string,
  workspaceId: string
): Promise<Channel | null> {
  const container = await repo.findMemberContainer(workspaceId, userId);
  if (!container) return null;
  return hydrateOneChannel(container, userId);
}

/**
 * The caller's still-usable LEGACY UNBOUND links.
 *
 * ⚠ BOUND LINKS ARE NOT HERE — the repository filters `workspace_id IS NULL` in the
 * query, so a bound invitation appears exactly once, as its channel's `linkOut`.
 * Revoked rows are filtered in the query too; expired and exhausted ones by the
 * same predicate the claim gate uses.
 */
export async function listMyPendingLinks(
  userId: string
): Promise<ChannelPendingLink[]> {
  const rows = await repo.listLinksByCreator(userId, HOME_LINK_LIMIT);
  return rows.filter((row) => isClaimable(row)).map(mapLinkRow);
}

/**
 * What the claim page may show BEFORE the visitor signs in.
 *
 * ⚠ A DISPLAY NAME AND THREE BOOLEANS, and the omissions are the contract: no email
 * (an unauthenticated URL holder would harvest one per token), no user id, and no
 * fall-back from a null display name TO the email. Unknown token 404s so the
 * endpoint is not an oracle for which tokens exist.
 *
 * ⚠ IT DID NOT GROW A CHANNEL NAME WHEN LINKS BECAME BOUND (2026-08-24). A bound
 * token names a private channel and the holder of the URL has no account yet —
 * "you are being invited to #q3-fundraise" is a leak, not a nicety.
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
