import { useCallback } from "react";
import { useNavigate, useParams } from "react-router";
import { OntologyView } from "@/features/ontology/components/ontology-view";
import { meetsMinRole } from "@/features/workspaces/types";
import { PageError, PageLoading } from "#/components/page-states";
import { useWorkspaceAccess } from "#/hooks/use-workspace-access";

/**
 * `/:workspaceSegment/ontology` AND `/:workspaceSegment/ontology/:clusterSlug`.
 *
 * ⚠ ONE component serves both routes; `detail.tsx` re-exports rather than
 * cloning. Same component type on both rows = react-router reconciles instead
 * of remounting, and the ontology store + optimistic reducer + debounced
 * per-object writes all live in `useOntology` inside this tree, so a remount on
 * the first cluster click drops pending edits.
 *
 * The whole kanban view is REUSED BY IMPORT, sharing the
 * `["ontology-snapshot", workspaceId]` cache entry.
 *
 * ⚠ URL is the one seam: `history.replaceState` with a path URL is a Chromium
 * security error on the packaged `file://` document, so `OntologyView` takes
 * the write as an injectable `replaceUrl` and gets the hash router's
 * `navigate(..., { replace: true })`. URL still follows the cluster with no
 * history entry, and a reload deep-links back to the open cluster.
 *
 * Deliberately NOT added: back-button restore of the cluster (no `popstate`,
 * no `pushState` here).
 */
export default function OntologyPage() {
  const { clusterSlug } = useParams();
  const navigate = useNavigate();
  const { access, isPending, error, refetch } = useWorkspaceAccess();

  // `replaceState` stand-in: same path string, no history entry, router's
  // location stays authoritative (shell's canonical-segment redirect reads it).
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
