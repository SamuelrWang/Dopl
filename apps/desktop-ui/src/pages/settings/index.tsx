import { useNavigate } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { workspaceSegment } from "@/features/workspaces/url";
import type { Role, Workspace } from "@/features/workspaces/types";
import { WorkspaceSettingsFormCore } from "@/features/workspaces/components/workspace-settings-form-core";
import { WorkspaceDangerZoneCore } from "@/features/workspaces/components/workspace-danger-zone-core";
import { RemoteConnect } from "@/features/mcp-connect/components/remote-connect";
import { ConnectedAppsSection } from "@/features/mcp-connect/components/connected-apps-section";
import { WorkspaceTrashSection } from "@/features/trash/components/workspace-trash-section";
import { useApiQuery } from "#/hooks/use-api-query";
import { PageError, PageLoading } from "#/components/page-states";
import { RESOLVE_PATH, useWorkspaceRoute } from "#/components/app-shell";

/**
 * /:workspaceSegment/settings — per-workspace settings. Port of
 * `src/app/[workspaceSlug]/(app)/settings/page.tsx`
 * (docs/migration-research/web-pages.md §14).
 *
 * The RSC's two server calls (`resolvePageWorkspace` + `resolveMembershipOrThrow`)
 * collapse into the endpoint §14 names as already covering them:
 * `GET /api/workspaces/{segment}` → `{ workspace, role }`. That is the same
 * path+key the settings modal's workspace pane reads, so the two share one
 * cache entry.
 *
 * Every section below is the web app's own component. `RemoteConnect`,
 * `ConnectedAppsSection` and `WorkspaceTrashSection` are reused verbatim; the
 * rename form and the danger zone are reused as their Next-free cores with the
 * SPA router injected, because the web bindings navigate with
 * `next/navigation` (the wave-1 core/binding pattern).
 */
export default function SettingsPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const route = useWorkspaceRoute();
  const segment = route.segment;

  const path = segment ? `/api/workspaces/${encodeURIComponent(segment)}` : null;
  const query = useApiQuery<{ workspace: Workspace; role: Role }>(path);

  if (route.isPending || query.isPending) return <PageLoading label="Loading settings" />;
  if (route.error || query.error || !query.data) {
    return (
      <PageError
        error={route.error ?? query.error ?? new Error("Workspace not found")}
        onRetry={() => {
          route.refetch();
          void query.refetch();
        }}
      />
    );
  }

  const { workspace, role } = query.data;

  /**
   * `router.refresh()` has no equivalent here (CONVENTIONS.md), so a write that
   * changes the workspace re-reads the three keys that carry its name/slug:
   * this page's read, the shell's resolve, and the rail's list.
   */
  function invalidateWorkspaceReads() {
    if (path) void queryClient.invalidateQueries({ queryKey: [path] });
    void queryClient.invalidateQueries({ queryKey: [RESOLVE_PATH] });
    void queryClient.invalidateQueries({ queryKey: ["/api/workspaces"] });
  }

  return (
    <div className="page-float flex flex-col antialiased">
      <div className="flex shrink-0 items-center gap-3 border-b border-border-subtle px-4 py-2">
        <h1 className="shrink-0 text-title font-semibold tracking-tight text-text-primary">
          Settings
        </h1>
        <span className="min-w-0 truncate text-caption text-text-muted">
          {workspace.name} · <span className="font-mono">/{workspace.slug}</span>
        </span>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-6 pt-5 pb-10">
        <div className="max-w-2xl space-y-6">
          <WorkspaceSettingsFormCore
            workspace={workspace}
            role={role}
            onSaved={(updated) => {
              // The web binding's `router.push` / `router.refresh()` pair: a
              // rename regenerates the slug, so the canonical URL moves and
              // every cached read of the old segment is stale. Same segment →
              // just re-read (there is no RSC to refresh here).
              invalidateWorkspaceReads();
              if (updated.slug !== workspace.slug) {
                navigate(`/${workspaceSegment(updated)}/settings`, { replace: true });
              }
            }}
          />
          <RemoteConnect />
          <ConnectedAppsSection />
          <WorkspaceTrashSection
            workspaceSlug={workspace.slug}
            workspaceId={workspace.id}
          />
          {role === "owner" && (
            <WorkspaceDangerZoneCore
              workspace={workspace}
              onDeleted={(next) => {
                invalidateWorkspaceReads();
                // No `/onboarding` route in the SPA — the workspace-less root
                // owns that decision once the default-workspace endpoint lands
                // (web-pages.md §16, G2).
                navigate(next ? `/${workspaceSegment(next)}` : "/", { replace: true });
              }}
            />
          )}
        </div>
      </div>
    </div>
  );
}
