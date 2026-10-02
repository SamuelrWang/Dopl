import "server-only";
import { randomBytes } from "crypto";
import { HttpError } from "@/shared/lib/http-error";
import {
  buildChannelContext,
  createChannel,
} from "@/features/channels/server/service";
import {
  deleteWorkspace,
  findMembership,
  listProfileSummaries,
  type ProfileSummary,
} from "@/features/workspaces/server/repository";
import { meetsMinRole, type Role } from "@/features/workspaces/types";
import { slugifyWorkspaceName } from "@/features/workspaces/slug";
import type {
  HomeChannelCreateResult,
  HomeLinkClaimResult,
  HomeLinkMintResult,
} from "../types";
import {
  isClaimable,
  mapLinkRow,
  type ChannelLinkRow,
  type LinkContainerRow,
} from "./dto";
import * as repo from "./repository";
import type { HomeChannelCreateInput, HomeLinkMintInput } from "../schema";
import { claimBoundLink } from "./service-claim-bound";
import { hydrateOneChannel } from "./service-reads";

/**
 * Write side of home channels: create, mint the add-a-person link, revoke, claim.
 *
 * ⚠ Creating a channel and gaining a peer are separate acts (2026-08-24):
 * `createHomeChannel` mints a SOLO container; `mintContainerLink` binds an
 * invitation to an existing one. `claimLink` judges the token then dispatches on
 * `link.workspace_id` — unbound branch here, bound in `service-claim-bound.ts`.
 */

/**
 * ⚠ base64url, CASE-SENSITIVE (like `workspace_invitations.token`, unlike
 * `workspace_join_links`' hex). A home link is clicked as a whole URL, never
 * retyped through case-folding apps. 32 bytes → 43 chars.
 */
function generateToken(): string {
  return randomBytes(32).toString("base64url");
}

/** 23505. Local on purpose — not worth a cross-feature import of a channels internal. */
function isUniqueViolation(err: unknown): boolean {
  return (err as { code?: string } | null)?.code === "23505";
}

/**
 * "New channel" — a container with ONE member and one private channel in it.
 *
 * ⚠ PRIVATE, NOT DIRECT: `direct: true` would be a refused self-DM bound to a
 * peer that doesn't exist yet. A home channel works solo; a person added later
 * JOINS it and inherits the transcript.
 *
 * ⚠ NOT `sessionOnly` — agent tokens may call it, like `POST /api/workspaces`
 * (Samuel's ruling, 2026-08-24). Only `mintContainerLink` reaches a human, and
 * that one is session-gated.
 */
export async function createHomeChannel(
  userId: string,
  input: HomeChannelCreateInput
): Promise<HomeChannelCreateResult> {
  const container = await repo.insertSoloContainer({
    ownerUserId: userId,
    name: input.name,
    slug: slugifyWorkspaceName(input.name),
  });

  // ⚠ Reuse the channels service (slugs, owner row, visibility live in
  // `createChannel`). Context is the CREATOR's — they own the container.
  try {
    await createChannel(
      buildChannelContext({
        userId,
        workspaceId: container.id,
        role: "owner",
        credentialSubjectUserId: userId,
      }),
      // ⚠ `topic` IS the product's "Description" (Samuel, 2026-09-15) — the
      // existing `channels.topic` column. Absent ⇒ `createChannel` pins `""`.
      { name: input.name, topic: input.topic, visibility: "private" }
    );
  } catch (err) {
    // ⚠ Roll back: a channel-less container is a BRICK — hidden by
    // `hydrateChannels` yet still counted as a membership everywhere.
    await deleteWorkspace(container.id);
    throw err;
  }
  return { channel: await hydrateOneChannel(container, userId) };
}

