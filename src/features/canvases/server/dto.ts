import "server-only";
import type {
  Canvas,
  CanvasMembership,
  Invitation,
  InvitedRole,
  MembershipStatus,
  Role,
} from "../types";

export interface CanvasRow {
  id: string;
  owner_id: string;
  name: string;
  slug: string;
  description: string | null;
  created_at: string;
  updated_at: string;
}

export interface CanvasMemberRow {
  canvas_id: string;
  user_id: string;
  role: Role;
  status: MembershipStatus;
  joined_at: string;
  invited_by: string | null;
  invited_at: string | null;
}

export function mapCanvasRow(row: CanvasRow): Canvas {
  return {
    id: row.id,
    ownerId: row.owner_id,
    name: row.name,
    slug: row.slug,
    description: row.description,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function mapMemberRow(row: CanvasMemberRow): CanvasMembership {
  return {
    canvasId: row.canvas_id,
    userId: row.user_id,
    role: row.role,
    status: row.status,
    joinedAt: row.joined_at,
    invitedBy: row.invited_by,
    invitedAt: row.invited_at,
  };
}

export interface InvitationRow {
  id: string;
  canvas_id: string;
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
    canvasId: row.canvas_id,
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
