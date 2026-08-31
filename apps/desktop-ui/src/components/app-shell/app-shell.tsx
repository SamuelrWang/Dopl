import { useEffect, useState } from "react";
import { Outlet, useLocation, useNavigate } from "react-router";
import {
  AppSidebarCore,
  activeSectionFromPath,
} from "@/shared/layout/app-shell/app-sidebar-core";
import { cn } from "@/shared/lib/utils";
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
import type { HomeChannelsPayload } from "@/features/home/types";
import { useApiQuery } from "#/hooks/use-api-query";
import { PageError, PageLoading, isUnauthorized } from "#/components/page-states";
import { SignedOutScreen } from "#/pages/boot/signed-out-screen";
import { HOME_CHANNELS_PATH } from "#/pages/home/home-rows";
import { SettingsModal, type SettingsSection } from "#/components/settings-modal";
// ⚠ `?inline` (data URI) required: packaged renderer is a `file://` document
// under `img-src 'self' data: blob:`, so an absolute `/favicons/...` src
// resolves to the filesystem root and never loads.
import doplMark from "#/assets/dopl-mark.png?inline";
import { AccountRail, HOME_PATH } from "./account-rail";
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

  /**
   * 🔒 A GUEST AT A WORKSPACE URL GOES TO THEIR CHANNEL (Samuel's ruling,
   * 2026-08-30 — ledger ASK-2, option b).
   *
   * ⚠ THE FLOOR IS NOT THE FIX AND MUST NOT BECOME ONE. `segment.ts ›
   * BOOT_MIN_ROLE` stays `"guest"` deliberately: the two pop-out windows live
   * OUTSIDE this layout and pay the boot read themselves, so a `viewer` floor
   * there answers 404 and a guest's popped-out thread renders "Workspace not
   * found". The floor says WHO MAY ASK; this says WHERE THEY LAND. Both are
   * needed and they are different questions.
   *
   * WHAT IT REPLACES: a guest reaching `/{linkContainerSegment}` got the shell
   * in full and then every routed page 403'd at the `viewer` default — fully
   * painted chrome around a stack of `PageError` cards. Not a leak (nothing
   * links a guest here), but URL-reachable.
   *
   * ⚠ THE CONTAINER HAS EXACTLY ONE CHANNEL, and this resolves it THE WAY THE
   * GUEST WEB LANE DOES — `src/app/c/[workspaceId]/page.tsx` calls
   * `getHomeChannel(user, workspaceId)`, whose HTTP twin reachable from a
   * renderer is `GET /api/home/channels` (`withUserAuth`, no `X-Workspace-Id`,
   * fenced by the caller's own membership rows — so a guest may ask it and a
   * container they do not belong to is not in the answer). Matching on
   * `workspaceId` is what makes it the SAME container, not merely a channel.
   *
   * ⚠ NO CHANNEL ⇒ `/home`, NOT A THIRD ERROR CARD — and a FAILED read lands
   * there too. That is not UNKNOWN-rendered-as-EMPTY (INVARIANTS §11), because
   * `/home` asserts nothing: the question this answers is "where does a guest
   * belong", the answer is never a workspace page, and `/home` is the guest's
   * own surface, which reports its own read failure honestly. Claiming "you have
   * no channel" ON a workspace URL is the thing that would be a lie.
   *
   * ⚠ ORDERED BEHIND THE CANONICAL REDIRECT above: while `needsRedirect` is
   * true the routed segment is stale, and both effects firing in one tick would
   * race two `replace`s over one history entry.
   *
   * ⚠ THE TARGET IS COMPARED BEFORE NAVIGATING — it is a route INSIDE this
   * layout, so an unguarded navigate re-runs this effect forever.
   */
  const isGuest = role === "guest";
  const guestChannelId = useApiQuery<HomeChannelsPayload, string | null>(
    HOME_CHANNELS_PATH,
    {
      enabled: isGuest,
      // `?? []` is the stale-cache guard (INVARIANTS §8): this payload is
      // IndexedDB-persisted, and a `.find` on an absent key throws INSIDE the
      // shell, which blanks every page rather than one pane.
      select: (body) =>
        (body.channels ?? []).find((c) => c.workspaceId === workspace?.id)
          ?.channelId ?? null,
    }
  );
  const guestSettled = isGuest && !guestChannelId.isPending;
  const guestTarget = guestSettled
    ? guestChannelId.data
      ? `/${segment}/channels/${guestChannelId.data}`
      : HOME_PATH
    : null;
  useEffect(() => {
    if (needsRedirect || !segment || guestTarget === null) return;
    if (location.pathname === guestTarget) return;
    navigate(guestTarget, { replace: true });
  }, [needsRedirect, segment, guestTarget, location.pathname, navigate]);

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
          {/* ⚠ ONE PANEL, AND THE SIDEBAR IS A REGION OF IT (Samuel, 2026-08-30:
              *"the right panel sits ON TOP OF the gray panel that holds the
              sidebar"*). This is /home's structure — one `page-float` spanning
              everything right of the rail, with the nav standing where /home's
              relationship list stands and the routed page floating inside as
              /home's record pane does. The FACE is the kit's `.page-float`,
              composed here rather than restated, so the panel /home wears and
              the panel this wears are one recipe. `styles.panel` adds layout
              only; see `app-shell.module.css`'s header for the level table. */}
          <div className={cn("page-float", styles.panel)}>
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
                {/* ⚠ THE CARD WRAPS THE OUTLET AND NOTHING ELSE. The three
                    notice/guidance mounts below stay OUTSIDE it: they are
                    overlays over the whole shell, and `.pageCard` clips
                    (`overflow: hidden`) so a banner inside it would be cut off
                    at the card's rounded edge instead of floating over the
                    page. */}
                <div className={styles.pageCard}>
                  <Outlet />
                </div>
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
