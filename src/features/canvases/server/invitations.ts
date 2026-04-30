import "server-only";
import { randomBytes } from "crypto";
import { HttpError } from "@/shared/lib/http-error";
import { supabaseAdmin } from "@/shared/supabase/admin";
import type {
  Invitation,
  InvitationStatus,
  InvitedRole,
  Role,
} from "../types";
import { meetsMinRole } from "../types";
import {
  type InvitationRow,
  mapInvitationRow,
} from "./dto";
import { findCanvasById, findMembership } from "./repository";
import { resolveMembershipOrThrow } from "./service";

const INVITATION_COLS =
  "id, canvas_id, email, invited_role, invited_by, token, expires_at, accepted_at, accepted_by, revoked_at, created_at";

const DEFAULT_TTL_DAYS = 7;

/**
 * Generate a URL-safe random token for an invitation. 32 bytes of
 * entropy → 43 base64url chars; ample for a non-guessable single-use
 * token. We store it in cleartext because the table is service-role
 * scoped and the token's existence is intentionally tied to the email.
 */
function generateToken(): string {
  return randomBytes(32).toString("base64url");
}

function expiresAtFromNow(ttlDays = DEFAULT_TTL_DAYS): string {
  return new Date(Date.now() + ttlDays * 24 * 60 * 60 * 1000).toISOString();
}

async function requireRole(
  canvasId: string,
  userId: string,
  minRole: Role
): Promise<{ role: Role }> {
  const membership = await findMembership(canvasId, userId);
  if (!membership || membership.status !== "active") {
    throw new HttpError(404, "CANVAS_NOT_FOUND", "Canvas not found");
  }
  if (!meetsMinRole(membership.role, minRole)) {
    throw new HttpError(
      403,
      "CANVAS_FORBIDDEN",
      `Requires ${minRole} role or higher`
    );
  }
  return { role: membership.role };
}

export interface CreateInvitationInput {
  canvasId: string;
  invitedBy: string;
  email: string;
  role: InvitedRole;
  ttlDays?: number;
}

/**
 * Create a pending invitation. Caller must be admin or owner of the
 * canvas. Idempotent on (canvas_id, email): if a non-revoked, non-
 * expired invitation already exists for this email, return it instead
 * of creating a duplicate. Email send isn't wired in v1 — the inviter
 * copies the magic link from the response.
 */
export async function createInvitation(
  input: CreateInvitationInput
): Promise<Invitation> {
  await requireRole(input.canvasId, input.invitedBy, "admin");

  const normalizedEmail = input.email.trim().toLowerCase();
  if (!normalizedEmail) {
    throw new HttpError(400, "INVALID_EMAIL", "Email is required");
  }

  const db = supabaseAdmin();

  // Reuse a still-live invitation rather than spamming new tokens for
  // the same email. Only re-issue if the previous one is gone.
  const { data: existing } = await db
    .from("canvas_invitations")
    .select(INVITATION_COLS)
    .eq("canvas_id", input.canvasId)
    .eq("email", normalizedEmail)
    .is("accepted_at", null)
    .is("revoked_at", null)
    .gt("expires_at", new Date().toISOString())
    .maybeSingle();

  if (existing) return mapInvitationRow(existing as InvitationRow);

  const token = generateToken();
  const { data, error } = await db
    .from("canvas_invitations")
    .insert({
      canvas_id: input.canvasId,
      email: normalizedEmail,
      invited_role: input.role,
      invited_by: input.invitedBy,
      token,
      expires_at: expiresAtFromNow(input.ttlDays),
    })
    .select(INVITATION_COLS)
    .single();
  if (error || !data) {
    throw error || new Error("Failed to create invitation");
  }
  return mapInvitationRow(data as InvitationRow);
}

