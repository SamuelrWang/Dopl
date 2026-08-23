import "server-only";
import { randomBytes } from "crypto";
import { HttpError } from "@/shared/lib/http-error";
import {
  buildChannelContext,
  createChannel,
} from "@/features/channels/server/service";
import {
  deleteWorkspace,
  listProfileSummaries,
  type ProfileSummary,
} from "@/features/workspaces/server/repository";
import { slugifyWorkspaceName } from "@/features/workspaces/slug";
import type {
  HomeLinkClaimResult,
  HomeLinkMintResult,
  HomeRelationship,
} from "../types";
import { isClaimable, mapLinkRow, type LinkContainerRow } from "./dto";
import * as repo from "./repository";
import type { HomeLinkMintInput } from "../schema";
import { hydrateRelationships } from "./service-reads";

/**
 * Write side of home channels: mint, revoke, claim.
 *
 * THE CLAIM IS THE WHOLE FEATURE, and it is five steps in a fixed order:
 * validate → dedup the pair → spend one use → mint the container → record the
 * claim. Reordering any of them is a bug (see `claimLink`).
 */

/**
 * ⚠ base64url, CASE-SENSITIVE, like `workspace_invitations.token` and NOT like
 * `workspace_join_links` (lowercase hex, normalized on lookup). A home link is
 * shared as a whole URL and clicked; the hex form exists for tokens that get
 * RETYPED through apps that case-fold, which this one is not. 32 bytes → 43
 * chars.
 */
function generateToken(): string {
  return randomBytes(32).toString("base64url");
}

export async function mintLink(
  userId: string,
  input: HomeLinkMintInput
): Promise<HomeLinkMintResult> {
  const row = await repo.insertLink({
    creatorUserId: userId,
    token: generateToken(),
    label: input.label ?? null,
    expiresAt: input.expiresAt ?? null,
    // ⚠ NOT `?? null`: the schema already resolved absent → 1, and re-defaulting
    // here would turn an explicit multi-use `null` back into… itself, while
    // hiding where the real default lives.
    maxUses: input.maxUses,
  });
  return { link: mapLinkRow(row) };
}

/**
 * Soft-revoke. Creator only, and 404 for anybody else's link so the endpoint
 * cannot confirm a link id. Idempotent: an already-revoked link is not an error
 * — the caller asked for it to be dead and it is.
 */
export async function revokeLink(
  userId: string,
  linkId: string
): Promise<void> {
  if (await repo.markLinkRevoked(linkId, userId)) return;
  const existing = await repo.findLinkById(linkId, userId);
  if (!existing) {
    throw new HttpError(404, "LINK_NOT_FOUND", "This link is not valid");
  }
}

/** Display name for the container's name. Email local part is the fallback,
 *  because a workspace called "&" tells nobody anything. */
function shortName(profile: ProfileSummary | undefined): string {
  return profile?.displayName || profile?.email?.split("@")[0] || "Member";
}

/**
 * Claim a link: the pair get a hidden container workspace holding one direct
 * channel, and address it thereafter like any other workspace.
 *
 * ⚠ THE ORDER IS THE CORRECTNESS ARGUMENT.
 *  1. Validate. Unknown token 404 (never an oracle), dead link 410, own link
 *     400 — a self-claim would ask `createDirectChannel` for a self-DM.
 *  2. Dedup the PAIR before spending anything. A second open of the same link
 *     between the same two people is a no-op that returns the existing
 *     relationship, and it must not burn a use to do it.
 *  3. Spend one use ATOMICALLY (`consumeLinkUse`). This is the only thing
 *     standing between a single-use link and two claimers, so it happens before
 *     any row is created and its `false` is a 410, not a retry — after ONE
 *     re-check of the pair, which is the same account racing itself.
 *  4. Mint the container + the direct channel.
 *     ⚠ ACCEPTED WINDOW: the use is spent before the container exists, so a
 *     failure here burns one. Step 4 rolls its own workspace back, which
 *     narrows the window to a rollback that itself failed — and a burned use on
 *     a multi-use link is a smaller harm than a container nobody can see.
 *  5. Record the claim. Its unique `(link_id, claimed_by)` is what makes a
 *     concurrent double-claim by ONE account converge instead of minting two
 *     containers — the loser drops the container it just made and re-reads the
 *     winner's.
 */
