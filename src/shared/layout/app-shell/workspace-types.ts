import type { Role, WorkspaceKind } from "@/features/workspaces/types";

/**
 * Slice of a workspace the AppShell rail needs. From `GET /api/workspaces`,
 * which is UNFILTERED — carry `kind` through and let every list filter with
 * `features/workspaces/types.ts › isStandardWorkspace`.
 */
export interface WorkspaceLike {
  id: string;
  name: string;
  slug: string;
  publicId: string;
  iconUrl: string | null;
  kind?: WorkspaceKind;
  role: Role;
}
