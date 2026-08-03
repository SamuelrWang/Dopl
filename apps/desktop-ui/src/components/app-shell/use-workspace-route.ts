import { useParams } from "react-router";
import { useApiQuery } from "#/hooks/use-api-query";
import { workspaceSegment } from "@/features/workspaces/url";
import type { Workspace } from "@/features/workspaces/types";

/** `GET /api/workspaces/resolve?segment=` — the HTTP twin of the web app's
 *  `resolvePageWorkspace` (docs/migration-research/web-pages.md §1.5). */
export interface ResolvedWorkspace {
  workspace: Workspace;
  canonical: string;
  needsRedirect: boolean;
}

export const RESOLVE_PATH = "/api/workspaces/resolve";

export interface WorkspaceRoute {
  /** The segment as routed — a legacy slug until the canonical redirect lands. */
  routedSegment: string;
  /** Canonical `{slug}-{publicId}` segment; "" until the resolve returns. */
  segment: string;
  workspace: Workspace | null;
  /** True while the resolve is in flight (the shell gates the page on it). */
  isPending: boolean;
  error: unknown;
  refetch: () => void;
  /** The routed segment is stale — the shell replaces the URL with `segment`. */
  needsRedirect: boolean;
}

/**
 * Resolves `/:workspaceSegment` to a workspace, for the shell AND for pages.
 *
 * Both call it with the same query key (`[RESOLVE_PATH, undefined, {segment}]`),
 * so the workspace costs ONE request per segment no matter how many components
 * need it — which is why pages read the workspace through this hook instead of
 * through router context.
 *
 * The endpoint accepts the canonical `{slug}-{publicId}` form and legacy
 * slug-only URLs, and reports `needsRedirect` where the web app 301s.
 */
export function useWorkspaceRoute(): WorkspaceRoute {
  const { workspaceSegment: routedSegment = "" } = useParams();

  const query = useApiQuery<ResolvedWorkspace>(
    routedSegment ? RESOLVE_PATH : null,
    { query: { segment: routedSegment } }
  );

  const workspace = query.data?.workspace ?? null;

  return {
    routedSegment,
    segment: workspace ? workspaceSegment(workspace) : "",
    workspace,
    isPending: query.isPending,
    error: query.error,
    refetch: query.refetch,
    needsRedirect: query.data?.needsRedirect ?? false,
  };
}
