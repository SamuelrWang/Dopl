import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { isStandardWorkspace } from "@/features/workspaces/types";
import { Crossfade } from "@/shared/ui/crossfade";
import type { WorkspaceLike } from "@/shared/layout/app-shell/workspace-types";
import { useAccountChannels } from "@/features/channels/hooks/use-channels";
import shell from "@/shared/layout/app-shell/app-shell.module.css";
import { useApiQuery } from "#/hooks/use-api-query";
import { PageError, isUnauthorized } from "#/components/page-states";
import { SignedOutScreen } from "#/pages/boot/signed-out-screen";
import { bootQueryKey, fetchBoot } from "#/pages/boot/use-boot-state";
import { AccountRail } from "#/components/app-shell";
import { HomeFrame } from "@/features/home/components/shell/home-frame";
import { HomeHeader } from "@/features/home/components/shell/home-header";
import type { HomeViewer } from "@/features/home/components/shell/home-settings-control";
import { RelationshipList } from "./relationship-list";
import { NewChannelDialog } from "@/features/home/components/channels/new-channel-dialog";
import { HomePageSkeleton } from "./home-skeleton";
import { HomePane, paneToken } from "./home-panes";
import { useActivityJump } from "./use-activity-jump";
import { useHomeUnreadClear } from "./use-home-unread-clear";
import { channelRowId, homeRows } from "@/features/home/components/channels/home-rows";
import type { SearchItem } from "@/features/search/contracts";
import { HOME_DEFAULT_TAB, type HomeTab } from "./home-tabs";
import { homeMemory, homeScope } from "./home-memory";
import { readHomeIntent } from "./home-intent";

/**
 * /home — the account surface: personal, cross-org channels, outside `/:workspaceSegment` (there
 * is no workspace here). The faces are local state, not routes. "Identities" means agent
 * identities; the channel info column's Agents tab lists running sessions (INVARIANTS §5A).
 * The caller comes from `POST /api/boot` on the key the boot page seeds (`bootQueryKey(null)`).
 */
