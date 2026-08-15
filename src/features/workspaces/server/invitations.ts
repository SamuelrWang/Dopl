import "server-only";
import { randomBytes } from "crypto";
import { HttpError } from "@/shared/lib/http-error";
import { supabaseAdmin } from "@/shared/supabase/admin";
import type {
  Invitation,
  InvitationStatus,
  InvitedRole,
} from "../types";
import { assertCanAddMember } from "@/features/billing/server/entitlements";
import { syncSeatQuantity } from "@/features/billing/server/seats";
import { requireWorkspaceRole } from "./authz";
import {
  type InvitationRow,
  mapInvitationRow,
} from "./dto";
import { findWorkspaceById, findMembership } from "./repository";
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
 * URL-safe random invitation token. 32 bytes → 43 base64url chars. Stored in
 * cleartext: the table is service-role scoped and the token's existence is
 * deliberately tied to the email.
 */
function generateToken(): string {
  return randomBytes(32).toString("base64url");
}

function expiresAtFromNow(ttlDays = DEFAULT_TTL_DAYS): string {
  return new Date(Date.now() + ttlDays * 24 * 60 * 60 * 1000).toISOString();
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
 * Create a pending invitation. Admin/owner only. Idempotent on
 * (workspace_id, email): a live non-revoked invitation is returned instead of
 * duplicated. ⚠ No email send is wired — the invitee picks it up via the
 * email-matched sidebar.
 */
export async function createInvitation(
  input: CreateInvitationInput
): Promise<Invitation> {
  await requireWorkspaceRole(input.workspaceId, input.invitedBy, "admin");

  // ⚠ Solo is single-member — EVERY member-add path must gate. Fail fast so
  // the 402 lands on click, before minting a token that could never be used.
  await assertCanAddMember(input.workspaceId);

  const normalizedEmail = input.email.trim().toLowerCase();
  if (!normalizedEmail) {
    throw new HttpError(400, "INVALID_EMAIL", "Email is required");
  }

  const db = supabaseAdmin();

  // Reuse a still-live invitation; only re-issue when the previous is gone.
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
    // Reused invitation: refresh team pre-assignment only when specified
    // (omitted teamIds leaves the prior set alone).
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
  await requireWorkspaceRole(workspaceId, callerId, "admin");
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
  await requireWorkspaceRole(inv.workspaceId, callerId, "admin");

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
 * Invitation by token + context for the accept-invite page. ⚠ Does NOT require
 * auth — the security property is the token's unguessability.
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

  // Auth admin fetch so nothing but the email address is exposed.
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
 * Accept an invitation, using the caller's AUTHENTICATED identity for
 * `accepted_by` and the `workspace_members` row. Returns
 * `{ workspaceSlug, workspacePublicId }` for the canonical redirect.
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
    // Same user re-accepting: no-op success so a duplicate click doesn't 410.
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

  // Existing membership (e.g. invitee is already the owner) — activate.
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

  // ⚠ Re-check at ACCEPT time, not just invite time: an invite sent while
  // free/team survives a later downgrade to Solo. The already-active no-op
  // above is deliberately NOT gated — it adds no seat.
  await assertCanAddMember(status.invitation.workspaceId);

  // Upsert on (workspace_id, user_id) so a rejoining revoked member does not
  // trip the unique constraint.
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

  // Reconcile the Pro subscription quantity. Best-effort: a billing hiccup
  // must not fail the join.
  await syncSeatQuantity(status.invitation.workspaceId).catch((err) => {
    console.error(
      `[invitations] syncSeatQuantity failed for workspace ${status.invitation.workspaceId}:`,
      err instanceof Error ? err.message : err
    );
  });

  return {
    workspaceSlug: status.workspace.slug,
    workspacePublicId: status.workspace.publicId,
  };
}

/**
 * Best-effort: add the accepting user to the invite's pre-assigned teams.
 * Deleted teams cascade off the junction; a residual failure never blocks
 * the accept.
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

/**
 * `updateMemberRole` / `removeMember` live in `membership-admin.ts` (§2 split).
 * Re-exported here because callers import them from this path
 * (`api/workspaces/[workspaceSlug]/members/[userId]/route.ts`) — same barrel
 * shape as `teams/server/repository.ts`.
 */
export { updateMemberRole, removeMember } from "./membership-admin";


