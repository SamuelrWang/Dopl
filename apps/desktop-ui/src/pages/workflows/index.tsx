import { useCallback } from "react";
import { useNavigate, useParams } from "react-router";
import { WorkflowsView } from "@/features/workflows/components/workflows-view";
import { meetsMinRole } from "@/features/workspaces/types";
import { PageError, PageLoading } from "#/components/page-states";
import { useWorkspaceAccess } from "#/hooks/use-workspace-access";

/**
 * `/:workspaceSegment/workflows` and `/:workspaceSegment/workflows/:workflowSlug`
 * — the port of both `src/app/[workspaceSlug]/(app)/workflows/page.tsx` and its
 * `[workflowSlug]/page.tsx` sibling (docs/migration-research/web-pages.md §8).
 *
 * ONE component serves both routes. The two RSCs differ only in whether they
 * pass `initialWorkflowSlug`, and here that is just `useParams().workflowSlug`
 * being present or not — so `detail.tsx` re-exports this rather than cloning
 * it. Sharing the component type also keeps the index→detail transition below
 * a remount: React reconciles the two route rows as the same element type, so
 * the first slug sync does not tear down the graph.
 *
 * The RSCs fetched nothing — they resolved the workspace and the caller's role
 * and handed both to `WorkflowsView`, which has always loaded its own data
 * client-side. That makes this the thinnest port in the wave: `WorkflowsView`
 * and its whole tree (graph substrate, step panel, pickers, the merge-scheduler
 * write ordering in `use-workflows`) are REUSED by import, untouched.
 *
 * The one seam is the URL. The web view keeps the address bar on the
 * server-canonical slug with `history.replaceState` — a path URL, which is a
 * Chromium security error on the packaged `file://` document. `WorkflowsView`
 * now takes that write as an injectable `replaceUrl`; the SPA hands it the hash
 * router's `navigate(..., { replace: true })`, so the same "URL follows the
 * server's slug, without a history entry" behaviour survives the port and a
 * reload still deep-links back to the open workflow.
 */
export default function WorkflowsPage() {
  const { workflowSlug } = useParams();
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
  if (isPending || !access) return <PageLoading label="Loading workflows" />;

  return (
    <WorkflowsView
      workspaceId={access.workspaceId}
      workspaceSegment={access.workspaceSlug}
      initialWorkflowSlug={workflowSlug}
      canEdit={meetsMinRole(access.role, "member")}
      replaceUrl={replaceUrl}
    />
  );
}
