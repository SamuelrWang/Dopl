import { ApiError } from "#/lib/api";
import { useEffect, useState } from "react";
import { Outlet, useLocation, useNavigate } from "react-router";
import {
  AppSidebarCore,
  activeSectionFromPath,
} from "@/shared/layout/app-shell/app-sidebar-core";
import { cn } from "@/shared/lib/utils";
import { Crossfade } from "@/shared/ui/crossfade";
import { WorkspaceSwitcherCore } from "@/shared/layout/app-shell/workspace-switcher-core";
import type { WorkspaceLike } from "@/shared/layout/app-shell/workspace-types";
import styles from "@/shared/layout/app-shell/app-shell.module.css";
import { MyAccessProvider } from "@/features/members/hooks/use-my-access";
import { CreateWorkspaceDialogCore } from "@/features/workspaces/components/create-workspace-dialog-core";
import { workspaceSegment as canonicalSegment } from "@/features/workspaces/url";
import { isStandardWorkspace } from "@/features/workspaces/types";
import type { ChannelListPayload } from "@/features/channels/types";
import { channelsPath } from "@/features/channels/client/query-keys";
import { useApiQuery } from "#/hooks/use-api-query";
import { parseSegment } from "@/shared/lib/url/parse-segment";
import { PageError, isUnauthorized } from "#/components/page-states";
import { ShellChromeSkeleton } from "#/components/skeletons/shell-skeleton";
import { sectionSkeleton } from "#/components/skeletons/section-skeleton";
import { SignedOutScreen } from "#/pages/boot/signed-out-screen";
import { SettingsModal, type SettingsSection } from "#/components/settings-modal";
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
 * 🔴 **IT MOUNTS NO GUIDANCE LAYER (Samuel's ruling R-49, 2026-09-17).** The
 * tour, the join-request notices, the connect-agent banner and the welcome
 * popup were mounted here and are DELETED, not unmounted — a first-run
 * experience is designed fresh when it is wanted. Do not re-add one of the four
 * on its own.
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

  // 🔒 THE SHELL NEVER RENDERS A HOME SPACE (2026-09-08). Its surface is
  // /home; a typed or stale `/{personal-segment}` URL — or a cold launch that
  // slipped past `pages/boot` — otherwise paints a workspace overview titled
  // "Home" with no rail icon lit (Samuel's "ghost overview page"). ⚠ `link`
  // containers are fenced by the redirect BELOW, not here: they land on the
  // container's own channel record rather than on /home (R-01(a)).
  useEffect(() => {
    if (workspace?.kind !== "home") return;
    navigate(HOME_PATH, { replace: true });
  }, [workspace?.kind, navigate]);

  /**
   * 🔒 A MEMBER OF A HOME-CHANNEL CONTAINER AT A WORKSPACE URL GOES TO THEIR
   * CHANNEL (Samuel's rulings: ASK-2 option b, 2026-08-30, for the GUEST; R-01
   * option (a), 2026-09-17, for every other member of the same container).
   *
   * ⚠ ONE REDIRECT, WIDENED — not a second branch. A `kind='link'` container is
   * a RELATIONSHIP: nobody in one has a Members console, Skills, Chats or a
   * Settings page carrying an owner delete, whatever their ROLE says. Fencing on
   * `role === "guest"` admitted its member, admin and owner through the one door
   * the guest was kept out of.
   *
   * ⚠ THE FLOOR IS NOT THE FIX AND MUST NOT BECOME ONE. `segment.ts ›
   * BOOT_MIN_ROLE` stays `"guest"`: the two pop-out windows live OUTSIDE this
   * layout and pay the boot read themselves, so raising it to `viewer` renders
   * "Workspace not found" in a guest's popped-out thread. The floor says WHO
   * MAY ASK; this says WHERE THEY LAND.
   *
   * ⚠ THE CONTAINER HAS EXACTLY ONE CHANNEL, resolved the way the guest WEB lane
   * resolves it: `GET /api/channels?scope=account` (`withUserAuth`, no
   * `X-Workspace-Id`, fenced by the caller's own membership rows — so a guest may
   * ask it and a container they do not belong to is not in the answer), matched on
   * `workspaceId`, which is what makes it the SAME container and not merely a
   * channel. ⚠ **IT WAS `GET /api/home/channels` UNTIL R-26 (2026-09-17)**; this
   * read shares the ONE account cache entry rather than minting a second.
   * ⚠ **NO `container.kind` FILTER HERE, AND THAT IS NOT AN ESCAPE FROM G3** — this
   * addresses ONE container BY ID, a stricter fence than any kind test.
   *
   * ⚠ NO CHANNEL ⇒ `/home`, and a FAILED read lands there too. Not
   * UNKNOWN-rendered-as-EMPTY (INVARIANTS §11): `/home` asserts nothing, and
   * claiming "you have no channel" ON a workspace URL is what would be a lie.
   * ⚠ ORDERED BEHIND THE CANONICAL REDIRECT above, and `home` is excluded
   * because the effect above already owns it: any two of these firing in one
   * tick would race two `replace`s over one history entry.
   *
   * ⚠ POSITIVE KIND CHECK (INVARIANTS §4A, F-295), as `pages/home/home-rows.ts`
   * already spells it: `=== "link"`, so a kind added to the union later is
   * EXCLUDED rather than bounced out of the shell (2026-09-17).
   */
  const isContainerMember = !!workspace && workspace.kind === "link";
  const leavesShell = role === "guest" || isContainerMember;
  const containerChannelId = useApiQuery<ChannelListPayload, string | null>(
    channelsPath(),
    {
      enabled: leavesShell,
      // ⚠ **THE SCOPE IS ALWAYS SENT** — it is what picks the route's handler,
      // and it is also this read's cache identity (`use-channels.ts`), so the
      // shell shares the one account entry rather than minting a second.
      query: { scope: "account" },
      // `?? []` is the stale-cache guard (INVARIANTS §8): this payload is
      // IndexedDB-persisted, and a `.find` on an absent key throws INSIDE the
      // shell, which blanks every page rather than one pane.
      select: (body: ChannelListPayload) =>
        (body.channels ?? []).find((c) => c.workspaceId === workspace?.id)?.id ??
        null,
    }
  );
  const containerSettled = leavesShell && !containerChannelId.isPending;
  const containerTarget = containerSettled
    ? containerChannelId.data
      ? `/${segment}/channels/${containerChannelId.data}`
      : HOME_PATH
    : null;
  /** ⚠ ONE DERIVATION, READ TWICE — the effect navigates on it, the loading
   *  gate below holds the ghost on it. A target of `null` (read in flight)
   *  counts: the destination is unknown, the departure is not. */
  const awaitingRedirect = leavesShell && location.pathname !== containerTarget;
  useEffect(() => {
    if (needsRedirect || !segment || !awaitingRedirect || containerTarget === null) return;
    navigate(containerTarget, { replace: true });
  }, [needsRedirect, segment, awaitingRedirect, containerTarget, navigate]);

  /**
   * 🔒 R-05 (Samuel, 2026-09-17): the shell crossfades on PAGE switches too.
   *
   * ⚠ THE TOKEN IS THE PAGE SEGMENT, NOT THE PATH — `knowledge/{slug}` and
   * `channels/{id}` are one page picking a record, and those pages already fade
   * that pick themselves. Not `activeSectionFromPath` either: it answers `null`
   * for every non-nav route, collapsing them onto one token.
   */
  const pageToken = location.pathname.split("/").filter(Boolean)[1] ?? "";

  const workspacesQuery = useApiQuery<
    { workspaces?: WorkspaceLike[] },
    WorkspaceLike[]
  >("/api/workspaces", { select: selectWorkspaces });
  const workspaces = workspacesQuery.data ?? [];

  // ⚠ THE SHELL'S OWN CHROME, NOT A BARE COVER (Samuel, 2026-09-10: the switch
  // ghost *"doesnt look at all like the actual UI"*). This gate rendered
  // `PageLoading` inside a `flex h-screen w-screen flex-col` — a white top bar
  // over a centred column, with the rail, the dark frame, the sidebar and the
  // page card all gone and then rebuilt when the boot answer landed.
  // `ShellChromeSkeleton` IS those four boxes; only the sidebar's contents and
  // the card's are ghosted, so the resolve is a fade rather than a re-layout.
  //
  // ⚠ THE RAIL STAYS REAL AND CLICKABLE whenever `/api/workspaces` has answered
  // (it is cached and IndexedDB-persisted, so on a switch it always has), lit on
  // the tile the operator just pressed — `parseSegment` off the ROUTED path, not
  // off `workspace`, which is the value this gate is waiting for. A publicId
  // survives a slug rename, so a stale segment still lights the right tile.
  // ⚠ AND IT COVERS THE REDIRECT WINDOW TOO (added 2026-09-17, wave 5 review).
  // A member who is leaving is known a round trip before the DESTINATION is, and
  // the navigate is an effect — so `<Outlet/>` rendered here mounts the very page
  // the redirect exists to refuse. Measured: `/members` mounted, ran its own
  // reads and 403'd them, for every container member on every cold load.
  if (isPending || awaitingRedirect) {
    const routed = location.pathname.split("/").filter(Boolean)[0] ?? "";
    return (
      <ShellChromeSkeleton
        rail={
          workspaces.length > 0 ? (
            <AccountRail
              workspaces={workspaces}
              activeWorkspacePublicId={parseSegment(routed)?.publicId ?? null}
              onNavigate={(path) => navigate(path)}
              onCreateWorkspace={() => setCreateWsOpen(true)}
            />
          ) : undefined
        }
      >
        {sectionSkeleton(activeSectionFromPath(location.pathname))}
      </ShellChromeSkeleton>
    );
  }

  // 401 anywhere in the shell = session died → sign-in, not an error card.
  if (isUnauthorized(error)) return <SignedOutScreen />;
  if (error || !workspace) {
    return (
      <div className="flex h-screen w-screen flex-col">
        <PageError
          error={error ?? new ApiError(404, "NOT_FOUND", "Workspace not found")}
          onRetry={refetch}
        />
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
          {/* ⚠ An ATTRIBUTE, not a second class: the panel's and the card's
              class expressions are byte-shared with the shell ghost
              (`skeletons/frame-skeletons.test.tsx`). */}
          <div
            className={cn("page-float", styles.panel)}
            data-no-nav={isContainerMember ? "" : undefined}
          >
            {/* 🔒 R-13 (Samuel, 2026-09-17): the container member gets NO nav,
                DELETED rather than hidden — every row, the switcher and the gear
                pointed at pages the redirect bounces. Same fence as the
                redirect, asked once. */}
            {isContainerMember ? null : (
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
            )}
            {/* ⚠ Required: without it useMyAccessContext no-ops and every
                teams-mode gate resolves to a FALSE edit affordance. */}
            <MyAccessProvider workspaceSegment={segment}>
              {/* ⚠ THE CARD WRAPS THE OUTLET AND NOTHING ELSE, and since R-49
                  there is nothing else: the three notice/guidance mounts that
                  sat OUTSIDE it — they were overlays and `.pageCard` clips —
                  are deleted with the tour that wrapped all of this. */}
              <div className={styles.pageCard}>
                {/* The router owns the tree, so the token says WHEN to fade,
                    not WHAT to hold (INVARIANTS §4A). */}
                <Crossfade token={pageToken} className="flex min-h-0 flex-1 flex-col">
                  {() => <Outlet />}
                </Crossfade>
              </div>
            </MyAccessProvider>
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
