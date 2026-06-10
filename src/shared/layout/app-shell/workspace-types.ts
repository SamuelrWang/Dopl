import type { Role } from "@/features/workspaces/types";

/**
 * The slice of a workspace the AppShell rail needs. Sourced from
 * `GET /api/workspaces` (which returns role + iconUrl per workspace).
 */
export interface WorkspaceLike {
  id: string;
  name: string;
  slug: string;
  publicId: string;
  iconUrl: string | null;
  role: Role;
}

/**
 * A pending workspace invitation for the signed-in user. Sourced from
 * `GET /api/invitations/pending`; accepted via
 * `POST /api/workspaces/invitations/[token]/accept`. (Surface TBD in the
 * AppShell — see the pending-invitations task.)
 */
export interface PendingInvitation {
  token: string;
  invitedRole: string;
  workspaceId: string;
  workspaceSlug: string;
  workspacePublicId: string;
  workspaceName: string;
  createdAt: string;
}
