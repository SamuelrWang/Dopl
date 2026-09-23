import { useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { cn } from "@/shared/lib/utils";
import { CreateWorkspaceDialogCore } from "@/features/workspaces/components/create-workspace-dialog-core";
import { isStandardWorkspace } from "@/features/workspaces/types";
import { workspaceSegment } from "@/features/workspaces/url";
import { Crossfade } from "@/shared/ui/crossfade";
import type { WorkspaceLike } from "@/shared/layout/app-shell/workspace-types";
import { useAccountChannels } from "@/features/channels/hooks/use-channels";
import shell from "@/shared/layout/app-shell/app-shell.module.css";
import home from "./home.module.css";
import { useApiQuery } from "#/hooks/use-api-query";
import { PageError, isUnauthorized } from "#/components/page-states";
import { SignedOutScreen } from "#/pages/boot/signed-out-screen";
import { bootQueryKey, fetchBoot } from "#/pages/boot/use-boot-state";
import { AccountRail } from "#/components/app-shell";
import { HomeHeader } from "./home-header";
import { RelationshipList } from "./relationship-list";
import { NewChannelDialog } from "./new-channel-dialog";
import { HomePageSkeleton } from "./home-skeleton";
import { HomePane, paneToken } from "./home-panes";
import { useActivityJump } from "./use-activity-jump";
import { useHomeUnreadClear } from "./use-home-unread-clear";

import { channelRowId, homeRows } from "./home-rows";
import type { SearchItem } from "@/features/search/contracts";
import { HOME_DEFAULT_TAB, type HomeTab } from "./home-tabs";

/**
 * /home — the account surface: personal, cross-org channels, outside `/:workspaceSegment` (there
 * is no workspace here). The faces are local state, not routes. "Identities" means agent
 * identities; the channel info column's Agents tab lists running sessions (INVARIANTS §5A).
 * The caller comes from `POST /api/boot` on the key the boot page seeds (`bootQueryKey(null)`).
 */
export default function HomePage() {
  const navigate = useNavigate();
  const [createWsOpen, setCreateWsOpen] = useState(false);
  const [newChannelOpen, setNewChannelOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState<HomeTab>(HOME_DEFAULT_TAB);
  // A home channel has no route, so a jump is a selection plus a raised face.
  const jump = useActivityJump({
    onSelect: setSelectedId,
    onRaise: () => setTab("channels"),
  });

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
    channelsQuery.isPending || workspacesQuery.isPending || identity.isPending;

  if (pending) return <HomePageSkeleton />;
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
    // The frame ink is the shell's own. `!ml-0` on `<main>` puts the panel flush against the rail,
    // so the visible dark column is exactly the 54px rail and its tiles read centred.
    <div className={shell.root}>
      <div className={shell.body}>
        <AccountRail
          workspaces={workspacesQuery.data ?? []}
          activeWorkspacePublicId={null}
          onNavigate={(path) => navigate(path)}
          onCreateWorkspace={() => setCreateWsOpen(true)}
        />
        <div className={shell.surface}>
          {/* The base panel carries header + list; the record pane sits on it. The bg utility
              outranks `.page-float`'s fill (utility layer > kit layer). */}
          <main
            className={cn(
              // `!` beats `.page-float`'s own non-important margin.
              "page-float !ml-0 flex flex-1 flex-col overflow-hidden bg-home-panel",
              home.page
            )}
          >
            <HomeHeader
              identity={identity.data}
              onWorkspaceChanged={() => void workspacesQuery.refetch()}
              tab={tab}
              onTabChange={setTab}
              query={query}
              onQueryChange={setQuery}
              onSearchNavigate={openSearchHit}
              onNewChannel={() => setNewChannelOpen(true)}
            />
            {/* One layout for every face: only what is inside the pane swaps. `data-frame-skin`
                carries the pane's line colour and weight into the channel surface. */}
            <div className="flex min-h-0 flex-1">
              <RelationshipList
                rows={rows}
                selectedId={selected?.id ?? null}
                // A pick drops any held thread and always raises the channel face, even on the
                // selected row.
                onSelect={(id) => {
                  setSelectedId(id);
                  jump.clear();
                  setTab("channels");
                }}
              />
              <div
                className={cn(
                  // Not `.bento`: the pane is a column of the surface, bounded by its 2px line; a
                  // drop shadow here had no gap to fall into.
                  "mb-3 mr-3 flex min-w-0 flex-1 overflow-hidden rounded-[14px] border-2 border-home-panel-line bg-home-card"
                )}
                data-frame-skin
              >
                {/* The TOKEN crosses the fade; the pane renders whatever `shown` names. */}
                <Crossfade
                  token={paneToken(tab, selected?.id ?? null)}
                  className="flex min-w-0 flex-1"
                >
                  {(shown) => (
                    <HomePane
                      shown={shown}
                      rows={rows}
                      identity={identity.data}
                      jump={jump}
                      onChannelDeleted={() => {
                        setSelectedId(null);
                        void channelsQuery.refetch();
                      }}
                    />
                  )}
                </Crossfade>
              </div>
            </div>
          </main>
        </div>
      </div>

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

      <CreateWorkspaceDialogCore
        open={createWsOpen}
        onOpenChange={setCreateWsOpen}
        onCreated={(created) => {
          void workspacesQuery.refetch();
          navigate(`/${workspaceSegment(created)}`);
        }}
      />

    </div>
  );
}


/** `GET /api/workspaces` also returns `kind='link'` containers; they never appear in the rail. */
const selectStandardWorkspaces = (body: { workspaces?: WorkspaceLike[] }) =>
  (body.workspaces ?? []).filter(isStandardWorkspace);
