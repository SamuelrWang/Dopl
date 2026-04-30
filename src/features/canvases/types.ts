export type Role = "owner" | "admin" | "editor" | "viewer";

export type InvitedRole = "admin" | "editor" | "viewer";

export type MembershipStatus = "pending" | "active" | "revoked";

export interface Invitation {
  id: string;
  canvasId: string;
  email: string;
  invitedRole: InvitedRole;
  invitedBy: string;
  token: string;
  expiresAt: string;
  acceptedAt: string | null;
  acceptedBy: string | null;
  revokedAt: string | null;
  createdAt: string;
}

export interface InvitationStatus {
  invitation: Invitation;
  canvas: {
    id: string;
    slug: string;
    name: string;
  };
  inviter: {
    id: string;
    email: string | null;
  };
  expired: boolean;
  revoked: boolean;
  alreadyAccepted: boolean;
}

export interface Canvas {
  id: string;
  ownerId: string;
  name: string;
  slug: string;
  description: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CanvasMembership {
  canvasId: string;
  userId: string;
  role: Role;
  status: MembershipStatus;
  joinedAt: string;
  invitedBy: string | null;
  invitedAt: string | null;
}

/**
 * Numeric ranking used by `withCanvasAuth({ minRole })` to gate routes.
 * Higher = more privileges. owner > admin > editor > viewer.
 */
export const ROLE_RANK: Record<Role, number> = {
  viewer: 0,
  editor: 1,
  admin: 2,
  owner: 3,
};

export function meetsMinRole(actual: Role, min: Role): boolean {
  return ROLE_RANK[actual] >= ROLE_RANK[min];
}
