import "server-only";
import { HttpError } from "@/shared/lib/http-error";
import { supabaseAdmin } from "@/shared/supabase/admin";
import type { Role } from "../types";
import { canGrantRole, memberManageDenial } from "../member-policy";
import { syncSeatQuantity } from "@/features/billing/server/seats";
import { removeWorkspaceDepartedMember } from "@/features/channels/server/service";
import { recordActivity } from "@/features/members/server/activity";
import { requireWorkspaceRole, assertWorkspacePermanentById } from "./authz";
import { findMembership } from "./repository";

/**
 * Administration of an EXISTING member — the three writes that change what
 * somebody inside the workspace is, or whether they are still in it. Split from
 * `invitations.ts` (which is about getting someone IN); both are re-exported
 * from there so no importer moved.
 *
 * ⚠ NO `assertMemberAddable` GATE HERE, and its absence is the rule: no write
 * here ADDS anybody. `updateMemberRole` re-grades an existing row and
 * `removeMember` / `leaveWorkspace` delete one, and removal from a `kind='link'`
 * container is
 * deliberately allowed (`authz.ts › assertMemberAddable`). A member-ADD write
 * added to this file would need the gate.
 *
 * ⚠ **`assertWorkspacePermanentById` IS HERE, THOUGH, AND IT IS A DIFFERENT
 * QUESTION** (R-35, 2026-09-17): not "may this container gain a member" but
 * "may this container lose its only one". A `kind='personal'` home space is
 * permanent, so `removeMember` AND `leaveWorkspace` refuse it outright; `link`
 * and `standard` are untouched.
 *
 * ⚠ TERMINATION IS A ROW DELETE, NOT A STATUS FLIP. Nothing writes
 * `workspace_members.status` to anything but `'active'`; the only exits are the
 * DELETE below and the `auth.users` cascade behind account deletion. "No longer
 * an active member" == "has no row", which is what lets the channels sweep and
 * its backfill migration key on a plain NOT EXISTS.
 */

/**
 * Update a member's role. Owner promotes/demotes anyone incl. themselves;
 * admin manages member/viewer only. ⚠ Refuses to demote the LAST owner — the
 * workspace would be unrecoverable.
 */
export async function updateMemberRole(
  workspaceId: string,
  callerId: string,
  targetUserId: string,
  newRole: Role
): Promise<void> {
  const callerRole = await requireWorkspaceRole(workspaceId, callerId, "admin");

  const target = await findMembership(workspaceId, targetUserId);
  if (!target || target.status !== "active") {
    throw new HttpError(404, "MEMBER_NOT_FOUND", "Member not found");
  }

  // Hierarchy single-sourced in ../member-policy (shared with the members UI).
  // Owners may change their own role; last-owner protection below catches the
  // unsafe case.
  const denial = memberManageDenial(callerRole, target.role, targetUserId === callerId);
  if (denial === "self") {
    throw new HttpError(
      403,
      "WORKSPACE_FORBIDDEN",
      "You cannot change your own role — ask another admin or the owner"
    );
  }
  if (denial === "target-protected") {
    throw new HttpError(
      403,
      "WORKSPACE_FORBIDDEN",
      "Admins can only change member / viewer roles"
    );
  }
  if (!canGrantRole(callerRole, newRole)) {
    throw new HttpError(
      403,
      "WORKSPACE_FORBIDDEN",
      "Only the owner can grant admin or owner roles"
    );
  }

  // Last-owner protection.
  if (target.role === "owner" && newRole !== "owner") {
    const ownerCount = await countActiveOwners(workspaceId);
    if (ownerCount <= 1) {
      throw new HttpError(
        409,
        "WORKSPACE_LAST_OWNER",
        "Cannot demote the last owner — promote another member to owner first"
      );
    }
  }

  const db = supabaseAdmin();
  const { error } = await db
    .from("workspace_members")
    .update({ role: newRole })
    .eq("workspace_id", workspaceId)
    .eq("user_id", targetUserId);
  if (error) throw error;

  await recordActivity({
    workspaceId,
    actorUserId: callerId,
    verb: "member.role_changed",
    metadata: { subjectUserId: targetUserId, from: target.role, to: newRole },
  });
}

/**
 * Remove a member. Owner removes anyone (incl. themselves, with last-owner
 * protection); admin removes member/viewer only.
 *
 * ⚠ ONE OF THE TWO APP-LEVEL DEPARTURE PATHS — `leaveWorkspace` below is the
 * other, and both run `completeRemoval`, which is where the channels sweep is
 * wired. The remaining exits are DATABASE cascades that already take the
 * channel rows: workspace delete (`channels.workspace_id` ON DELETE CASCADE)
 * and account delete (`channel_members.user_id` → `auth.users` ON DELETE
 * CASCADE). A third departure path must call `completeRemoval` too.
 */
export async function removeMember(
  workspaceId: string,
  callerId: string,
  targetUserId: string
): Promise<void> {
  const callerRole = await requireWorkspaceRole(workspaceId, callerId, "admin");

  const target = await findMembership(workspaceId, targetUserId);
  if (!target || target.status !== "active") {
    return; // Idempotent — nothing to remove.
  }

  // 🔒 ⚠ NOBODY LEAVES A HOME SPACE (Samuel's ruling R-35, 2026-09-17). The
  // last-owner protection below ALREADY refuses this — a personal container has
  // exactly one member and that member is its owner — but it refuses for an
  // accident of the roster, and the rule is about the KIND. Stated here so the
  // refusal survives a roster that ever changes shape, and so the message says
  // "permanent" rather than "transfer ownership first", which is advice nobody
  // can take on a container that admits no second member
  // (`authz.ts › assertMemberAddable`).
  //
  // ⚠ AFTER the idempotent no-op above: removing a member who is not there is
  // still nothing, on every kind.
  await assertWorkspacePermanentById(workspaceId);

  if (memberManageDenial(callerRole, target.role, targetUserId === callerId) !== null) {
    throw new HttpError(
      403,
      "WORKSPACE_FORBIDDEN",
      "Admins cannot remove owners, admins, or themselves"
    );
  }

  if (target.role === "owner") {
    const ownerCount = await countActiveOwners(workspaceId);
    if (ownerCount <= 1) {
      throw new HttpError(
        409,
        "WORKSPACE_LAST_OWNER",
        "Cannot remove the last owner — transfer ownership first"
      );
    }
  }

  await completeRemoval(workspaceId, callerId, targetUserId, target.role);
}

