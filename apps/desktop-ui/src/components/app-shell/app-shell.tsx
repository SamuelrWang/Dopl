import { useEffect } from "react";
import { Outlet, useLocation, useNavigate } from "react-router";
import { AppRailCore } from "@/shared/layout/app-shell/app-rail-core";
import {
  AppSidebarCore,
  activeSectionFromPath,
} from "@/shared/layout/app-shell/app-sidebar-core";
import { WorkspaceSwitcherCore } from "@/shared/layout/app-shell/workspace-switcher-core";
import type { WorkspaceLike } from "@/shared/layout/app-shell/workspace-types";
import styles from "@/shared/layout/app-shell/app-shell.module.css";
import { MyAccessProvider } from "@/features/members/hooks/use-my-access";
import { useApiQuery } from "#/hooks/use-api-query";
import { PageError, PageLoading } from "#/components/page-states";
import { RouterLink } from "./router-link";
import { useWorkspaceRoute } from "./use-workspace-route";

/**
 * The workspace shell — the SPA's layout route, standing in for
 * `src/app/[workspaceSlug]/(app)/layout.tsx` (docs/migration-research/
 * web-pages.md §2).
 *
 * The rail, sidebar and switcher are the WEB APP'S components: their Next-free
 * cores, imported through `@/`, with the router and the transport injected
 * (`RouterLink`, the SPA's `useApiQuery`). The web `AppShell` itself is not
 * reusable yet — its body is three Next-coupled children (settings modal,
 * create-workspace dialog, `useAuthUser`), so this file composes the cores
 * instead and stubs those two affordances.
 *
 * What the server layout did before rendering, this does client-side: resolve
 * the URL segment to a workspace and rewrite the URL when it is stale
 * (§1.5) — `GET /api/workspaces/resolve`, one cached request shared with every
 * page via `useWorkspaceRoute`.
 */
export function AppShellLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const { workspace, segment, isPending, error, refetch, needsRedirect } =
    useWorkspaceRoute();

  // The web app 301s a stale segment to its canonical form. There is no server
  // hop here, so replace the history entry instead — same effect, and the
  // deeper path (`/legacy/skills/x` → `/canonical/skills/x`) is preserved.
  useEffect(() => {
    if (!needsRedirect || !segment) return;
    navigate(canonicalPath(location.pathname, segment), { replace: true });
  }, [needsRedirect, segment, location.pathname, navigate]);

  const workspacesQuery = useApiQuery<
    { workspaces?: WorkspaceLike[] },
    WorkspaceLike[]
  >("/api/workspaces", { select: selectWorkspaces });
  const workspaces = workspacesQuery.data ?? [];

  if (isPending) {
    return (
      <div className="flex h-screen w-screen flex-col">
        <PageLoading label="Opening workspace" />
      </div>
    );
  }

  if (error || !workspace) {
    return (
      <div className="flex h-screen w-screen flex-col">
        <PageError error={error ?? new Error("Workspace not found")} onRetry={refetch} />
      </div>
    );
  }

  return (
    <div className={styles.root}>
      <div className={styles.body}>
        <AppRailCore
          workspaces={workspaces}
          activePublicId={workspace.publicId}
          onAddWorkspace={notPortedYet}
          Link={RouterLink}
        />
        <div className={styles.surface}>
          <AppSidebarCore
            workspaceSegment={segment}
            activeSection={activeSectionFromPath(location.pathname)}
            // The badge counts pending consent requests, which arrive over the
            // channels realtime stream — Supabase realtime is not ported yet
            // (web-pages.md §1.2), and channels is the last wave. 0 until then.
            consentCount={0}
            onOpenSettings={notPortedYet}
            Link={RouterLink}
            brand={
              <WorkspaceSwitcherCore
                workspaceSegment={segment}
                workspacePublicId={workspace.publicId}
                workspaceName={workspace.name}
                workspaces={workspaces}
                isLoading={workspacesQuery.isPending}
                onNavigate={(path) => navigate(path)}
                onOpenSettings={notPortedYet}
                onCreateWorkspace={notPortedYet}
              />
            }
          />
          {/* Per-resource access matrix — without it useMyAccessContext
              no-ops and every teams-mode gate resolves to a FALSE edit
              affordance (server still refuses; the UI shouldn't offer). */}
          <MyAccessProvider workspaceSegment={segment}>
            <Outlet />
          </MyAccessProvider>
        </div>
      </div>
    </div>
  );
}

const selectWorkspaces = (body: { workspaces?: WorkspaceLike[] }) =>
  body.workspaces ?? [];

/**
 * Swap the routed workspace segment for the canonical one, keeping the rest of
 * the path (`/old-slug/skills/x` → `/acme-ab12/skills/x`).
 */
export function canonicalPath(pathname: string, canonical: string): string {
  const rest = pathname.split("/").filter(Boolean).slice(1);
  return `/${[canonical, ...rest].join("/")}`;
}

/**
 * TODO(desktop-migration): the settings modal and the create-workspace dialog
 * are both Next-coupled (`next/navigation` in delete-account and in
 * create-workspace-dialog) and belong to the settings slice. Until it lands,
 * the buttons that open them are inert rather than absent — removing them would
 * mean re-adding rail/sidebar markup that is otherwise shared verbatim.
 */
function notPortedYet(): void {}