/**
 * Mint the ADD-A-PERSON link for a container that already exists.
 *
 * ⚠ ANY MEMBER MAY MINT, not only the owner (Samuel's ruling, 2026-08-24) — a
 * home channel is a relationship, not a tenancy.
 *
 * The order is the correctness argument:
 *  1. `findMemberContainer` is the FENCE: non-member or standard workspace → 404,
 *     never 403 (no oracle).
 *  2. MINT FLOOR and GRANT-ABOVE-SELF are judged BEFORE any insert. ⚠ No
 *     capacity gate (Samuel's ruling, 2026-08-26): the gates are about WHO asks,
 *     not HOW MANY are in.
 *  3. An OPEN link is RETURNED, not replaced (`getOrCreateJoinLink` precedent) —
 *     rotating would kill a URL already pasted somewhere. ⚠ But "open" ≠
 *     "claimable": a dead-but-unrevoked row still holds
 *     `channel_links_one_open_per_workspace` while `hydrateChannels` hides its
 *     Revoke button → permanently un-invitable. So dead → REVOKE and mint fresh.
 *     ⚠ An EXPLICITLY REQUESTED grant must also match (2026-08-26): otherwise
 *     picking Member over an open guest link silently returned the guest link
 *     (or the reverse, toward privilege). Mismatch → revoke and re-mint.
 *     🔒 ⚠ "REQUESTED" is load-bearing: `grantedRole` is `optional()`, not
 *     `.default("guest")`, so an ABSENT field reuses whatever is open instead of
 *     silently rotating/downgrading an outstanding invitation. The fail-closed
 *     `guest` default lives at `roleToMint`, for minting only.
 *  4. A lost insert race converges on the one-open index: 23505 → re-read and
 *     return the winner's.
 *
 * `maxUses: 1` always: ONE TOKEN ADMITS ONE PERSON, so a mis-pasted link lets in
 * one stranger, not the room. It is the ONLY bound on container growth now.
 *
 * ⚠ GRANT-ABOVE-SELF (2026-08-25, M2): `meetsMinRole(minterRole, grantedRole)`
 * or 403. The DB CHECK (`granted_role ∈ {guest,viewer,member}`) is the real
 * ceiling; the guard keeps the invariant if non-owners with lower roles mint.
 */
export async function mintContainerLink(
  userId: string,
  workspaceId: string,
  input: HomeLinkMintInput
): Promise<HomeLinkMintResult> {
  const container = await repo.findMemberContainer(workspaceId, userId);
  if (!container) {
    throw new HttpError(404, "CHANNEL_NOT_FOUND", "This channel is not available");
  }

  // ⚠ TWO VALUES on purpose: `requestedRole` (null = no pick) is all reuse may
  // compare; `roleToMint` is the fail-closed grant for a FRESH link. Collapsing
  // them makes "absent" revoke an open invitation.
  const requestedRole = input.grantedRole ?? null;
  const roleToMint: Role = requestedRole ?? "guest";

  // The fence returned the container, not the role — read the minter's role.
  const minter = await findMembership(workspaceId, userId);
  // 🔒 A GUEST MAY NOT MINT (2026-08-26). `meetsMinRole("guest","guest")` is
  // true, so grant-above-self alone lets a guest chain strangers into the
  // operator's transcript; this floor is the only stop. "Any MEMBER may mint"
  // (Samuel, 2026-08-24) means `member` and up.
  if (!minter || !meetsMinRole(minter.role, "member")) {
    throw new HttpError(
      403,
      "LINK_MINT_FORBIDDEN",
      "You cannot add somebody to this channel"
    );
  }
  if (!meetsMinRole(minter.role, roleToMint)) {
    throw new HttpError(
      403,
      "GRANT_ABOVE_SELF",
      "You cannot grant a role above your own"
    );
  }

  const open = await repo.findOpenLinkForWorkspace(workspaceId);
  if (open) {
    // ⚠ Reuse only if CLAIMABLE and no pick contradicts it (no pick, or the
    // same role). Anything else revokes and re-mints — see gate 3.
    if (
      isClaimable(open) &&
      (requestedRole === null || open.granted_role === requestedRole)
    ) {
      return { link: mapLinkRow(open) };
    }
    // ⚠ Dead, or granting a role the caller explicitly didn't pick. Revoke as
    // its OWN creator (it may be another member's), then mint fresh.
    await repo.markLinkRevoked(open.id, open.creator_user_id);
  }

  try {
    const row = await repo.insertLink({
      creatorUserId: userId,
      token: generateToken(),
      label: input.label ?? null,
      expiresAt: input.expiresAt ?? null,
      maxUses: 1,
      workspaceId,
      grantedRole: roleToMint,
    });
    return { link: mapLinkRow(row) };
  } catch (err) {
    if (!isUniqueViolation(err)) throw err;
    const winner = await repo.findOpenLinkForWorkspace(workspaceId);
    if (!winner) throw err;
    return { link: mapLinkRow(winner) };
  }
}

