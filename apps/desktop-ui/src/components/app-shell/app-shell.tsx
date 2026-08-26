import { useEffect, useState } from "react";
import { Outlet, useLocation, useNavigate } from "react-router";
import {
  AppSidebarCore,
  activeSectionFromPath,
} from "@/shared/layout/app-shell/app-sidebar-core";
import { WorkspaceSwitcherCore } from "@/shared/layout/app-shell/workspace-switcher-core";
import type { WorkspaceLike } from "@/shared/layout/app-shell/workspace-types";
import styles from "@/shared/layout/app-shell/app-shell.module.css";
import { MyAccessProvider } from "@/features/members/hooks/use-my-access";
import { CreateWorkspaceDialogCore } from "@/features/workspaces/components/create-workspace-dialog-core";
import { JoinRequestNoticesCore } from "@/features/workspaces/components/join-request-notices-core";
import { ConnectAgentBanner } from "@/features/onboarding/components/connect-agent-banner";
import { WelcomePopup } from "@/features/onboarding/components/welcome-popup";
import { TourProviderCore } from "@/features/tour/components/tour-provider-core";
import { workspaceSegment as canonicalSegment } from "@/features/workspaces/url";
import { isStandardWorkspace } from "@/features/workspaces/types";
import { useApiQuery } from "#/hooks/use-api-query";
import { PageError, PageLoading, isUnauthorized } from "#/components/page-states";
import { SignedOutScreen } from "#/pages/boot/signed-out-screen";
import { SettingsModal, type SettingsSection } from "#/components/settings-modal";
// ⚠ `?inline` (data URI) required: packaged renderer is a `file://` document
// under `img-src 'self' data: blob:`, so an absolute `/favicons/...` src
// resolves to the filesystem root and never loads.
import doplMark from "#/assets/dopl-mark.png?inline";
import { AccountRail } from "./account-rail";
import { RouterLink } from "./router-link";
import { useWorkspaceRoute } from "./use-workspace-route";

/**
 * The workspace shell — SPA layout route standing in for the web
 * `src/app/[workspaceSlug]/(app)/layout.tsx`.
 *
 * Composes the web app's Next-free CORES (`@/`) with router + transport
 * injected; the web `AppShell` itself binds `next/navigation` + `useAuthUser`
 * and is not reusable.
 *
 * Also mounts the web layout's guidance + notice layer in its order:
 * TourProviderCore, JoinRequestNoticesCore, ConnectAgentBanner, WelcomePopup.
 *
 * ⚠ The `isPending` gate below blocks `<Outlet/>`, i.e. every page — anything
 * serial in front of it is serial in front of the whole app. Affordable only
 * because `useWorkspaceRoute` is ONE cached `POST /api/boot` that also seeds
 * the downstream keys, so on launch it is already warm and never paints.
 */
export function AppShellLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const { workspace, segment, role, isPending, error, refetch, needsRedirect } =
    useWorkspaceRoute();

  // ⚠ THE CHANNELS NAV BADGE AND ITS `useConsentInbox` READ STOOD HERE AND ARE
  // DELETED (Samuel, 2026-08-25). The count was a claim that something was
  // ACTIONABLE somewhere else — the consent Inbox — and that pane is gone: the
  // outbound review is the work stream's own card
  // (`agent-stream.tsx › SentToChannelBox`), reachable on a solo /home channel
  // that this shell does not even wrap. **The shell no longer reads consent at
  // all**, so it no longer mounts a workspace-wide realtime subscription on
  // every page of the app. Do not re-add a badge for a surface that does not
  // exist; the GATE itself is untouched (INVARIANTS §6).
  const [createWsOpen, setCreateWsOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  // Seeded to the gear's section: Escape-then-reopen must not flash the wrong pane.
  const [settingsSection, setSettingsSection] = useState<SettingsSection>("account");

  // Web 301s a stale segment to canonical. No server hop here, so REPLACE the
  // history entry — same effect, deeper path preserved.
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

  // 401 anywhere in the shell = session died → sign-in, not an error card.
  if (isUnauthorized(error)) return <SignedOutScreen />;
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

  // Role the modal gates on. Off the BOOT answer; workspaces list is the
  // fallback for an older server whose answer carries no role.
  const railRole =
    role ?? workspaces.find((w) => w.publicId === workspace.publicId)?.role ?? "viewer";

  return (
    <div className={styles.root}>
      <div className={styles.body}>
        {/* The ACCOUNT rail (2026-08-21): Home + this account's workspaces.
            Workspace switch + create also live in `WorkspaceSwitcherCore`. */}
        <AccountRail
          workspaces={workspaces}
          activeWorkspacePublicId={workspace.publicId}
          onNavigate={(path) => navigate(path)}
          onCreateWorkspace={() => setCreateWsOpen(true)}
        />
        <div className={styles.surface}>
          <AppSidebarCore
            workspaceSegment={segment}
            activeSection={activeSectionFromPath(location.pathname)}
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
          {/* Order matches the web layout: tour wraps the routed page. */}
          <TourProviderCore
            workspaceSegment={segment}
            onNavigate={(path) => navigate(path)}
          >
            {/* ⚠ Required: without it useMyAccessContext no-ops and every
                teams-mode gate resolves to a FALSE edit affordance. */}
            <MyAccessProvider workspaceSegment={segment}>
              <Outlet />
              {/* Terminal step of the join-approval loop (GAP-7). */}
              <JoinRequestNoticesCore onNavigate={(path) => navigate(path)} />
              <ConnectAgentBanner />
              <WelcomePopup
                brand={
                  // No Next runtime in this SPA, so next/image is forbidden.
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={doplMark}
                    alt="Dopl"
                    className="auth-logo-3d h-11 w-11 rounded-[8px]"
                  />
                }
              />
            </MyAccessProvider>
          </TourProviderCore>
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

/**
 * ⚠ FILTERED, and `GET /api/workspaces` is unfiltered ON PURPOSE (2026-08-23).
 * The account surface's relationships are `kind='link'` CONTAINER workspaces —
 * one per person you are connected to — and the caller is a member of every one
 * of them. Unfiltered, the rail and the switcher would fill with plumbing.
 * `isStandardWorkspace` is THE predicate (absent kind = standard); never a hand
 * comparison here.
 */
const selectWorkspaces = (body: { workspaces?: WorkspaceLike[] }) =>
  (body.workspaces ?? []).filter(isStandardWorkspace);

/** Swap the routed workspace segment for the canonical one, keeping the rest
 *  of the path (`/old-slug/skills/x` → `/acme-ab12/skills/x`). */
export function canonicalPath(pathname: string, canonical: string): string {
  const rest = pathname.split("/").filter(Boolean).slice(1);
  return `/${[canonical, ...rest].join("/")}`;
}
