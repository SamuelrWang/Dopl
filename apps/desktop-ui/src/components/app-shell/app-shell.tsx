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
import { RequestWorkspaceAccessDialog } from "@/features/workspaces/components/request-workspace-access-dialog";
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
import { homeChannelPath, readThreadSelection } from "#/pages/home/home-intent";
import { AccountRail, HOME_PATH } from "./account-rail";
import { RouterLink } from "./router-link";
import { useWorkspaceRoute } from "./use-workspace-route";

/**
 * The workspace shell — SPA layout route standing in for the web
 * `src/app/[workspaceSlug]/(app)/layout.tsx`.
 *
 * Composes the Next-free CORES (`@/`) with router + transport injected.
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

  // ⚠ The shell reads NO consent and draws no Channels badge (Samuel, 2026-08-25):
  // the outbound review is the work stream's own card
  // (`agent-stream.tsx › SentToChannelBox`). Do not re-add a badge, or the
  // workspace-wide subscription it would mount on every page.
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
  // containers are fenced by the redirect BELOW, which carries the channel.
  useEffect(() => {
    if (workspace?.kind !== "home") return;
    navigate(HOME_PATH, { replace: true });
  }, [workspace?.kind, navigate]);

  /**
   * 🔒 NOBODY IN A HOME-CHANNEL CONTAINER GETS THE SHELL: ANY URL UNDER ITS
   * SEGMENT LANDS ON /home WITH THAT CHANNEL SELECTED (2026-10-29, Samuel: "Yes,
   * fix it"). The container's channel opened as a WORKSPACE channels page — its
   * Assistant/Drafts/Saved sidebar, "No channels yet", no rail icon lit (the rail
   * drops `link` containers) — which Samuel read as "an actual workspace". /home
   * has its own channel page since 2026-10-26, so it is the one destination.
   *
   * ⚠ EVERY ROLE, THE GUEST INCLUDED. A `kind='link'` container is a
   * RELATIONSHIP, so its owner, admin, member, viewer and guest alike have no
   * Members console, Skills, Chats or Settings here (R-01(a), 2026-09-17), and
   * /home serves a guest: its rows are `GET /api/channels?scope=account`
   * (`withUserAuth`, fenced by the caller's own channel memberships, guest rows
   * included) and the page draws a guest's narrower controls (F-343).
   * ⚠ THE TARGET NEEDS NO READ: /home addresses the row by CONTAINER id
   * (`home-rows.ts › channelRowId`), and `?thread=`/`?seq=` ride across into the
   * jump /home already uses (`pages/home/home-intent.ts`). A container missing
   * from /home's rows falls back to its first row, so an empty or failed read
   * still lands on /home.
   *
   * ⚠ A GUEST OF A STANDARD WORKSPACE STILL GOES TO THEIR CHANNEL ON THIS
   * WORKSPACE'S ROUTE (ASK-2 option b, 2026-08-30): `GET /api/channels?scope=account`
   * matched on `workspaceId` (the SAME container, not merely a channel; the one
   * account cache entry since R-26), and NO CHANNEL ⇒ `/home`, a FAILED read too
   * — `/home` asserts nothing, where "you have no channel" on a workspace URL
   * would be a lie (INVARIANTS §11).
   *
   * ⚠ THE FLOOR IS NOT THE FIX AND MUST NOT BECOME ONE. `segment.ts ›
   * BOOT_MIN_ROLE` stays `"guest"`: the two pop-out windows live OUTSIDE this
   * layout and pay the boot read themselves, so raising it to `viewer` renders
   * "Workspace not found" in a guest's popped-out thread. The floor says WHO
   * MAY ASK; this says WHERE THEY LAND.
   *
   * ⚠ ORDERED BEHIND THE CANONICAL REDIRECT above, and `home` is excluded
   * because the effect above already owns it: any two of these firing in one
   * tick would race two `replace`s over one history entry.
   * ⚠ POSITIVE KIND CHECK (INVARIANTS §4A, F-295): `=== "link"`, so a kind added
   * to the union later is EXCLUDED rather than bounced out of the shell.
   */
  const isContainerMember = !!workspace && workspace.kind === "link";
  const isWorkspaceGuest = role === "guest" && !!workspace && !isContainerMember;
  const guestChannelId = useApiQuery<ChannelListPayload, string | null>(
    channelsPath(),
    {
      enabled: isWorkspaceGuest,
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
  const guestTarget =
    isWorkspaceGuest && !guestChannelId.isPending
      ? guestChannelId.data
        ? `/${segment}/channels/${guestChannelId.data}`
        : HOME_PATH
      : null;
  const containerTarget = isContainerMember
    ? homeIntentFor(workspace.id, location.search)
    : guestTarget;
  /** ⚠ ONE DERIVATION, READ TWICE — the effect navigates on it, the loading
   *  gate below holds the ghost on it. A container member is ALWAYS leaving
   *  (their target is off the shell); a guest's `null` target (read in flight)
   *  counts too: the destination is unknown, the departure is not. */
  const awaitingRedirect =
    isContainerMember || (isWorkspaceGuest && location.pathname !== guestTarget);
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
  // The navigate is an effect (and a guest's destination a round trip away), so
  // `<Outlet/>` rendered here mounts the very page the redirect exists to refuse.
  // Measured: `/members` mounted, ran its own reads and 403'd them, for every
  // container member on every cold load. A container member never passes it.
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

      {/* 🔒 GATED (Samuel, 2026-10-15): the switcher's "Create workspace" opens the
          same invite-only popup as the rail's create tile (`shared/layout/app-shell/account-rail-core.tsx`). */}
      <RequestWorkspaceAccessDialog open={createWsOpen} onOpenChange={setCreateWsOpen} />

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

/** A container member's destination: /home on that container's row, carrying the
 *  `?thread=`/`?seq=` the workspace URL was opened with (`pages/home/home-intent.ts`). */
function homeIntentFor(workspaceId: string, search: string): string {
  const { threadId, seq } = readThreadSelection(new URLSearchParams(search));
  return homeChannelPath(workspaceId, threadId, seq);
}