/**
 * Soft-revoke. Creator only; 404 for anybody else's link (no id oracle).
 * Idempotent: already-revoked is not an error.
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
 * THE FRONT DOOR for every claim. Token-level checks (unknown → 404, dead → 410)
 * run once here; then:
 *  - `workspace_id === null` → legacy unbound branch, MINTS a pair container.
 *  - otherwise → `service-claim-bound.ts › claimBoundLink`, JOINS the container.
 *
 * Two functions, not a flag: one may delete the workspace it just created, the
 * other must never delete the one it was handed.
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
  if (link.workspace_id !== null) {
    return claimBoundLink(link, userId);
  }
  return claimUnboundLink(link, userId);
}

/**
 * The LEGACY UNBOUND branch — a pre-2026-08-24 token with no container; its
 * claim mints one for the pair.
 *
 * ⚠ NOT DEAD CODE: live unbound claimable tokens existed (measured 2026-08-24).
 * Nothing can mint new ones (`HomeLinkMintSchema` requires `workspaceId`);
 * delete only once that count reaches zero.
 *
 * ⚠ THE ORDER IS THE CORRECTNESS ARGUMENT.
 *  1. Own link → 400 (would be a self-DM).
 *  2. Dedup the PAIR before spending a use — a re-open is a free no-op.
 *  3. Spend one use ATOMICALLY (`consumeLinkUse`) before any row is created; the
 *     only guard against two claimers. `false` → one pair re-check, then 410.
 *  4. Mint container + direct channel. ⚠ ACCEPTED WINDOW: a failure here burns
 *     the use; `createContainer` rolls back, so only a failed rollback leaks.
 *  5. Record the claim; unique `(link_id, claimed_by)` makes one account's
 *     double-claim converge — the loser drops its container, re-reads the winner.
 */
async function claimUnboundLink(
  link: ChannelLinkRow,
  userId: string
): Promise<HomeLinkClaimResult> {
  const creatorId = link.creator_user_id;
  if (creatorId === userId) {
    throw new HttpError(400, "LINK_SELF_CLAIM", "You cannot claim your own link");
  }

  const existing = await repo.findPairContainer(creatorId, userId);
  if (existing) {
    return { channel: await hydrateOneChannel(existing, userId), existing: true, bound: false };
  }

  if (!(await repo.consumeLinkUse(link.id))) {
    // ⚠ Re-read the PAIR, not the link: two tabs of one account race; the
    // loser must not 410 on its own successful claim.
    const winner = await repo.findPairContainer(creatorId, userId);
    if (winner) {
      return { channel: await hydrateOneChannel(winner, userId), existing: true, bound: false };
    }
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
    return { channel: await hydrateOneChannel(winner, userId), existing: true, bound: false };
  }
  return { channel: await hydrateOneChannel(container, userId), existing: false, bound: false };
}

/** The container plus its one direct channel — the legacy unbound shape. */
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

  // ⚠ Reuse the channels service (`direct_key` dedup, membership-of-2,
  // self-target refusal live in `createDirectChannel`). Context is the CREATOR's.
  try {
    await createChannel(
      buildChannelContext({
        userId: creatorId,
        workspaceId: container.id,
        role: "owner",
        credentialSubjectUserId: creatorId,
      }),
      { direct: true, memberUserId: claimerId }
    );
  } catch (err) {
    // ⚠ Roll back: a channel-less container is a BRICK — hidden, yet
    // `findPairContainer` would dedup every future claim onto it.
    await deleteWorkspace(container.id);
    throw err;
  }
  return container;
}