export default function HomePage() {
  const navigate = useNavigate();
  const [newChannelOpen, setNewChannelOpen] = useState(false);
  // `undefined` = not chosen since /home mounted, so this device's memory
  // (`./home-memory.ts`) decides; read through `selectedId` / `tab` below.
  const [chosenRowId, setSelectedId] = useState<string | null | undefined>(undefined);
  const [query, setQuery] = useState("");
  const [chosenTab, setTab] = useState<HomeTab | undefined>(undefined);
  // A home channel has no route, so a jump is a selection plus a raised face.
  const jump = useActivityJump({
    onSelect: setSelectedId,
    onRaise: () => setTab("channels"),
  });

  // An arrival from outside /home naming a channel (`./home-intent.ts`): consumed once,
  // through the same jump a search hit takes, then cleared so Back and reload do not replay it.
  const [search, setSearch] = useSearchParams();
  const intent = readHomeIntent(search);
  const intentKey = intent ? search.toString() : null;
  useEffect(() => {
    if (!intent) return;
    jump.open(intent.workspaceId, intent.threadId, intent.seq);
    setSearch({}, { replace: true });
    // `intentKey` IS the intent; `jump`/`setSearch` are fresh each render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [intentKey]);

  /** A left-pane pick or an Overview channel row: drops any held thread and always raises the
   *  channel face, even on the selected row. */
  const openRow = (id: string) => {
    setSelectedId(id);
    jump.clear();
    setTab("channels");
  };

  /**
   * Opens what a search row names: on /home a selection plus a face, never a route (containers
   * have no page). Only a `messages` row carries a `seq` to scroll to (F-714).
   */
  const openSearchHit = (item: SearchItem) => {
    if (item.kind === "knowledge" || item.kind === "agentIdentities") {
      setSelectedId(channelRowId(item.containerId));
      setTab(item.kind === "knowledge" ? "knowledge" : "identities");
      return;
    }
    jump.open(
      item.containerId,
      item.threadId ?? null,
      item.kind === "messages" ? (item.seq ?? null) : null
    );
  };

  const workspacesQuery = useApiQuery<
    { workspaces?: WorkspaceLike[] },
    WorkspaceLike[]
  >("/api/workspaces", { select: selectStandardWorkspaces });
  // The raw payload: /home also renders legacy unbound links, which have no channel.
  const channelsQuery = useAccountChannels();
  const identity = useQuery({
    queryKey: bootQueryKey(null),
    queryFn: ({ signal }) => fetchBoot(null, signal),
  });
  // Gated with the page reads so the Profile pill paints with its photo and name; a failed read
  // falls back to "Profile" at once (no retries holding the skeleton) rather than failing the page.
  const profile = useApiQuery<ProfileBody, HomeViewer>("/api/user/profile", {
    select: selectViewer,
    retry: false,
  });

  // Read once per signed-in user, never per render: a write after the restore
  // must not feed back into it. Boot is the skeleton until it answers, so the
  // first painted face is already the remembered one.
  const userId = identity.data?.userId;
  const remembered = useMemo(
    () => (userId ? homeMemory.read(homeScope(userId)) : null),
    [userId]
  );
  const tab: HomeTab = chosenTab ?? remembered?.tab ?? HOME_DEFAULT_TAB;
  const selectedId =
    chosenRowId !== undefined ? chosenRowId : (remembered?.rowId ?? null);

  const rows = useMemo(
    () => (channelsQuery.data ? homeRows(channelsQuery.data) : []),
    [channelsQuery.data]
  );
  /** The explicit selection, else the first row. Resolved above the early returns: the unread
   *  hook below needs it. */
  const selected =
    rows.find((row) => row.id === selectedId) ?? rows[0] ?? null;
  useHomeUnreadClear(
    selected?.kind === "channel" ? selected.channel.id : null
  );

  const error = channelsQuery.error ?? workspacesQuery.error ?? identity.error;
  const pending =
    channelsQuery.isPending ||
    workspacesQuery.isPending ||
    identity.isPending ||
    profile.isPending;

  // Write back where the operator is. Waits for the rows: on an empty loading
  // list every remembered row would read as gone. A row that IS gone (deleted,
  // left) is stored as null, which is the sweep.
  const ready = !pending && !error && Boolean(userId);
  const rowToStore = rows.some((row) => row.id === selectedId) ? selectedId : null;
  useEffect(() => {
    if (!ready) return;
    homeMemory.write(homeScope(userId), { tab, rowId: rowToStore });
  }, [ready, userId, tab, rowToStore]);

  if (pending) return <HomePageSkeleton face={tab} />;
  if (isUnauthorized(error)) return <SignedOutScreen />;
  if (error || !identity.data) {
    return (
      <div className="flex h-screen w-screen flex-col">
        <PageError
          error={error ?? new Error("Could not open home")}
          onRetry={() => {
            void channelsQuery.refetch();
            void workspacesQuery.refetch();
            void identity.refetch();
          }}
        />
      </div>
    );
  }

  return (
    <div className={shell.root}>
      {/* One layout for every face: only what is inside the pane swaps. */}
      <HomeFrame
        face={tab}
        rail={
          <AccountRail
            workspaces={workspacesQuery.data ?? []}
            activeWorkspacePublicId={null}
            onNavigate={(path) => navigate(path)}
          />
        }
        header={
          <HomeHeader
            identity={identity.data}
            viewer={profile.data ?? null}
            onWorkspaceChanged={() => void workspacesQuery.refetch()}
            tab={tab}
            onTabChange={setTab}
            query={query}
            onQueryChange={setQuery}
            onSearchNavigate={openSearchHit}
            onNewChannel={() => setNewChannelOpen(true)}
            onNavigate={(path) => navigate(path)}
          />
        }
        list={
          <RelationshipList
            rows={rows}
            selectedId={selected?.id ?? null}
            onSelect={openRow}
          />
        }
      >
        {/* The TOKEN crosses the fade; the pane renders whatever `shown` names. */}
        <Crossfade token={paneToken(tab, selected?.id ?? null)} className="flex min-w-0 flex-1">
          {(shown) => (
            <HomePane
              shown={shown}
              rows={rows}
              identity={identity.data}
              viewer={profile.data ?? null}
              jump={jump}
              onChannelDeleted={() => {
                setSelectedId(null);
                void channelsQuery.refetch();
              }}
              onOpenRow={openRow}
            />
          )}
        </Crossfade>
      </HomeFrame>

      {/* Selecting the new row is optimistic about order, not existence: until the refetch
          lands, `selected` falls back to the first row. */}
      <NewChannelDialog
        open={newChannelOpen}
        onOpenChange={setNewChannelOpen}
        onCreated={(workspaceId) => {
          setSelectedId(channelRowId(workspaceId));
          setTab("channels");
        }}
      />
    </div>
  );
}

interface ProfileBody {
  display_name?: string | null;
  avatar_url?: string | null;
}

const selectViewer = (body: ProfileBody): HomeViewer => ({
  displayName: body.display_name ?? null,
  avatarUrl: body.avatar_url ?? null,
});

/** `GET /api/workspaces` also returns `kind='link'` containers; they never appear in the rail. */
const selectStandardWorkspaces = (body: { workspaces?: WorkspaceLike[] }) =>
  (body.workspaces ?? []).filter(isStandardWorkspace);
