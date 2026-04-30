export type Role = "owner" | "admin" | "editor" | "viewer";

export type InvitedRole = "admin" | "editor" | "viewer";

export type MembershipStatus = "pending" | "active" | "revoked";

export interface Invitation {
  id: string;
  workspaceId: string;
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
  workspace: {
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

export interface Workspace {
  id: string;
  ownerId: string;
  name: string;
  slug: string;
  description: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * A canvas is a page/view inside a workspace. Today every workspace has
 * exactly one (slug='main'); the table is in place so multi-canvas can
 * land later without a schema migration. Distinct from the infinite-
 * canvas UI feature in `src/features/canvas/` — this is the persistent
 * entity, that is the renderer.
 */
export interface WorkspaceCanvas {
  id: string;
  workspaceId: string;
  name: string;
  slug: string;
  createdAt: string;
  updatedAt: string;
}

export interface WorkspaceMembership {
  workspaceId: string;
  userId: string;
  role: Role;
  status: MembershipStatus;
  joinedAt: string;
  invitedBy: string | null;
  invitedAt: string | null;
}

/**
 * Numeric ranking used by `withWorkspaceAuth({ minRole })` to gate routes.
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