export async function listCanvasInvitations(
  canvasId: string,
  callerId: string
): Promise<Invitation[]> {
  await requireRole(canvasId, callerId, "admin");
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("canvas_invitations")
    .select(INVITATION_COLS)
    .eq("canvas_id", canvasId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return ((data ?? []) as InvitationRow[]).map(mapInvitationRow);
}

export async function revokeInvitation(
  invitationId: string,
  callerId: string
): Promise<void> {
  const db = supabaseAdmin();
  const { data: row, error } = await db
    .from("canvas_invitations")
    .select(INVITATION_COLS)
    .eq("id", invitationId)
    .maybeSingle();
  if (error) throw error;
  if (!row) {
    throw new HttpError(404, "INVITATION_NOT_FOUND", "Invitation not found");
  }
  const inv = mapInvitationRow(row as InvitationRow);
  await requireRole(inv.canvasId, callerId, "admin");

  if (inv.acceptedAt) {
    throw new HttpError(
      409,
      "INVITATION_ALREADY_ACCEPTED",
      "This invitation was already accepted"
    );
  }
  if (inv.revokedAt) return; // Already revoked, idempotent.

  const { error: updateError } = await db
    .from("canvas_invitations")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", invitationId);
  if (updateError) throw updateError;
}

/**
 * Look up an invitation by token + return enough context for the
 * accept-invite page to render: canvas name, inviter email, expiry,
 * etc. Does NOT require auth — anyone with the token can read its
 * status (the security property is the token's unguessability).
 */
export async function getInvitationByToken(
  token: string
): Promise<InvitationStatus | null> {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("canvas_invitations")
    .select(INVITATION_COLS)
    .eq("token", token)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;

  const invitation = mapInvitationRow(data as InvitationRow);
  const canvas = await findCanvasById(invitation.canvasId);
  if (!canvas) return null;

  // Inviter's email — fetch via auth admin to avoid exposing more than
  // the email address (no metadata, no roles).
  let inviterEmail: string | null = null;
  try {
    const { data: userRes } = await db.auth.admin.getUserById(
      invitation.invitedBy
    );
    inviterEmail = userRes?.user?.email ?? null;
  } catch {
    inviterEmail = null;
  }

  const now = Date.now();
  return {
    invitation,
    canvas: {
      id: canvas.id,
      slug: canvas.slug,
      name: canvas.name,
    },
    inviter: {
      id: invitation.invitedBy,
      email: inviterEmail,
    },
    expired: new Date(invitation.expiresAt).getTime() < now,
    revoked: invitation.revokedAt !== null,
    alreadyAccepted: invitation.acceptedAt !== null,
  };
}

/**
 * Accept an invitation. The caller must be authenticated; we use their
 * authenticated identity to populate `accepted_by` and the resulting
 * `canvas_members` row. Returns the joined canvas slug so the caller
 * can redirect to `/canvas/<slug>`.
 */
export async function acceptInvitationByToken(
  token: string,
  userId: string
): Promise<{ canvasSlug: string }> {
  const status = await getInvitationByToken(token);
  if (!status) {
    throw new HttpError(404, "INVITATION_NOT_FOUND", "Invitation not found");
  }
  if (status.revoked) {
    throw new HttpError(410, "INVITATION_REVOKED", "Invitation was revoked");
  }
  if (status.expired) {
    throw new HttpError(410, "INVITATION_EXPIRED", "Invitation has expired");
  }
  if (status.alreadyAccepted) {
    // Already accepted — if the caller is the same user, treat as a
    // no-op success so a duplicate click doesn't 410.
    if (status.invitation.acceptedBy === userId) {
      return { canvasSlug: status.canvas.slug };
    }
    throw new HttpError(
      410,
      "INVITATION_ALREADY_ACCEPTED",
      "This invitation has already been used"
    );
  }

  const db = supabaseAdmin();

  // Existing membership (e.g. invited user happens to already be the
  // owner) — promote silently to active and return.
  const existingMembership = await findMembership(
    status.invitation.canvasId,
    userId
  );
  if (existingMembership && existingMembership.status === "active") {
    await db
      .from("canvas_invitations")
      .update({
        accepted_at: new Date().toISOString(),
        accepted_by: userId,
      })
      .eq("id", status.invitation.id);
    return { canvasSlug: status.canvas.slug };
  }

  // Insert (or revive) the membership row. Use upsert keyed on
  // (canvas_id, user_id) so a previously-revoked member rejoining
  // doesn't trip the unique constraint.
  const { error: memberError } = await db.from("canvas_members").upsert(
    {
      canvas_id: status.invitation.canvasId,
      user_id: userId,
      role: status.invitation.invitedRole,
      status: "active",
      invited_by: status.invitation.invitedBy,
      invited_at: status.invitation.createdAt,
      joined_at: new Date().toISOString(),
    },
    { onConflict: "canvas_id,user_id" }
  );
  if (memberError) throw memberError;

  const { error: invError } = await db
    .from("canvas_invitations")
    .update({
      accepted_at: new Date().toISOString(),
      accepted_by: userId,
    })
    .eq("id", status.invitation.id);
  if (invError) throw invError;

  return { canvasSlug: status.canvas.slug };
}

/**
 * Update a member's role. Owner can promote/demote anyone (including
 * themselves), admin can manage editor/viewer but never owners or
 * admins. Refuses to demote the last remaining owner (the canvas would
 * be unrecoverable).
 */
export async function updateMemberRole(
  canvasId: string,
  callerId: string,
  targetUserId: string,
  newRole: Role
): Promise<void> {
  const { role: callerRole } = await requireRole(canvasId, callerId, "admin");

  const target = await findMembership(canvasId, targetUserId);
  if (!target || target.status !== "active") {
    throw new HttpError(404, "MEMBER_NOT_FOUND", "Member not found");
  }

  // Admin cannot touch owners or other admins.
  if (callerRole === "admin" && (target.role === "owner" || target.role === "admin")) {
    throw new HttpError(
      403,
      "CANVAS_FORBIDDEN",
      "Admins can only change editor / viewer roles"
    );
  }
  // Admin cannot promote anyone to owner or admin.
  if (callerRole === "admin" && (newRole === "owner" || newRole === "admin")) {
    throw new HttpError(
      403,
      "CANVAS_FORBIDDEN",
      "Only the owner can grant admin or owner roles"
    );
  }

  // Last-owner protection.
  if (target.role === "owner" && newRole !== "owner") {
    const ownerCount = await countActiveOwners(canvasId);
    if (ownerCount <= 1) {
      throw new HttpError(
        409,
        "CANVAS_LAST_OWNER",
        "Cannot demote the last owner — promote another member to owner first"
      );
    }
  }

  const db = supabaseAdmin();
  const { error } = await db
    .from("canvas_members")
    .update({ role: newRole })
    .eq("canvas_id", canvasId)
    .eq("user_id", targetUserId);
  if (error) throw error;
}

/**
 * Remove a member. Owner can remove anyone (including themselves, with
 * last-owner protection). Admin can remove editor/viewer only.
 */
export async function removeMember(
  canvasId: string,
  callerId: string,
  targetUserId: string
): Promise<void> {
  const { role: callerRole } = await requireRole(canvasId, callerId, "admin");

  const target = await findMembership(canvasId, targetUserId);
  if (!target || target.status !== "active") {
    return; // Idempotent — nothing to remove.
  }

  if (callerRole === "admin" && (target.role === "owner" || target.role === "admin")) {
    throw new HttpError(
      403,
      "CANVAS_FORBIDDEN",
      "Admins cannot remove owners or admins"
    );
  }

  if (target.role === "owner") {
    const ownerCount = await countActiveOwners(canvasId);
    if (ownerCount <= 1) {
      throw new HttpError(
        409,
        "CANVAS_LAST_OWNER",
        "Cannot remove the last owner — transfer ownership first"
      );
    }
  }

  const db = supabaseAdmin();
  const { error } = await db
    .from("canvas_members")
    .delete()
    .eq("canvas_id", canvasId)
    .eq("user_id", targetUserId);
  if (error) throw error;
}

async function countActiveOwners(canvasId: string): Promise<number> {
  const db = supabaseAdmin();
  const { count, error } = await db
    .from("canvas_members")
    .select("user_id", { count: "exact", head: true })
    .eq("canvas_id", canvasId)
    .eq("status", "active")
    .eq("role", "owner");
  if (error) throw error;
  return count ?? 0;
}

/**
 * Lookup helper used by the members API — confirms the caller can read
 * the member list (any active member can; admin gates apply only to
 * write actions).
 */
export async function ensureCanRead(
  canvasId: string,
  userId: string
): Promise<void> {
  await resolveMembershipOrThrow(canvasId, userId);
}
