import { AgentTemplatesCore } from "@/features/agent-templates/components/agent-templates-core";
import { PageError } from "#/components/page-states";
import { useWorkspaceAccess } from "#/hooks/use-workspace-access";
import { AgentsPageSkeleton } from "./agents-skeleton";

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
 * ⚠ THE LOADING STATE IS THIS PAGE'S OWN SHAPE (`./agents-skeleton.tsx`) — a
 * 52px header over three scope panels on `TemplateGrid`'s card grid. It was the
 * shared page ghost, which is a single surface like this one but not THIS one,
 * and it resolved into a shape the user never asked for.
 *
 * ⚠ AND IT IS THE SAME SHAPE AT **BOTH** GATES. A cold /agents crosses two
 * pending states back to back — the workspace resolve here, then the core's own
 * template read — and the second one used to paint the shared page ghost, so
 * one page swapped skeletons mid-load. That is the flicker
 * `#/components/page-states.tsx` argues against, arriving inside a single page
 * rather than across a boot chain. `loadingSkeleton` hands the core THIS shape
 * so the two frames are one steady surface.
 */
export default function AgentsPage() {
  const { access, isPending, error, refetch } = useWorkspaceAccess();

  if (error) return <PageError error={error} onRetry={refetch} />;
  if (isPending || !access) return <AgentsPageSkeleton label="Loading agents" />;

  return (
    <AgentTemplatesCore
      workspaceId={access.workspaceId}
      workspaceSlug={access.workspaceSlug}
      // ⚠ A SLOT, NOT AN IMPORT ON THE OTHER SIDE — the core is Next-free and
      // router-free so both trees mount it, and it cannot reach into this
      // package. Same idiom as `RouterLink` on `pages/channels/index.tsx`.
      loadingSkeleton={<AgentsPageSkeleton label="Loading agents" />}
    />
  );
}
