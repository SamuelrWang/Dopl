import { meetsMinRole, type Role } from "@/features/workspaces/types";
import { useWorkspaceRoute } from "#/components/app-shell";
import { useApiQuery } from "#/hooks/use-api-query";

/**
 * The three values every ported page used to get for free as RSC props —
 * `workspaceId`, the caller's `role`/`isAdmin`, and `currentUserId`.
 *
 * ALL THREE COME FROM ONE READ NOW (launch-blocker P0-2). They used to be
 * two: `useWorkspaceRoute` resolved the segment, and this hook added
 * `GET /api/workspaces/me` on top — gated on the resolved id, so it could not
 * even start until the resolve landed, and every page gated its own first
 * fetch on `access` being non-null. That made `me` a serial round trip in
 * front of six pages' data for a `{ role, userId }` pair the resolve had
 * already read to prove membership. `POST /api/boot` returns them with the
 * workspace, so `access` is complete the moment the route is.
 *
 * The `me` query survives ONLY as a fallback for an answer that carries no
 * identity (an older server that has not shipped the boot payload's role
 * yet). It is disabled whenever the route already knows, which is always in a
 * matched pair — so in practice this hook issues no request at all.
 *
 * It began life under `pages/skills/` as a stopgap "for pages rendered
 * STANDALONE, before the app shell exists", with its own copy of the resolve
 * call, and outlived that condition: the shell landed and wrapped every page,
 * so two abstractions were resolving the same segment and only a hand-kept
 * byte-identical query key stopped them from double-fetching and disagreeing
 * about role and canonical segment (2026-08-03 fleet audit,
 * duplication-quality). Sharing the hook makes that structural instead of
 * conventional — there is one boot query for the shell and all seven pages.
 *
 * The segment comes from the router (`useParams`), which is where every caller
 * read it from anyway; that is why this takes no argument.
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

  // Fallback only — see the note above. Disabled the moment the route answers
  // with an identity, which is the normal case, so no page waits on it.
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
