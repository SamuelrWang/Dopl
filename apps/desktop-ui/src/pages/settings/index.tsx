import { useNavigate } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { workspaceSegment } from "@/features/workspaces/url";
import type { Role, Workspace } from "@/features/workspaces/types";
import {
  WorkspaceSectionBody,
  workspaceReadPath,
} from "@/shared/layout/settings-modal/sections/workspace-section-core";
import { ConnectedAppsSection } from "@/features/mcp-connect/components/connected-apps-section";
import { useApiQuery } from "#/hooks/use-api-query";
import { PageError, PageLoading } from "#/components/page-states";
import { useWorkspaceRoute } from "#/components/app-shell";
import { invalidateWorkspaceReads } from "#/lib/workspace-cache";

/**
 * /:workspaceSegment/settings — per-workspace settings.
 *
 * `GET /api/workspaces/{segment}` → `{ workspace, role }`. Same path+key the
 * settings modal's workspace pane reads (both via `workspaceReadPath`), so the
 * two share one cache entry.
 *
 * ⚠ Sections NOT composed here: `WorkspaceSectionBody` is the same composition
 * the modal's General pane renders, so changes land on both. This page differs
 * only in chrome and in what it hangs off the body's `extras` slot.
 */
export default function SettingsPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const route = useWorkspaceRoute();
  const segment = route.segment;

  const path = segment ? workspaceReadPath(segment) : null;
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
          <WorkspaceSectionBody
            workspace={workspace}
            role={role}
            onSaved={(updated, previous) => {
              // ⚠ Rename regenerates the slug, so the canonical URL moves and
              // every cached read of the old segment is stale.
              invalidateWorkspaceReads(queryClient, segment);
              if (updated.slug !== previous.slug) {
                navigate(`/${workspaceSegment(updated)}/settings`, { replace: true });
              }
            }}
            onDeleted={(next) => {
              invalidateWorkspaceReads(queryClient, segment);
              // "/" lands on BootPage, which provisions or routes to
              // /onboarding.
              navigate(next ? `/${workspaceSegment(next)}` : "/", { replace: true });
            }}
            extras={<ConnectedAppsSection />}
          />
        </div>
      </div>
    </div>
  );
}
