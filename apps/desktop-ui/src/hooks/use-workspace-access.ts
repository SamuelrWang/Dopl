import { meetsMinRole, type Role } from "@/features/workspaces/types";
import { useWorkspaceRoute } from "#/components/app-shell";
import { useApiQuery } from "#/hooks/use-api-query";

/**
 * The three values every ported page used to get as RSC props — `workspaceId`,
 * `role`/`isAdmin`, `currentUserId` — all from ONE read.
 *
 * ⚠ Must keep sharing `useWorkspaceRoute`'s boot query, not resolve the segment
 * itself: one boot query serves the shell and every page. A second resolver
 * only avoids double-fetching while its query key stays byte-identical by hand.
 *
 * The `me` query survives ONLY as a fallback for a server whose boot answer
 * carries no identity; disabled whenever the route already knows, so in
 * practice this hook issues no request.
 *
 * Segment comes from the router (`useParams`) — hence no argument.
 */

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

export function useWorkspaceAccess(): UseWorkspaceAccessResult {
  const route = useWorkspaceRoute();
  const workspaceId = route.workspace?.id;
  const routeIdentity =
    route.role !== null && route.currentUserId !== null
      ? { role: route.role, userId: route.currentUserId }
      : null;

  // Fallback only; disabled the moment the route answers with an identity
  // (the normal case), so no page waits on it.
  const needsMe = workspaceId !== undefined && routeIdentity === null;
  const me = useApiQuery<MePayload>("/api/workspaces/me", {
    workspaceId,
    enabled: needsMe,
  });

  const identity = routeIdentity ?? me.data ?? null;
  const access: WorkspaceAccess | null =
    route.workspace && identity
      ? {
          workspaceId: route.workspace.id,
          workspaceSlug: route.segment,
          currentUserId: identity.userId,
          role: identity.role,
          isAdmin: meetsMinRole(identity.role, "admin"),
        }
      : null;

  return {
    access,
    isPending: route.isPending || (needsMe && me.isPending),
    error: route.error ?? me.error,
    refetch: () => {
      route.refetch();
      void me.refetch();
    },
  };
}
