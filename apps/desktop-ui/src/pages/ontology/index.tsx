import { useCallback } from "react";
import { useNavigate, useParams } from "react-router";
import { OntologyView } from "@/features/ontology/components/ontology-view";
import { meetsMinRole } from "@/features/workspaces/types";
import { PageError, PageLoading } from "#/components/page-states";
import { useWorkspaceAccess } from "#/hooks/use-workspace-access";

/**
 * `/:workspaceSegment/ontology` AND `/:workspaceSegment/ontology/:clusterSlug`
 * — the port of both `src/app/[workspaceSlug]/(app)/ontology/page.tsx` and its
 * `[clusterSlug]/page.tsx` sibling (docs/migration-research/web-pages.md §7).
 *
 * ONE component serves both routes, for the same reason workflows does: the two
 * RSCs differ only in passing `initialClusterSlug`, which here is just
 * `useParams().clusterSlug`, and registering both rows with the same component
 * type is what lets react-router reconcile them instead of remounting. That
 * matters more than it looks — the ontology store, its optimistic reducer and
 * its debounced per-object writes all live in `useOntology` inside this tree,
 * so a remount on the first cluster click would drop pending edits. `detail.tsx`
 * re-exports this rather than cloning it.
 *
 * The RSCs fetched nothing: workspace + role, then four props. So the entire
 * kanban view — `useOntology`, `OntologyResourcesProvider`, the object panel,
 * the pick menus, the billing cap notice and upgrade modal — is REUSED BY
 * IMPORT, untouched, sharing the `["ontology-snapshot", workspaceId]` cache
 * entry with the canvas graph view.
 *
 * The one seam is the URL. The web view keeps the address bar on the active
 * cluster's slug with `history.replaceState` — a path URL, which is a Chromium
 * security error on the packaged `file://` document. `OntologyView` now takes
 * that write as an injectable `replaceUrl`; the SPA hands it the hash router's
 * `navigate(..., { replace: true })`, so the same "URL follows the cluster,
 * without a history entry" behaviour survives and a reload still deep-links
 * back to the open cluster.
 *
 * Deliberately NOT added: back-button restore of the cluster. The web app has
 * no `popstate` handling and no `pushState` here, so Back does not restore
 * selection today — matching that is the port; improving it would be new
 * behaviour.
 */
export default function OntologyPage() {
  const { clusterSlug } = useParams();
  const navigate = useNavigate();
  const { access, isPending, error, refetch } = useWorkspaceAccess();

  // `replaceState`'s stand-in: same path string, no history entry, and the
  // router's own location stays authoritative (the shell's canonical-segment
  // redirect reads it).
  const replaceUrl = useCallback(
    (path: string) => navigate(path, { replace: true }),
    [navigate]
  );

  if (error) return <PageError error={error} onRetry={refetch} />;
  if (isPending || !access) return <PageLoading label="Loading ontology" />;

  return (
    <OntologyView
      workspaceId={access.workspaceId}
      workspaceSegment={access.workspaceSlug}
      initialClusterSlug={clusterSlug}
      canManageBilling={access.isAdmin}
      canEdit={meetsMinRole(access.role, "member")}
      replaceUrl={replaceUrl}
    />
  );
}
