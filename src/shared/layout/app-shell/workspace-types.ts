import type { Role } from "@/features/workspaces/types";

/** Slice of a workspace the AppShell rail needs. From `GET /api/workspaces`. */
export interface WorkspaceLike {
  id: string;
  name: string;
  slug: string;
  publicId: string;
  iconUrl: string | null;
  role: Role;
}
