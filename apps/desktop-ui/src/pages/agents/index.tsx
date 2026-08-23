import { AgentTemplatesCore } from "@/features/agent-templates/components/agent-templates-core";
import { PageError, PageLoading } from "#/components/page-states";
import { useWorkspaceAccess } from "#/hooks/use-workspace-access";

/**
 * `/:workspaceSegment/agents` — persistent agent TEMPLATES: three scope panels
 * (Private / Team / Public) over a card grid, and the editor behind them.
 *
 * ⚠ ONLY A SEAM. The whole surface is `@/features/agent-templates/`, already
 * client-side over `apiRequest`, which transports over the Electron IPC bridge
 * unchanged. This file resolves the workspace and hands over; it owns no state
 * and no fetching — the same shape as `pages/members/index.tsx` and
 * `pages/channels/index.tsx`.
 *
 * ⚠ NO DETAIL ROUTE. A template is edited in a modal, not at a URL, so there is
 * no `agents/:templateId` row — and the deep-link hand copy in
 * `dopl-desktop-app/main/deep-link-target.js › WORKSPACE_PAGES` therefore wants
 * `agents: false`, not `true`.
 *
 * ⚠ `variant="page"` on the loading state: this is a single-surface page, not a
 * two-pane browser, and a two-pane ghost would resolve into a shape the user
 * never asked for.
 */
export default function AgentsPage() {
  const { access, isPending, error, refetch } = useWorkspaceAccess();

  if (error) return <PageError error={error} onRetry={refetch} />;
  if (isPending || !access) return <PageLoading label="Loading agents" />;

  return (
    <AgentTemplatesCore
      workspaceId={access.workspaceId}
      workspaceSlug={access.workspaceSlug}
    />
  );
}
