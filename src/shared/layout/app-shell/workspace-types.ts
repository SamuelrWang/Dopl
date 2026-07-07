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
