import "server-only";
import { HttpError } from "@/shared/lib/http-error";
import { supabaseAdmin } from "@/shared/supabase/admin";
import type { Role } from "../types";
import { canGrantRole, memberManageDenial } from "../member-policy";
import { syncSeatQuantity } from "@/features/billing/server/seats";
import { removeWorkspaceDepartedMember } from "@/features/channels/server/service";
import { requireWorkspaceRole } from "./authz";
import { findMembership } from "./repository";

/**
 * ADMINISTRATION OF AN EXISTING MEMBER — the two writes that change what
 * somebody already inside the workspace is, or whether they are still in it.
 *
 * Split out of `invitations.ts` (§2: that file was 534 lines and exempt-listed,
 * and any edit to an over-cap file must shrink or split it). The seam is a real
 * reason-to-change, not a line count: `invitations.ts` is about getting someone
 * IN — minting a token, validating it, redeeming it into a membership row.
 * These two are about someone already in, and `removeMember` in particular now
 * has to answer for what a departure costs across OTHER features, which is a
 * different question from what an invite costs.
 *
 * `updateMemberRole` and `removeMember` are re-exported from `invitations.ts`
 * so no importer moved (the same barrel shape `teams/server/repository.ts` kept
 * through its own split).
 *
 * TERMINATION IS A ROW DELETE, NOT A STATUS FLIP. Nothing in this app ever
 * writes `workspace_members.status` to anything but `'active'` — every add path
 * upserts `status: 'active'` and the only exit is the DELETE below (plus the
 * `auth.users` cascade behind account deletion). So "no longer an active
 * member" and "has no row" are the same statement, which is what lets both the
 * channels sweep and its backfill migration key on a plain NOT EXISTS.
 */

/**
 * Update a member's role. Owner can promote/demote anyone (including
 * themselves), admin can manage member/viewer but never owners, other
 * admins, or themselves. Refuses to demote the last remaining owner
 * (the workspace would be unrecoverable).
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

  // Hierarchy rules single-sourced in ../member-policy (shared with the
  // members UI). Owners can still change their own role (last-owner
  // protection below catches the unsafe case).
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
}

/**
 * Remove a member. Owner can remove anyone (including themselves, with
 * last-owner protection). Admin can remove member/viewer only — not
 * owners, other admins, or themselves.
 *
 * THIS IS THE ONLY APP-LEVEL DEPARTURE PATH, and that is worth stating because
 * the sweep below is wired to it and nowhere else. The other two ways a
 * membership can end are both DATABASE cascades that already take the channel
 * rows with them: deleting the workspace (`channels.workspace_id` ON DELETE
 * CASCADE) and deleting the account (`channel_members.user_id` → `auth.users`
 * ON DELETE CASCADE, which is what `DELETE /api/user/delete` fires). There is
 * no self-serve "leave workspace" route, no deactivation, and no status flip —
 * if one is ever added, it must call the sweep too.
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

  // Team memberships are cleaned up by the member_removed_team_cleanup
  // DB trigger on workspace_members delete — no manual sweep needed
  // (the legacy workspace_resource_access table is no longer consulted).
  const { error } = await db
    .from("workspace_members")
    .delete()
    .eq("workspace_id", workspaceId)
    .eq("user_id", targetUserId);
  if (error) throw error;

  // ── C-20: the departure has to reach INTO channels ──────────────────
  // AFTER the membership delete, never before: running it first and then
  // failing the delete would have evicted a still-active member from every
  // room they are in (and closed their DMs) with nothing to show for it.
  //
  // BEST-EFFORT, NOT TRANSACTIONAL — a deliberate choice, and there is no
  // transaction on offer to choose instead. These are two PostgREST calls;
  // supabase-js cannot span them, so "same transaction" would mean pushing the
  // whole thing into a PL/pgSQL RPC. That is not worth it here, because the
  // failure mode is already benign: the addressing check
  // (`isActiveWorkspaceMember`) fails closed on the way in regardless, so a
  // sweep that does not run degrades to exactly the pre-C-20 behaviour (a stale
  // roster row) rather than to a hole. Meanwhile a THROW here would strand the
  // workspace removal itself — the caller sees a 500 on a delete that already
  // committed and retries into an idempotent no-op that never reaches the
  // sweep. Same precedent, same reasoning as `syncSeatQuantity` below and the
  // workspace seed: the authoritative write stands on its own; the follow-on
  // reconciles. The repair path for a logged failure is the backfill migration
  // (`..._channel_members_departed_backfill.sql`), which is the same rule
  // expressed as SQL and can be re-run.
  await removeWorkspaceDepartedMember(workspaceId, targetUserId).catch((err) => {
    console.error(
      `[membership-admin] channel sweep failed for user ${targetUserId} in workspace ${workspaceId}:`,
      err instanceof Error ? err.message : err
    );
  });

  // Seat count dropped — reconcile the Pro subscription quantity.
  // Best-effort: a billing hiccup must not fail the removal.
  await syncSeatQuantity(workspaceId).catch((err) => {
    console.error(
      `[membership-admin] syncSeatQuantity failed for workspace ${workspaceId}:`,
      err instanceof Error ? err.message : err
    );
  });
}

// Fast-fail UX only. The last-owner invariant is enforced authoritatively by
// the DB trigger on workspace_members (H-5) — this app-side check just returns
// a friendly 409 before the write; it is NOT the real backstop and its
// read-then-write is racy on purpose (the trigger closes that race).
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
