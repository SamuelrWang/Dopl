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
import { findWorkspaceById, findMembership } from "./repository";
import { resolveMembershipOrThrow } from "./service";
import {
  insertTeamMembers,
  listInvitationTeamIds,
  listTeamsForWorkspace,
  replaceInvitationTeams,
} from "@/features/teams/server/repository";

const INVITATION_COLS =
  "id, workspace_id, email, invited_role, invited_by, token, expires_at, accepted_at, accepted_by, revoked_at, created_at";

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
  workspaceId: string,
  userId: string,
  minRole: Role
): Promise<{ role: Role }> {
  const membership = await findMembership(workspaceId, userId);
  if (!membership || membership.status !== "active") {
    throw new HttpError(404, "WORKSPACE_NOT_FOUND", "Workspace not found");
  }
  if (!meetsMinRole(membership.role, minRole)) {
    throw new HttpError(
      403,
      "WORKSPACE_FORBIDDEN",
      `Requires ${minRole} role or higher`
    );
  }
  return { role: membership.role };
}

export interface CreateInvitationInput {
  workspaceId: string;
  invitedBy: string;
  email: string;
  role: InvitedRole;
  /** Teams the invitee auto-joins on accept. Must belong to the workspace. */
  teamIds?: string[];
  ttlDays?: number;
}

/**
 * Create a pending invitation. Caller must be admin or owner of the
 * workspace. Idempotent on (workspace_id, email): if a non-revoked, non-
 * expired invitation already exists for this email, return it instead
 * of creating a duplicate. The invitee picks up the invite via the
 * sidebar (email-matched) — no email send is wired.
 */
