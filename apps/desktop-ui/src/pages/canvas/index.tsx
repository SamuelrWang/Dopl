import { useParams } from "react-router";
import { GraphView } from "@/features/ontology/graph/graph-view";
import { meetsMinRole } from "@/features/workspaces/types";
import { PageError, PageLoading } from "#/components/page-states";
import { useWorkspaceAccess } from "#/pages/skills/use-workspace-access";

/**
 * `/:workspaceSegment/canvas` — the port of
 * `src/app/[workspaceSlug]/(app)/canvas/page.tsx`
 * (docs/migration-research/web-pages.md §5).
 *
 * The thinnest possible seam over the heaviest client tree in the app. The RSC
 * fetched NO data: it resolved the workspace, read the caller's role, and
 * handed `GraphView` three props. That is exactly what this does, with
 * `useWorkspaceAccess` standing in for the two server calls.
 *
 * Everything below `GraphView` is REUSED BY IMPORT, untouched — deliberately,
 * because the layout-persistence choreography is the part that breaks when
 * touched: `useGraphPositions` (800 ms debounce under one `"layout"` key,
 * adopt-only-when-idle guard, orphan pruning, unmount flush, `resetLayout`
 * serialized behind in-flight writes) persists node positions server-side into
 * `cluster.layout`, and the graph body is keyed by `cluster.id` so a realtime
 * cluster reorder cannot retarget a pending drag write. No localStorage, no
 * viewport persistence, no URL sync — nothing in that dance is
 * Next-dependent, and the whole tree (graph engine, edge routing, drag, the
 * billing upgrade modal) has zero `next/*` imports.
 *
 * `useOntologyRealtime` rides the shared realtime registry and no-ops in SPA
 * mode, so the clobber guard in `use-ontology` simply never has a remote
 * snapshot to defer. Wiring it any other way would be a second pattern.
 */
export default function CanvasPage() {
  const { workspaceSegment = "" } = useParams();
  const { access, isPending, error, refetch } = useWorkspaceAccess(workspaceSegment);

  if (error) return <PageError error={error} onRetry={refetch} />;
  if (isPending || !access) return <PageLoading label="Loading canvas" />;

  return (
    <GraphView
      workspaceId={access.workspaceId}
      canManageBilling={access.isAdmin}
      canEdit={meetsMinRole(access.role, "member")}
    />
  );
}