export async function claimLink(
  token: string,
  userId: string
): Promise<HomeLinkClaimResult> {
  const link = await repo.findLinkByToken(token);
  if (!link) {
    throw new HttpError(404, "LINK_NOT_FOUND", "This link is not valid");
  }
  if (!isClaimable(link)) {
    throw new HttpError(410, "LINK_UNAVAILABLE", "This link is no longer available");
  }
  const creatorId = link.creator_user_id;
  if (creatorId === userId) {
    throw new HttpError(400, "LINK_SELF_CLAIM", "You cannot claim your own link");
  }

  const existing = await repo.findPairContainer(creatorId, userId);
  if (existing) {
    return { relationship: await one(existing, userId), existing: true };
  }

  if (!(await repo.consumeLinkUse(link.id))) {
    // ⚠ ONE re-read, and NOT of the link row (`consumeLinkUse` forbids that) —
    // of the PAIR. Two tabs of the SAME account opening a single-use link race
    // past the dedup above together; one wins the use and the other reads
    // exhausted. The loser is looking at a relationship that now exists, so
    // answering 410 would 410 the claimer on their own successful claim.
    const winner = await repo.findPairContainer(creatorId, userId);
    if (winner) return { relationship: await one(winner, userId), existing: true };
    throw new HttpError(410, "LINK_UNAVAILABLE", "This link is no longer available");
  }

  const container = await createContainer(creatorId, userId);
  const claimed = await repo.insertClaim({
    linkId: link.id,
    claimedBy: userId,
    workspaceId: container.id,
  });
  if (!claimed) {
    await deleteWorkspace(container.id);
    const winner = await repo.findPairContainer(creatorId, userId);
    if (!winner) throw new HttpError(409, "LINK_CLAIM_RACE", "Try again");
    return { relationship: await one(winner, userId), existing: true };
  }
  return { relationship: await one(container, userId), existing: false };
}

/** The container plus its one direct channel. */
async function createContainer(
  creatorId: string,
  claimerId: string
): Promise<LinkContainerRow> {
  const profiles = await listProfileSummaries([creatorId, claimerId]);
  const name = `${shortName(profiles.get(creatorId))} & ${shortName(profiles.get(claimerId))}`;
  const container = await repo.insertLinkContainer({
    creatorUserId: creatorId,
    claimerUserId: claimerId,
    name,
    slug: slugifyWorkspaceName(name),
  });

  // ⚠ THE CHANNELS SERVICE, not a second copy of it: `direct_key` dedup,
  // membership-of-2 and the self-target refusal all live in
  // `createDirectChannel` and must not be mirrored here. The context is built
  // for the CREATOR — they own the container, so they own its channel.
  try {
    await createChannel(
      buildChannelContext({
        userId: creatorId,
        workspaceId: container.id,
        role: "owner",
      }),
      { direct: true, memberUserId: claimerId }
    );
  } catch (err) {
    // ⚠ Roll the container back, exactly as the `insertClaim` loser does. A
    // container with no direct channel is a BRICK: `hydrateRelationships` drops
    // it, so neither side ever sees it, and `findPairContainer` still finds it —
    // which would dedup every future claim between this pair onto a relationship
    // that can never render.
    await deleteWorkspace(container.id);
    throw err;
  }
  return container;
}

async function one(
  container: LinkContainerRow,
  viewerId: string
): Promise<HomeRelationship> {
  const [relationship] = await hydrateRelationships([container], viewerId);
  if (!relationship) {
    throw new HttpError(500, "RELATIONSHIP_INCOMPLETE", "Relationship is missing its channel");
  }
  return relationship;
}
