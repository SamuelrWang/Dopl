import "server-only";
import { HttpError } from "@/shared/lib/http-error";
import { supabaseAdmin } from "@/shared/supabase/admin";
import type { Role } from "../types";
import { canGrantRole, memberManageDenial } from "../member-policy";
import { syncSeatQuantity } from "@/features/billing/server/seats";
import { removeWorkspaceDepartedMember } from "@/features/channels/server/service";
import { recordActivity } from "@/features/members/server/activity";
import { requireWorkspaceRole } from "./authz";
import { findMembership } from "./repository";

/**
 * Administration of an EXISTING member — the two writes that change what
 * somebody inside the workspace is, or whether they are still in it. Split from
 * `invitations.ts` (which is about getting someone IN); both are re-exported
 * from there so no importer moved.
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
 * ⚠ THE ONLY APP-LEVEL DEPARTURE PATH — the channels sweep below is wired here
 * and nowhere else. The other two exits are DATABASE cascades that already take
 * the channel rows: workspace delete (`channels.workspace_id` ON DELETE
 * CASCADE) and account delete (`channel_members.user_id` → `auth.users` ON
 * DELETE CASCADE). If a "leave workspace" route is ever added, it must call the
 * sweep too.
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
    actorUserId: callerId,
    verb: "member.removed",
    metadata: { subjectUserId: targetUserId, role: target.role },
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
