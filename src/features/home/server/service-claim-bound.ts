import "server-only";
import { HttpError } from "@/shared/lib/http-error";
import { addMember, buildChannelContext } from "@/features/channels/server/service";
import { findWorkspaceById } from "@/features/workspaces/server/repository";
import type { HomeLinkClaimResult } from "../types";
import type { ChannelLinkRow } from "./dto";
import * as repo from "./repository";
import { hydrateOneChannel } from "./service-reads";

/**
 * THE BOUND CLAIM — a link naming an existing container, claimed by inserting
 * the claimer INTO it (2026-08-25).
 *
 * ⚠ NO CAPACITY STEP (Samuel's ruling, 2026-08-26: more than two people). The
 * single-use bound link is what bounds growth — one token, one person.
 *
 * ⚠ A SIBLING OF `service-writes.ts › claimLink`, NEVER A MODE ON IT: unbound
 * CREATES a workspace and may roll it back; this one JOINS a workspace it must
 * never delete. One signature would make the destructive path the default.
 *
 * ── THE ORDER IS THE CORRECTNESS ARGUMENT ──────────────────────────────────
 *  1. Self-claim → 400 ("already in this one").
 *  2. Dedup on MEMBERSHIP before spending — a re-open must not burn the use.
 *  3. Spend one use ATOMICALLY. `false` → 410 after ONE re-read of MEMBERSHIP,
 *     never the link row (`consumeLinkUse` forbids it).
 *  4. WORKSPACE membership, at the role the LINK grants.
 *  5. CHANNEL membership via the channels service. ⚠ On failure delete the
 *     MEMBER ROW, never the CONTAINER — a stranger's failed claim must not
 *     delete the owner's transcript.
 *  6. Record the claim; unique `(link_id, claimed_by)` converges a double claim,
 *     and the loser KEEPS the container.
 *  7. Revoke the link — clears the chip and frees the one-open index for the
 *     NEXT invitation.
 *
 * ⚠ THE SPEND (step 3) IS THE PIVOT: any later failure also REVOKES the link,
 * else exhausted-but-unrevoked bricks the container (same brick
 * `mintContainerLink` guards). Best-effort; never masks the claim error.
 */