/**
 * LEAVE — the caller deletes their OWN membership row.
 *
 * 🔒 **Samuel's ruling R-09 (2026-09-17): "add remove + leave".**
 * ⚠ **NOT AN ARM OF `removeMember`, AND THE RULING WAS COSTED AS UI-ONLY ON A
 * PREMISE THAT WAS FALSE (F-725).** That write opens with
 * `requireWorkspaceRole(…, "admin")` and then denies `isSelf` for everyone but
 * an owner, and a link container's owner is its LAST owner — so before this
 * function NOBODY could leave a container from any surface.
 * ⚠ SAME THREE REFUSALS removal has, for the same reasons: a `kind='personal'`
 * home space is permanent (R-35), the last owner may not go, and a caller with
 * no active row is an idempotent no-op.
 * ⚠ NO ROLE FLOOR OF ITS OWN, and the DELETE route's resolver still carries
 * one: `resolveApiWorkspace`'s inverted default refuses a `guest` with a 404,
 * so a guest has no exit through that door. The /home roster hides Leave from
 * them for R2/R3's reason too (their claim link is spent, so leaving is
 * one-way) — the hide is a picture of that 404, not a second fence.
 */
export async function leaveWorkspace(
  workspaceId: string,
  callerId: string
): Promise<void> {
  const membership = await findMembership(workspaceId, callerId);
  if (!membership || membership.status !== "active") {
    return; // Idempotent — nothing to leave.
  }

  await assertWorkspacePermanentById(workspaceId);

  if (membership.role === "owner") {
    const ownerCount = await countActiveOwners(workspaceId);
    if (ownerCount <= 1) {
      throw new HttpError(
        409,
        "WORKSPACE_LAST_OWNER",
        "Cannot leave as the last owner — transfer ownership first"
      );
    }
  }

  await completeRemoval(workspaceId, callerId, callerId, membership.role);
}

/**
 * THE DELETE AND ITS THREE FOLLOW-ONS, shared by removal and departure —
 * "departure IS removal" (INVARIANTS §4A) spelled as one code path rather than
 * two that drift. ⚠ EVERY GATE IS THE CALLER'S; this function refuses nothing.
 */
async function completeRemoval(
  workspaceId: string,
  actorId: string,
  targetUserId: string,
  targetRole: Role
): Promise<void> {
  const db = supabaseAdmin();

  // Team memberships are cleaned by the member_removed_team_cleanup DB trigger
  // on workspace_members delete — no manual sweep needed.
  const { error } = await db
    .from("workspace_members")
    .delete()
    .eq("workspace_id", workspaceId)
    .eq("user_id", targetUserId);
  if (error) throw error;

  // ⚠ The departure must reach INTO channels, and AFTER the membership delete
  // — running it first and then failing the delete evicts a still-active member
  // from every room and closes their DMs for nothing.
  //
  // ⚠ BEST-EFFORT, NOT TRANSACTIONAL: two PostgREST calls, and supabase-js
  // cannot span them (transactional would mean a PL/pgSQL RPC). The failure
  // mode is benign — `isActiveWorkspaceMember` fails closed on the way in, so a
  // sweep that does not run degrades to a stale roster row, not a hole. A THROW
  // here would strand the workspace removal itself: the caller sees a 500 on a
  // committed delete and retries into an idempotent no-op that never reaches
  // the sweep. Same precedent as `syncSeatQuantity` below and the workspace
  // seed. Repair path for a logged failure is
  // `..._channel_members_departed_backfill.sql`, re-runnable.
  await removeWorkspaceDepartedMember(workspaceId, targetUserId).catch((err) => {
    console.error(
      `[membership-admin] channel sweep failed for user ${targetUserId} in workspace ${workspaceId}:`,
      err instanceof Error ? err.message : err
    );
  });

  // Reconcile Pro subscription quantity. Best-effort: a billing hiccup must
  // not fail the removal.
  await syncSeatQuantity(workspaceId).catch((err) => {
    console.error(
      `[membership-admin] syncSeatQuantity failed for workspace ${workspaceId}:`,
      err instanceof Error ? err.message : err
    );
  });

  // ⚠ LAST, so it cannot interleave into the delete → channels-sweep sequence
  // above, which is an ordering invariant with a test on it. Recording is an
  // observation of a write that already happened.
  await recordActivity({
    workspaceId,
    actorUserId: actorId,
    verb: "member.removed",
    metadata: { subjectUserId: targetUserId, role: targetRole },
  });
}

// ⚠ Fast-fail UX only, NOT the backstop. The last-owner invariant is enforced
// by the DB trigger on workspace_members (H-5); this read-then-write is racy on
// purpose and the trigger closes the race.
async function countActiveOwners(workspaceId: string): Promise<number> {
  const db = supabaseAdmin();
  const { count, error } = await db
    .from("workspace_members")
    .select("user_id", { count: "exact", head: true })
    .eq("workspace_id", workspaceId)
    .eq("status", "active")
    .eq("role", "owner");
  if (error) throw error;
  return count ?? 0;
}
