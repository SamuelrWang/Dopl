import { AgentIdentitiesCore } from "@/features/agent-identities/components/agent-identities-core";
import { PageError } from "#/components/page-states";
import { useWorkspaceAccess } from "#/hooks/use-workspace-access";
import { IdentitiesPageSkeleton } from "./identities-skeleton";

/**
 * `/:workspaceSegment/identities` — a seam over `@/features/agent-identities`: resolves the
 * workspace and hands over. No detail route (an identity is edited in a modal), so main's
 * deep-link copy says `identities: false`. The page's own skeleton stands at both gates.
 */
export default function IdentitiesPage() {
  const { access, isPending, error, refetch } = useWorkspaceAccess();

  if (error) return <PageError error={error} onRetry={refetch} />;
  if (isPending || !access) return <IdentitiesPageSkeleton />;

  return (
    <AgentIdentitiesCore
      workspaceId={access.workspaceId}
      workspaceSlug={access.workspaceSlug}
      // A slot: the core is Next-free and router-free and cannot import this package.
      loadingSkeleton={<IdentitiesPageSkeleton />}
    />
  );
}