export async function claimBoundLink(
  link: ChannelLinkRow,
  userId: string
): Promise<HomeLinkClaimResult> {
  const workspaceId = link.workspace_id;
  if (!workspaceId) {
    // Unreachable through `claimLink`, which dispatches on exactly this field.
    throw new HttpError(500, "LINK_NOT_BOUND", "This link names no channel");
  }

  // 1 ─ Self-claim.
  if (link.creator_user_id === userId) {
    throw new HttpError(
      400,
      "LINK_SELF_CLAIM",
      "You are already in this channel"
    );
  }

  // 2 ─ Dedup on membership, before anything is spent.
  const mine = await repo.findMemberContainer(workspaceId, userId);
  if (mine) {
    return { channel: await hydrateOneChannel(mine, userId), existing: true, bound: true };
  }

  // 3 ─ Spend.
  if (!(await repo.consumeLinkUse(link.id))) {
    // ⚠ Re-read MEMBERSHIP, never the link: two tabs of one account race; the
    // loser must not 410 on its own successful claim.
    const winner = await repo.findMemberContainer(workspaceId, userId);
    if (winner) {
      return {
        channel: await hydrateOneChannel(winner, userId),
        existing: true,
        bound: true,
      };
    }
    throw new HttpError(410, "LINK_UNAVAILABLE", "This link is no longer available");
  }

  // ── POST-SPEND ─ every failure below must also REVOKE the link (see docblock;
  // the brick now blocks every future member). Best-effort via `revokeQuietly`.
  try {
    // The OWNER acts for every write below: the claimer isn't a member yet, so
    // their context would be refused by the channel's gate.
    const container = await findWorkspaceById(workspaceId);
    if (!container) {
      // FK cascades the link with its workspace: a delete race → 410, not 500.
      throw new HttpError(410, "LINK_UNAVAILABLE", "This link is no longer available");
    }

    // 4 ─ Workspace membership, at the role the LINK grants (M2 — closes F-319).
    // Default `guest`, ceiling `member`. A failure reaches the outer catch.
    await repo.insertContainerMember({
      workspaceId,
      userId,
      invitedBy: container.ownerId,
      role: link.granted_role,
    });

    // 5 ─ Channel membership, through the channels service.
    try {
      await joinContainerChannel(workspaceId, container.ownerId, userId);
    } catch (err) {
      // ⚠ Undo step 4 only — never delete the container (owner's transcript).
      // The link revoke is the outer catch's job.
      await repo.deleteContainerMember(workspaceId, userId);
      throw err;
    }

    // 6 ─ Record the claim.
    const claimed = await repo.insertClaim({
      linkId: link.id,
      claimedBy: userId,
      workspaceId,
    });
    if (!claimed) {
      // Same account, concurrent double claim: the winner joined and revoked;
      // just read back what it built.
      const winner = await repo.findMemberContainer(workspaceId, userId);
      if (!winner) throw new HttpError(409, "LINK_CLAIM_RACE", "Try again");
      return {
        channel: await hydrateOneChannel(winner, userId),
        existing: true,
        bound: true,
      };
    }

    // 7 ─ Revoke, AFTER the claim row: dead → revoked, so the chip
    // (`revoked_at IS NULL`) clears and the one-open index frees for the NEXT mint.
    await repo.markLinkRevoked(link.id, link.creator_user_id);

    // ⚠ READ BACK THROUGH THE FENCE: keeps `snake_case` rows out of the service
    // (§2) and re-proves the join landed — a phantom success must surface.
    const joined = await repo.findMemberContainer(workspaceId, userId);
    if (!joined) {
      throw new HttpError(500, "CLAIM_INCOMPLETE", "The claim did not take");
    }
    return {
      channel: await hydrateOneChannel(joined, userId),
      existing: false,
      bound: true,
    };
  } catch (err) {
    // ⚠ Post-spend failure: revoke so the link can't brick the container, then
    // surface the ORIGINAL error.
    await revokeQuietly(link);
    throw err;
  }
}

/**
 * Best-effort compensation revoke after a post-spend failure. ⚠ Scoped to the
 * link's creator; its own failure is swallowed so the claim error stays the one
 * the caller sees. Idempotent against step 7 having already run.
 */
async function revokeQuietly(link: ChannelLinkRow): Promise<void> {
  try {
    await repo.markLinkRevoked(link.id, link.creator_user_id);
  } catch {
    // Intentionally ignored — see docblock.
  }
}

/** The container's one channel, joined by the claimer. */
async function joinContainerChannel(
  workspaceId: string,
  ownerId: string,
  userId: string
): Promise<void> {
  const channels = await repo.listContainerChannels([workspaceId]);
  const channel = channels.get(workspaceId);
  if (!channel) {
    throw new HttpError(500, "CHANNEL_INCOMPLETE", "This container has no channel");
  }
  try {
    // ⚠ Reuse `addMember` (membership precondition, DM refusal, dup guard). Legal
    // only because this channel is PRIVATE and NON-direct; legacy unbound
    // containers hold a DIRECT channel, which `addMember` refuses.
    await addMember(
      buildChannelContext({
        userId: ownerId,
        workspaceId,
        role: "owner",
        credentialSubjectUserId: ownerId,
      }),
      channel.id,
      userId
    );
  } catch (err) {
    // Already in the channel = converged, not failed. Nothing to compensate.
    if (isMemberExists(err)) return;
    throw err;
  }
}

/**
 * `ChannelMemberExistsError`, by NAME. ⚠ Not `instanceof`: `errors.ts` is
 * deliberately outside the channels barrel; the base class stamps
 * `this.name = new.target.name`, so the name is the contract.
 */
function isMemberExists(err: unknown): boolean {
  return (err as { name?: string } | null)?.name === "ChannelMemberExistsError";
}
