import { meetsMinRole, type Role } from "@/features/workspaces/types";
import { useWorkspaceRoute } from "#/components/app-shell";
import { useApiQuery } from "#/hooks/use-api-query";

/**
 * The three values every ported page used to get for free as RSC props —
 * `workspaceId`, the caller's `role`/`isAdmin`, and `currentUserId`.
 *
 * The workspace half is NOT resolved here: it comes from `useWorkspaceRoute`,
 * the shell's own resolution of `/:workspaceSegment`. This hook adds exactly
 * one thing on top — `GET /api/workspaces/me` with the resolved id as
 * `X-Workspace-Id` (`{ role, userId }`, i.e. `resolveMembershipOrThrow` plus
 * the caller's id in one round trip).
 *
 * It began life under `pages/skills/` as a stopgap "for pages rendered
 * STANDALONE, before the app shell exists", with its own copy of the resolve
 * call, and outlived that condition: the shell landed and wrapped every page,
 * so two abstractions were resolving the same segment and only a hand-kept
 * byte-identical query key stopped them from double-fetching and disagreeing
 * about role and canonical segment (2026-08-03 fleet audit,
 * duplication-quality). Sharing the hook makes that structural instead of
 * conventional — there is one resolve query for the shell and all seven pages.
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

  const me = useApiQuery<MePayload>("/api/workspaces/me", {
    workspaceId,
    enabled: workspaceId !== undefined,
  });

  const access: WorkspaceAccess | null =
    route.workspace && me.data
      ? {
          workspaceId: route.workspace.id,
          workspaceSlug: route.segment,
          currentUserId: me.data.userId,
          role: me.data.role,
          isAdmin: meetsMinRole(me.data.role, "admin"),
        }
      : null;

  return {
    access,
    isPending: route.isPending || (workspaceId !== undefined && me.isPending),
    error: route.error ?? me.error,
    refetch: () => {
      route.refetch();
      void me.refetch();
    },
  };
}