export async function createInvitation(
  input: CreateInvitationInput
): Promise<Invitation> {
  await requireRole(input.workspaceId, input.invitedBy, "admin");

  const normalizedEmail = input.email.trim().toLowerCase();
  if (!normalizedEmail) {
    throw new HttpError(400, "INVALID_EMAIL", "Email is required");
  }

  const db = supabaseAdmin();

  // Reuse a still-live invitation rather than spamming new tokens for
  // the same email. Only re-issue if the previous one is gone.
  const { data: existing } = await db
    .from("workspace_invitations")
    .select(INVITATION_COLS)
    .eq("workspace_id", input.workspaceId)
    .eq("email", normalizedEmail)
    .is("accepted_at", null)
    .is("revoked_at", null)
    .gt("expires_at", new Date().toISOString())
    .maybeSingle();

  const teamIds = await validateInvitationTeams(input.workspaceId, input.teamIds);

  if (existing) {
    // Reusing a live invitation: refresh its team pre-assignment when the
    // caller specified one (an omitted teamIds leaves the prior set alone).
    const inv = mapInvitationRow(existing as InvitationRow);
    if (input.teamIds !== undefined) {
      await replaceInvitationTeams(inv.id, teamIds);
    }
    return { ...inv, teamIds: await listInvitationTeamIds(inv.id) };
  }

  const token = generateToken();
  const { data, error } = await db
    .from("workspace_invitations")
    .insert({
      workspace_id: input.workspaceId,
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
  const invitation = mapInvitationRow(data as InvitationRow);
  if (teamIds.length > 0) {
    await replaceInvitationTeams(invitation.id, teamIds);
  }
  return { ...invitation, teamIds };
}

/** Validate the invite's teams belong to this workspace; returns the deduped set. */
async function validateInvitationTeams(
  workspaceId: string,
  teamIds: string[] | undefined
): Promise<string[]> {
  const ids = [...new Set(teamIds ?? [])];
  if (ids.length === 0) return [];
  const teams = await listTeamsForWorkspace(workspaceId);
  const known = new Set(teams.map((t) => t.id));
  const unknown = ids.filter((id) => !known.has(id));
  if (unknown.length > 0) {
    throw new HttpError(400, "TEAM_NOT_FOUND", "Some teams do not exist in this workspace", {
      teamIds: unknown,
    });
  }
  return ids;
}

export async function listWorkspaceInvitations(
  workspaceId: string,
  callerId: string
): Promise<Invitation[]> {
  await requireRole(workspaceId, callerId, "admin");
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("workspace_invitations")
    .select(INVITATION_COLS)
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  const invitations = ((data ?? []) as InvitationRow[]).map(mapInvitationRow);
  if (invitations.length === 0) return invitations;

  // Hydrate pre-assigned teams in one query for the pending-invites UI.
  const { data: teamRows, error: teamError } = await db
    .from("workspace_invitation_teams")
    .select("invitation_id, team_id")
    .in("invitation_id", invitations.map((i) => i.id));
  if (teamError) throw teamError;
  const teamsByInvitation = new Map<string, string[]>();
  for (const row of (teamRows ?? []) as Array<{ invitation_id: string; team_id: string }>) {
    const list = teamsByInvitation.get(row.invitation_id) ?? [];
    list.push(row.team_id);
    teamsByInvitation.set(row.invitation_id, list);
  }
  return invitations.map((i) => ({ ...i, teamIds: teamsByInvitation.get(i.id) ?? [] }));
}

export async function revokeInvitation(
  invitationId: string,
  callerId: string
): Promise<void> {
  const db = supabaseAdmin();
  const { data: row, error } = await db
    .from("workspace_invitations")
    .select(INVITATION_COLS)
    .eq("id", invitationId)
    .maybeSingle();
  if (error) throw error;
  if (!row) {
    throw new HttpError(404, "INVITATION_NOT_FOUND", "Invitation not found");
  }
  const inv = mapInvitationRow(row as InvitationRow);
  await requireRole(inv.workspaceId, callerId, "admin");

  if (inv.acceptedAt) {
    throw new HttpError(
      409,
      "INVITATION_ALREADY_ACCEPTED",
      "This invitation was already accepted"
    );
  }
  if (inv.revokedAt) return; // Already revoked, idempotent.

  const { error: updateError } = await db
    .from("workspace_invitations")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", invitationId);
  if (updateError) throw updateError;
}

/**
 * Look up an invitation by token + return enough context for the
 * accept-invite page to render: workspace name, inviter email, expiry,
 * etc. Does NOT require auth — anyone with the token can read its
 * status (the security property is the token's unguessability).
 */
export async function getInvitationByToken(
  token: string
): Promise<InvitationStatus | null> {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("workspace_invitations")
    .select(INVITATION_COLS)
    .eq("token", token)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;

  const invitation = mapInvitationRow(data as InvitationRow);
  const workspace = await findWorkspaceById(invitation.workspaceId);
  if (!workspace) return null;

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
    workspace: {
      id: workspace.id,
      slug: workspace.slug,
      publicId: workspace.publicId,
      name: workspace.name,
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
 * `workspace_members` row. Returns `{ workspaceSlug, workspacePublicId }`
 * so the caller can build the canonical `/<slug>-<publicId>` redirect.
 */
export async function acceptInvitationByToken(
  token: string,
  userId: string
): Promise<{ workspaceSlug: string; workspacePublicId: string }> {
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
      return {
        workspaceSlug: status.workspace.slug,
        workspacePublicId: status.workspace.publicId,
      };
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
    status.invitation.workspaceId,
    userId
  );
  if (existingMembership && existingMembership.status === "active") {
    await db
      .from("workspace_invitations")
      .update({
        accepted_at: new Date().toISOString(),
        accepted_by: userId,
      })
      .eq("id", status.invitation.id);
    await joinInvitationTeams(status.invitation.id, status.invitation.workspaceId, userId);
    return {
      workspaceSlug: status.workspace.slug,
      workspacePublicId: status.workspace.publicId,
    };
  }

  // Insert (or revive) the membership row. Use upsert keyed on
  // (workspace_id, user_id) so a previously-revoked member rejoining
  // doesn't trip the unique constraint.
  const { error: memberError } = await db.from("workspace_members").upsert(
    {
      workspace_id: status.invitation.workspaceId,
      user_id: userId,
      role: status.invitation.invitedRole,
      status: "active",
      invited_by: status.invitation.invitedBy,
      invited_at: status.invitation.createdAt,
      joined_at: new Date().toISOString(),
    },
    { onConflict: "workspace_id,user_id" }
  );
  if (memberError) throw memberError;

  const { error: invError } = await db
    .from("workspace_invitations")
    .update({
      accepted_at: new Date().toISOString(),
      accepted_by: userId,
    })
    .eq("id", status.invitation.id);
  if (invError) throw invError;

  // Membership is active now, so the team_members trigger accepts the rows.
  await joinInvitationTeams(status.invitation.id, status.invitation.workspaceId, userId);

  return {
    workspaceSlug: status.workspace.slug,
    workspacePublicId: status.workspace.publicId,
  };
}

/**
 * Best-effort: add the accepting user to the invite's pre-assigned teams.
 * Teams deleted since the invite cascade off the junction automatically;
 * a residual failure logs and never blocks the accept.
 */
async function joinInvitationTeams(
  invitationId: string,
  workspaceId: string,
  userId: string
): Promise<void> {
  try {
    const teamIds = await listInvitationTeamIds(invitationId);
    for (const teamId of teamIds) {
      await insertTeamMembers(teamId, workspaceId, [userId], null);
    }
  } catch (err) {
    console.error(
      `[invitations] Failed to join pre-assigned teams for invitation ${invitationId}:`,
      err instanceof Error ? err.message : err
    );
  }
}

export interface PendingInvitationForUser {
  token: string;
  invitedRole: InvitedRole;
  workspaceId: string;
  workspaceSlug: string;
  workspacePublicId: string;
  workspaceName: string;
  createdAt: string;
}

/**
 * List the live (unaccepted, unrevoked, unexpired) invitations addressed
 * to a given email. Used by the sidebar to surface "you've been invited"
 * notifications + accept buttons.
 */
export async function listPendingInvitationsForUser(
  email: string
): Promise<PendingInvitationForUser[]> {
  const normalized = email.trim().toLowerCase();
  if (!normalized) return [];

  const db = supabaseAdmin();
  const { data, error } = await db
    .from("workspace_invitations")
    .select(
      `${INVITATION_COLS}, workspace:workspaces!inner(id, slug, public_id, name)`
    )
    .eq("email", normalized)
    .is("accepted_at", null)
    .is("revoked_at", null)
    .gt("expires_at", new Date().toISOString())
    .order("created_at", { ascending: false });
  if (error) throw error;

  type WorkspaceJoin = {
    id: string;
    slug: string;
    public_id: string;
    name: string;
  };
  type Row = InvitationRow & {
    workspace: WorkspaceJoin | WorkspaceJoin[] | null;
  };

  return ((data ?? []) as unknown as Row[])
    .map((r) => {
      const ws = Array.isArray(r.workspace) ? r.workspace[0] : r.workspace;
      if (!ws) return null;
      return {
        token: r.token,
        invitedRole: r.invited_role,
        workspaceId: ws.id,
        workspaceSlug: ws.slug,
        workspacePublicId: ws.public_id,
        workspaceName: ws.name,
        createdAt: r.created_at,
      };
    })
    .filter((r): r is PendingInvitationForUser => r !== null);
}

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
  const { role: callerRole } = await requireRole(workspaceId, callerId, "admin");

  const target = await findMembership(workspaceId, targetUserId);
  if (!target || target.status !== "active") {
    throw new HttpError(404, "MEMBER_NOT_FOUND", "Member not found");
  }

  // Self-demote block: an admin cannot change their own role. They must
  // be demoted by another admin or the owner. Owners can still change
  // their own role (last-owner protection below catches the unsafe case).
  if (callerRole === "admin" && targetUserId === callerId) {
    throw new HttpError(
      403,
      "WORKSPACE_FORBIDDEN",
      "You cannot change your own role — ask another admin or the owner"
    );
  }

  // Admin cannot touch owners or other admins.
  if (callerRole === "admin" && (target.role === "owner" || target.role === "admin")) {
    throw new HttpError(
      403,
      "WORKSPACE_FORBIDDEN",
      "Admins can only change member / viewer roles"
    );
  }
  // Admin cannot promote anyone to owner or admin.
  if (callerRole === "admin" && (newRole === "owner" || newRole === "admin")) {
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
 */
export async function removeMember(
  workspaceId: string,
  callerId: string,
  targetUserId: string
): Promise<void> {
  const { role: callerRole } = await requireRole(workspaceId, callerId, "admin");

  const target = await findMembership(workspaceId, targetUserId);
  if (!target || target.status !== "active") {
    return; // Idempotent — nothing to remove.
  }

  if (callerRole === "admin" && (target.role === "owner" || target.role === "admin")) {
    throw new HttpError(
      403,
      "WORKSPACE_FORBIDDEN",
      "Admins cannot remove owners or admins"
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
}

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

/**
 * Lookup helper used by the members API — confirms the caller can read
 * the member list (any active member can; admin gates apply only to
 * write actions).
 */
export async function ensureCanRead(
  workspaceId: string,
  userId: string
): Promise<void> {
  await resolveMembershipOrThrow(workspaceId, userId);
}
