import "server-only";
import { HttpError } from "@/shared/lib/http-error";
import { addMember, buildChannelContext } from "@/features/channels/server/service";
import { findWorkspaceById } from "@/features/workspaces/server/repository";
import type { HomeLinkClaimResult } from "../types";
import type { ChannelLinkRow } from "./dto";
import * as repo from "./repository";
import { hydrateOneChannel } from "./service-reads";

/**
 * THE BOUND CLAIM — a link that names a container, claimed by inserting the
 * claimer INTO it (2026-08-25). The container already exists, already has one
 * member, and already has a transcript.
 *
 * ⚠ A SIBLING OF `service-writes.ts › claimLink`, NEVER A MODE ON IT — the same
 * argument `channels/server/service-await-workspace.ts` makes about the
 * workspace-wide hold. The two branches share a token and share nothing else:
 * the unbound one CREATES a workspace and may therefore roll it back, this one
 * JOINS a workspace it must never delete. Putting both behind one signature
 * would put two rollback stories in one function, and the destructive one would
 * be the default. `claimLink` stays the front door and dispatches on
 * `link.workspace_id`.
 *
 * ── THE ORDER IS THE CORRECTNESS ARGUMENT ──────────────────────────────────
 *  1. Self-claim → 400. Same code as the unbound branch, different sentence:
 *     there is no self-DM to refuse here, it is "you are already in this one".
 *  2. Dedup on MEMBERSHIP before anything is spent. Re-opening your own claimed
 *     link is a no-op that returns the channel, and it must not burn the use —
 *     the unbound branch dedups on the PAIR for the same reason.
 *  3. Capacity BEFORE the spend. A full container has no seat, and burning the
 *     single use to then refuse would destroy the link on a request that changed
 *     nothing.
 *  4. Spend one use ATOMICALLY. Its `false` is a 410 after ONE re-read of
 *     MEMBERSHIP — never of the link row, which `consumeLinkUse`'s docblock
 *     forbids outright.
 *  5. WORKSPACE membership first. The DB trigger is the hard fence; the step-3
 *     check is only a friendlier sentence in front of it.
 *  6. CHANNEL membership second, through the channels service.
 *     ⚠ ON FAILURE THIS PATH DELETES THE MEMBER ROW — never the CONTAINER. It
 *     may not roll the container back the way the unbound branch does: the
 *     owner's transcript lives in there, and a failed claim by a stranger must
 *     not be able to delete somebody's channel.
 *  7. Record the claim. Its unique `(link_id, claimed_by)` converges a double
 *     claim — and the loser here KEEPS the container (see step 6) where the
 *     unbound loser drops the one it just minted.
 *  8. Revoke the link. Success means the seat is taken, so the chip clears at
 *     once and the one-open-per-container unique index is freed for the next
 *     invitation if this member later leaves.
 *
 * ⚠ THE SPEND (step 4) IS THE PIVOT: everything after it is wrapped so that ANY
 * failure — capacity race at step 5, channel-join at step 6, a torn claim at
 * step 7 — also REVOKES the link. An exhausted-but-unrevoked link is the same
 * permanent brick `mintContainerLink` guards against: the one-open unique index
 * blocks a replacement while `hydrateChannels` hides the Revoke button. The
 * compensation revoke is best-effort and never masks the claim error.
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

  // 3 ─ Capacity, before the spend.
  if ((await repo.countActiveContainerMembers(workspaceId)) >= 2) {
    throw containerFull();
  }

  // 4 ─ Spend.
  if (!(await repo.consumeLinkUse(link.id))) {
    // ⚠ ONE re-read, of MEMBERSHIP and never of the link row. Two tabs of the
    // SAME account race past step 2 together; one wins the use and joins, the
    // other reads exhausted — and is looking at a channel it is now in, so a 410
    // would refuse the claimer their own successful claim.
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

  // ── POST-SPEND ─ the use is gone, so EVERY failure below must also REVOKE the
  // link, not strand it. An exhausted-but-unrevoked row matches
  // `channel_links_one_open_per_workspace` (blocking a replacement mint) and
  // renders "invite out" over a filled/half-filled seat while `hydrateChannels`
  // hides its Revoke button — the same permanent brick `mintContainerLink`
  // guards against on the mint side. The compensation revoke is best-effort and
  // must not mask the claim error (see `revokeQuietly`).
  try {
    // The container's OWNER acts for every write below: the claimer is not a
    // member of anything yet, so a context built for them would be refused by the
    // channel's own gate. Same reason the unbound branch builds the CREATOR's.
    const container = await findWorkspaceById(workspaceId);
    if (!container) {
      // The FK cascades this link away with its workspace, so this is a race with
      // a container delete rather than a normal state — 410, not 500.
      throw new HttpError(410, "LINK_UNAVAILABLE", "This link is no longer available");
    }

    // 5 ─ Workspace membership, at the role the LINK grants (M2 — closes F-319).
    // Default `guest`, ceiling `member`; the claimer is no longer a silent admin.
    try {
      await repo.insertContainerMember({
        workspaceId,
        userId,
        invitedBy: container.ownerId,
        role: link.granted_role,
      });
    } catch (err) {
      // The trigger is the fence step 3 only approximates; two concurrent claims
      // of two different links both pass step 3 and exactly one lands here.
      if (isContainerFullRaise(err)) throw containerFull();
      throw err;
    }

    // 6 ─ Channel membership, through the channels service.
    try {
      await joinContainerChannel(workspaceId, container.ownerId, userId);
    } catch (err) {
      // ⚠ COMPENSATE, DO NOT ROLL BACK THE CONTAINER. Deleting the member row
      // undoes exactly what step 5 did; deleting the workspace would take the
      // owner's transcript with it. (The link revoke is the outer catch's job.)
      await repo.deleteContainerMember(workspaceId, userId);
      throw err;
    }

    // 7 ─ Record the claim.
    const claimed = await repo.insertClaim({
      linkId: link.id,
      claimedBy: userId,
      workspaceId,
    });
    if (!claimed) {
      // The same account claimed twice concurrently. The winner already put this
      // user in the container AND revoked the link, so there is nothing to undo
      // and nothing to revoke — just read back what the winner built.
      const winner = await repo.findMemberContainer(workspaceId, userId);
      if (!winner) throw new HttpError(409, "LINK_CLAIM_RACE", "Try again");
      return {
        channel: await hydrateOneChannel(winner, userId),
        existing: true,
        bound: true,
      };
    }

    // 8 ─ Revoke. ⚠ AFTER the claim row: the link is single-use and already
    // exhausted, so this turns a dead token into a revoked one. The CHIP reads
    // `revoked_at IS NULL` — an exhausted-but-unrevoked link would keep
    // rendering "invite out" over a seat that is filled.
    await repo.markLinkRevoked(link.id, link.creator_user_id);

    // ⚠ READ BACK THROUGH THE FENCE, rather than hydrating the workspace row this
    // function already holds. Two reasons: `hydrateOneChannel` takes a REPOSITORY
    // row and building one here would put `snake_case` in a service (§2), and the
    // read re-proves through `findMemberContainer` that the join really landed —
    // an insert that reported success while the row is absent is a bug to surface,
    // not to paper over with a rendered card.
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
    // ⚠ The spend already happened. Whatever failed above (capacity race,
    // channel join, a torn claim), the link must not be left exhausted-and-live
    // to brick the container. Revoke it, then surface the ORIGINAL error.
    await revokeQuietly(link);
    throw err;
  }
}

/**
 * Best-effort compensation revoke for a claim that failed AFTER the use was
 * spent. ⚠ Scoped to the link's own creator (the claimer never owns it) and its
 * own failure is swallowed: a failed revoke leaves the brick, but the claim
 * error is the one the caller must see — masking it with a revoke error would
 * hide why the claim failed. Idempotent against step 8 having already run.
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
    // ⚠ THE CHANNELS SERVICE, not an insert here: the workspace-membership
    // precondition, the DM refusal and the duplicate guard all live in
    // `addMember` and must not be mirrored. The container's channel is PRIVATE
    // and NON-direct, which is precisely what makes this call legal — a legacy
    // unbound container holds a DIRECT channel and `addMember` refuses those.
    await addMember(
      buildChannelContext({ userId: ownerId, workspaceId, role: "owner" }),
      channel.id,
      userId
    );
  } catch (err) {
    // Already in the channel = converged, not failed. Nothing to compensate.
    if (isMemberExists(err)) return;
    throw err;
  }
}

function containerFull(): HttpError {
  return new HttpError(
    409,
    "LINK_CONTAINER_FULL",
    "This channel already has somebody in it"
  );
}

/**
 * The member-cap trigger's RAISE (`20260824120000`), which arrives as a plain
 * Postgres error. ⚠ Matched on the MESSAGE PREFIX rather than the SQLSTATE:
 * the trigger raises `check_violation`, and so does every CHECK constraint on
 * `workspace_members`, so the code alone would swallow unrelated failures.
 * REFACTOR-FINDINGS F-306 is the standing entry on this string living in three
 * places with nothing joining them.
 */
function isContainerFullRaise(err: unknown): boolean {
  const message = (err as { message?: string } | null)?.message;
  return typeof message === "string" && message.includes("LINK_CONTAINER_FULL");
}

/**
 * `ChannelMemberExistsError`, by NAME. ⚠ Not `instanceof`: that would import an
 * error class out of another feature's `server/` internals to spell one
 * comparison, and `errors.ts` is deliberately absent from the channels service
 * barrel. The base class stamps `this.name = new.target.name`, so the name is
 * part of the contract the barrel does expose. Same posture as
 * `service-writes.ts › isUniqueViolation`.
 */
function isMemberExists(err: unknown): boolean {
  return (err as { name?: string } | null)?.name === "ChannelMemberExistsError";
}
