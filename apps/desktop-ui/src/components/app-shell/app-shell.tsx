import { useEffect, useState } from "react";
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
import { useConsentInbox } from "@/features/channels/hooks/use-consent-inbox";
import { CONSENT_INBOX_POLL_MS } from "@/features/channels/constants";
import { CreateWorkspaceDialogCore } from "@/features/workspaces/components/create-workspace-dialog-core";
import { workspaceSegment as canonicalSegment } from "@/features/workspaces/url";
import { useApiQuery } from "#/hooks/use-api-query";
import { PageError, PageLoading } from "#/components/page-states";
import { SettingsModal, type SettingsSection } from "#/components/settings-modal";
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
 * reusable — its body binds `next/navigation` and `useAuthUser` — so this file
 * composes the cores instead, and supplies its own bindings for the two
 * affordances the shell owns: creating a workspace (the dialog's Next-free
 * core) and opening settings.
 *
 * Settings opens the MODAL over the current page, as it does on the web — the
 * sidebar's gear and the switcher's "Workspace settings" both land on their own
 * section (`#/components/settings-modal`, the desktop binding of the shared
 * core). The three capabilities the packaged renderer lacks — Stripe Elements,
 * the multipart icon upload, Supabase-side account deletion — degrade inside
 * that binding rather than costing the whole surface. The `/settings` ROUTE is
 * untouched and still serves deep links.
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

  // Consent badge: shares the channels page's exact cache key — zero extra
  // requests when both are mounted. Self-disables on a falsy id. Polled:
  // realtime is a no-op in the SPA (Phase 3), and a badge whose job is
  // pulling you TO the channels page can't wait for the channels page's
  // own observers to refresh it.
  const { requests: consentRequests } = useConsentInbox(
    workspace?.id,
    undefined,
    CONSENT_INBOX_POLL_MS
  );
  const [createWsOpen, setCreateWsOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  // Seeded to the section the sidebar's gear opens, so the first paint of an
  // Escape-then-reopen is never a flash of the wrong pane.
  const [settingsSection, setSettingsSection] = useState<SettingsSection>("account");

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

  const openSettings = (section: SettingsSection) => {
    setSettingsSection(section);
    setSettingsOpen(true);
  };

  // The rail's copy of this workspace carries the caller's role — the seed the
  // modal gates on until `/api/workspaces/me` answers (the web shell seeds it
  // from the server-resolved membership instead).
  const railRole =
    workspaces.find((w) => w.publicId === workspace.publicId)?.role ?? "viewer";

  return (
    <div className={styles.root}>
      <div className={styles.body}>
        <AppRailCore
          workspaces={workspaces}
          activePublicId={workspace.publicId}
          onAddWorkspace={() => setCreateWsOpen(true)}
          Link={RouterLink}
        />
        <div className={styles.surface}>
          <AppSidebarCore
            workspaceSegment={segment}
            activeSection={activeSectionFromPath(location.pathname)}
            // The badge counts pending consent requests, which arrive over the
            consentCount={consentRequests.length}
            onOpenSettings={openSettings}
            Link={RouterLink}
            brand={
              <WorkspaceSwitcherCore
                workspaceSegment={segment}
                workspacePublicId={workspace.publicId}
                workspaceName={workspace.name}
                workspaces={workspaces}
                isLoading={workspacesQuery.isPending}
                onNavigate={(path) => navigate(path)}
                onOpenSettings={openSettings}
                onCreateWorkspace={() => setCreateWsOpen(true)}
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

      <CreateWorkspaceDialogCore
        open={createWsOpen}
        onOpenChange={setCreateWsOpen}
        onCreated={(created) => {
          void workspacesQuery.refetch();
          navigate(`/${canonicalSegment(created)}`);
        }}
      />

      <SettingsModal
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        section={settingsSection}
        onSectionChange={setSettingsSection}
        workspaceSegment={segment}
        workspaceId={workspace.id}
        role={railRole}
        onWorkspaceChanged={() => void workspacesQuery.refetch()}
      />
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
