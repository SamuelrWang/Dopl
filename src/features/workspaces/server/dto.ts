import "server-only";
import { meetsMinRole } from "../types";
import type {
  Workspace,
  WorkspaceKind,
  WorkspaceMembership,
  Invitation,
  InvitedRole,
  MembershipStatus,
  Role,
} from "../types";

export interface WorkspaceRow {
  id: string;
  owner_id: string;
  name: string;
  slug: string;
  public_id: string;
  description: string | null;
  icon_url: string | null;
  /**
   * ⚠ STILL OPTIONAL after `20260823150000` applied (2026-08-24). The column is
   * `NOT NULL DEFAULT 'standard'`, so every row PostgREST returns now carries
   * it — but the type stays optional because absent must keep reading as
   * standard (`types.ts › isStandardWorkspace`), and every fixture in the
   * suites builds a row without it.
   */
  kind?: WorkspaceKind;
  created_at: string;
  updated_at: string;
}

export interface WorkspaceMemberRow {
  workspace_id: string;
  user_id: string;
  role: Role;
  status: MembershipStatus;
  joined_at: string;
  invited_by: string | null;
  invited_at: string | null;
  last_seen_at: string | null;
}

export function mapWorkspaceRow(row: WorkspaceRow): Workspace {
  return {
    id: row.id,
    ownerId: row.owner_id,
    name: row.name,
    slug: row.slug,
    publicId: row.public_id,
    description: row.description,
    iconUrl: row.icon_url,
    // ⚠ Spread-when-present, never `kind: row.kind`: on today's database the
    // column does not exist, and an explicit `undefined` would change the DTO
    // (and every `toStrictEqual`) for a change that has not happened yet.
    ...(row.kind ? { kind: row.kind } : {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function mapMemberRow(row: WorkspaceMemberRow): WorkspaceMembership {
  return {
    workspaceId: row.workspace_id,
    userId: row.user_id,
    role: row.role,
    status: row.status,
    joinedAt: row.joined_at,
    invitedBy: row.invited_by,
    invitedAt: row.invited_at,
    lastSeenAt: row.last_seen_at,
  };
}

/**
 * 🔒 **`showPresence`, SERVER-SIDE — Samuel's ruling R-12(a), 2026-09-17.**
 * `lastSeenAt` is nulled on every row the CALLER may not see presence for, so a
 * hidden presence never crosses the wire.
 *
 * ⚠ **THE RULE IS THE CONSOLE'S OWN, NOT A SECOND ONE**:
 * `members/components/members-v2/visibility.ts › showPresence` is
 * `isAdmin || isSelf`, and this is that expression. The two move together;
 * `docs/MEMBERS-AUTHORIZATION.md` carries why.
 *
 * ⚠ **`null` MEANS "NOT YOURS TO SEE" HERE, EXACTLY AS IT DOES ON THE CHANNEL
 * ROSTER'S VIEWER-ONLY FIELDS** (`channels/server/dto.ts › mapMemberRow`) — it
 * does NOT mean "never seen", and nothing may read it as a heartbeat.
 */
export function scrubHiddenPresence(
  members: WorkspaceMembership[],
  callerId: string,
  callerRole: Role
): WorkspaceMembership[] {
  if (meetsMinRole(callerRole, "admin")) return members;
  return members.map((m) =>
    m.userId === callerId ? m : { ...m, lastSeenAt: null }
  );
}

export interface InvitationRow {
  id: string;
  workspace_id: string;
  email: string;
  invited_role: InvitedRole;
  invited_by: string;
  token: string;
  expires_at: string;
  accepted_at: string | null;
  accepted_by: string | null;
  revoked_at: string | null;
  created_at: string;
}

export function mapInvitationRow(row: InvitationRow): Invitation {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    email: row.email,
    invitedRole: row.invited_role,
    invitedBy: row.invited_by,
    token: row.token,
    expiresAt: row.expires_at,
    acceptedAt: row.accepted_at,
    acceptedBy: row.accepted_by,
    revokedAt: row.revoked_at,
    createdAt: row.created_at,
  };
}
