import type { Role } from "@/features/workspaces/types";

/**
 * The slice of a workspace the sidebar switcher needs. Sourced from
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

export interface PendingInvitation {
  token: string;
  invitedRole: string;
  workspaceId: string;
  workspaceSlug: string;
  workspacePublicId: string;
  workspaceName: string;
  createdAt: string;
}
