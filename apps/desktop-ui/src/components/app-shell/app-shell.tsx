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
import { useConsentInbox } from "@/features/channels/hooks/use-consent-inbox";
import { CONSENT_INBOX_POLL_MS } from "@/features/channels/constants";
import { CreateWorkspaceDialogCore } from "@/features/workspaces/components/create-workspace-dialog-core";
import { JoinRequestNoticesCore } from "@/features/workspaces/components/join-request-notices-core";
import { ConnectAgentBanner } from "@/features/onboarding/components/connect-agent-banner";
import { WelcomePopup } from "@/features/onboarding/components/welcome-popup";
import { TourProviderCore } from "@/features/tour/components/tour-provider-core";
import { workspaceSegment as canonicalSegment } from "@/features/workspaces/url";
import { useApiQuery } from "#/hooks/use-api-query";
import { PageError, PageLoading, isUnauthorized } from "#/components/page-states";
import { SignedOutScreen } from "#/pages/boot/signed-out-screen";
import { SettingsModal, type SettingsSection } from "#/components/settings-modal";
// Bundled as a data URI (`?inline`) for the same reason the signed-out screen
// does it: the packaged renderer is a `file://` document under
// `img-src 'self' data: blob:`, so the web popup's absolute `/favicons/...`
// src resolves to the filesystem root and never loads.
import doplMark from "#/assets/dopl-mark.png?inline";
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
 * The layout's guidance + notice layer is mounted too — TourProvider,
 * JoinRequestNotices, ConnectAgentBanner, WelcomePopup (journey-audit GAP-3
 * and GAP-7). The first two were `next/navigation`-bound and were split into
 * cores for this; the last two were already Next-free. WelcomePopup takes the
 * SPA's bundled brand mark because its web default is an absolute
 * `/favicons/...` path that dead-ends under `file://`.
 *
 * What the server layout did before rendering, this does client-side: resolve
 * the URL segment to a workspace and rewrite the URL when it is stale
 * (§1.5) — `POST /api/boot`, one cached request shared with every page via
 * `useWorkspaceRoute`.
 *
 * That single request is why the `isPending` gate below is affordable. It
 * blocks `<Outlet/>`, i.e. every page, so anything serial in front of it is
 * serial in front of the whole app (launch-blocker P0-2). It used to be the
 * THIRD of five: bridge auth → onboarding-state → ensure-default → resolve →
 * me → page data. Boot answers hops 2–4 at once and seeds the rest into the
 * cache, so on a launch this query is already warm and the gate never paints.
 */
export function AppShellLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const { workspace, segment, role, isPending, error, refetch, needsRedirect } =
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

  // A 401 anywhere in the shell means the session died — the answer is the
  // sign-in screen, never a dead-end error card on the landing backdrop.
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

  // The role the modal gates on. It comes off the BOOT answer now — the same
  // server-resolved membership the web shell reads, arriving with the
  // workspace instead of one hop behind it. The rail's copy of the workspace
  // is the fallback for an answer that carries no role (older server).
  const railRole =
    role ?? workspaces.find((w) => w.publicId === workspace.publicId)?.role ?? "viewer";

  return (
    <div className={styles.root}>
      <div className={styles.body}>
        {/* Rail removed (2026-08-11) — workspace switching + creation live in
            the sidebar's switcher popover (`WorkspaceSwitcherCore`). */}
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
          {/* The web layout's guidance + notice layer, in its order
              (`src/app/[workspaceSlug]/(app)/layout.tsx`): the tour wraps the
              routed page, and the three one-shot surfaces mount beside it.
              Each is the Next-free core/binding form, so the router and the
              brand mark come from here. */}
          <TourProviderCore
            workspaceSegment={segment}
            onNavigate={(path) => navigate(path)}
          >
            {/* Per-resource access matrix — without it useMyAccessContext
                no-ops and every teams-mode gate resolves to a FALSE edit
                affordance (server still refuses; the UI shouldn't offer). */}
            <MyAccessProvider workspaceSegment={segment}>
              <Outlet />
              {/* Terminal step of the join-approval loop: an approved
                  requester is told they're in (journey-audit GAP-7). */}
              <JoinRequestNoticesCore onNavigate={(path) => navigate(path)} />
              <ConnectAgentBanner />
              <WelcomePopup
                brand={
                  // next/image is forbidden here — there is no Next runtime
                  // in this SPA.
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
