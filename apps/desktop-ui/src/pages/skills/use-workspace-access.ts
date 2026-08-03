import { useApiQuery } from "#/hooks/use-api-query";
import { meetsMinRole, type Role, type Workspace } from "@/features/workspaces/types";

/**
 * The three values every ported page used to get for free as RSC props —
 * `workspaceId`, the caller's `role`/`isAdmin`, and `currentUserId` — resolved
 * from the URL segment over the API.
 *
 * Two existing routes, no new surface:
 *   1. `GET /api/workspaces/resolve?segment=` — the HTTP twin of
 *      `resolvePageWorkspace` (docs/migration-research/api-surface.md §5).
 *      Accepts the canonical `{slug}-{publicId}` form AND legacy slug-only
 *      URLs, and reports `canonical`/`needsRedirect` so the shell can rewrite
 *      a stale segment (the SPA replaces history where the page 301'd).
 *   2. `GET /api/workspaces/me` with the resolved id as `X-Workspace-Id` —
 *      `{ workspace, role, userId }`, i.e. `resolveMembershipOrThrow` plus the
 *      caller's id in one round trip.
 *
 * This lives under `pages/skills/` on purpose: it is a stopgap for pages
 * rendered STANDALONE, before the app shell exists. The shell resolves the
 * same workspace once for the whole tree and mounts `MyAccessProvider`; when
 * it lands, this hook collapses into reading the shell's context. The query
 * keys are the plain `[path, workspaceId, query]` contract, so the shell's
 * identical calls share these cache entries rather than duplicating them.
 */

interface ResolvePayload {
  workspace: Workspace;
  canonical: string;
  needsRedirect: boolean;
}

interface MePayload {
  role: Role;
  userId: string;
}

export interface WorkspaceAccess {
  workspaceId: string;
  /** Canonical `{slug}-{publicId}` segment — what links must be built from. */
  workspaceSlug: string;
  currentUserId: string;
  role: Role;
  isAdmin: boolean;
}

export interface UseWorkspaceAccessResult {
  access: WorkspaceAccess | null;
  isPending: boolean;
  error: unknown;
  refetch: () => void;
}

export function useWorkspaceAccess(segment: string): UseWorkspaceAccessResult {
  const resolved = useApiQuery<ResolvePayload>(
    segment ? "/api/workspaces/resolve" : null,
    { query: { segment } }
  );
  const workspaceId = resolved.data?.workspace.id;

  const me = useApiQuery<MePayload>("/api/workspaces/me", {
    workspaceId,
    enabled: workspaceId !== undefined,
  });

  const access: WorkspaceAccess | null =
    resolved.data && me.data
      ? {
          workspaceId: resolved.data.workspace.id,
          workspaceSlug: resolved.data.canonical,
          currentUserId: me.data.userId,
          role: me.data.role,
          isAdmin: meetsMinRole(me.data.role, "admin"),
        }
      : null;

  return {
    access,
    isPending: resolved.isPending || (workspaceId !== undefined && me.isPending),
    error: resolved.error ?? me.error,
    refetch: () => {
      void resolved.refetch();
      void me.refetch();
    },
  };
}
