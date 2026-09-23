import { useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { cn } from "@/shared/lib/utils";
import { CreateWorkspaceDialogCore } from "@/features/workspaces/components/create-workspace-dialog-core";
import { isStandardWorkspace } from "@/features/workspaces/types";
import { workspaceSegment } from "@/features/workspaces/url";
import { Crossfade } from "@/shared/ui/crossfade";
import type { WorkspaceLike } from "@/shared/layout/app-shell/workspace-types";
// 🔒 **THE ONE CHANNEL LIST (R-26 (b))** — `GET /api/channels?scope=account`,
// read under the same key as every other reader of that projection.
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
// ⚠ THE PANE LEFT THIS FILE ON 2026-09-09 (the fifth face, the 500-line cap) —
// `home-panes.tsx` holds `paneToken` and every branch it selects.
import { HomePane, paneToken } from "./home-panes";
import { useActivityJump } from "./use-activity-jump";
// ⚠ THE UNREAD MARKS CLEAR THEMSELVES (2026-09-13) — the hook carries why it
// watches the transcript's cache entry rather than this page's own click, and
// why ONE cache still owes itself ONE invalidation.
import { useHomeUnreadClear } from "./use-home-unread-clear";

import { channelRowId, homeRows } from "./home-rows";
import type { SearchItem } from "@/features/search/contracts";
// ⚠ THE FACE VOCABULARY LIVES IN ITS OWN MODULE (2026-09-01) — see
// `home-tabs.ts`, which carries the disjointness rule the prefixes rely on.
import { HOME_DEFAULT_TAB, type HomeTab } from "./home-tabs";

/**
 * /home — the ACCOUNT surface (Samuel, 2026-08-21). Personal, cross-org
 * channels: the level workspaces sit on top of, reached from the account
 * rail's pinned tile. Like /onboarding it lives OUTSIDE `/:workspaceSegment`
 * and cannot mount under the workspace shell — there is no workspace here.
 *
 * ⚠ THE RAIL IS FILTERED (2026-08-23). `GET /api/workspaces` is deliberately
 * unfiltered and now returns `kind='link'` CONTAINERS beside real workspaces —
 * one per relationship — so every desktop list runs it through
 * `isStandardWorkspace`. A container is a relationship's plumbing; it is not a
 * place anybody navigates to.
 *
 * ⚠ THE PAGE HAS FIVE FACES AND ALL FIVE ARE BUILT — the header's selector
 * replaces the old "Home" title. Overview (2026-09-01), Channels, Knowledge
 * (2026-08-26, `docs/specs/home-knowledge-panels.plan.md` M3), Agents
 * (2026-08-26, `docs/specs/home-agents-tab.plan.md` M2) and Ontology
 * (2026-09-09, `docs/specs/home-ontology.md` S4). It is LOCAL state, not a
 * route: nothing links to them.
 *
 * ⚠ "CHANNELS" WAS "CHAT" UNTIL 2026-09-01 (Samuel). LABEL AND LOCAL KEY ONLY —
 * `/home` has no per-face route, so there was no URL, no deep link and no
 * persisted value to migrate. Do not read the rename as licence to rename the
 * `channels` PAGE segment (`routes.tsx › WORKSPACE_PAGES`), which is a real
 * path with a hand copy in `dopl-desktop-app/main/deep-link-target.js`.
 *
 * ⚠ "AGENTS" HERE MEANS IDENTITY IDENTITIES, not running sessions — the channel
 * info column has its own **Agents** tab and that one lists live sessions. Both
 * names stay (Samuel's ruling Q6, 2026-08-26); see `identity-panels.tsx` and
 * INVARIANTS §5A.
 *
 * ⚠ THE CALLER'S ID COMES FROM `POST /api/boot`, on the SAME cache key the boot
 * page seeds (`bootQueryKey(null)`) — so arriving here from the rail costs no
 * request and there is no second identity endpoint. Modelled as a query for the
 * reason boot's own docblock gives: idempotent, read-shaped, retry = refetch.
 */
export default function HomePage() {
  const navigate = useNavigate();
  const [createWsOpen, setCreateWsOpen] = useState(false);
  const [newChannelOpen, setNewChannelOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState<HomeTab>(HOME_DEFAULT_TAB);
  // ⚠ OVERVIEW'S ACTIVITY ROWS LAND HERE. A home channel has no route, so the
  // jump is a selection plus a raised face — the hook carries the ruling.
  const jump = useActivityJump({
    onSelect: setSelectedId,
    onRaise: () => setTab("channels"),
  });

  /**
   * OPENING WHAT A SEARCH ROW NAMES (2026-09-17).
   *
   * ⚠ **THE HOST DECIDES WHAT "OPEN" MEANS, AND ON /home IT IS A SELECTION PLUS
   * A FACE — NEVER A ROUTE.** A home channel lives in a `kind='link'` CONTAINER
   * and containers have no page (`use-activity-jump.ts` carries the whole
   * argument); the popup hands over an item and this is the page's answer to it.
   *
   * ⚠ **THE JUMP MECHANISM IS THE OVERVIEW ROW'S, REUSED** — same hook, same
   * three moves (pick the row, raise the face, hand the surface the thread) — so
   * an activity row and a search row land identically.
   *
   * 🔒 **`item.seq` IS HONOURED SINCE 2026-09-17 (F-714 RESOLVED).** The jump
   * carries it down the same three moves — `use-activity-jump.ts › seqFor`,
   * `RelationshipRecord`, `StandaloneChannelSurface` — and the surface fires its
   * OWN nonced scroll signal once the transcript has rows
   * (`channels/components/use-message-jump.ts`), which is the mechanism a
   * citation pill and a Tags mention already use, "older than the loaded
   * history" notice included.
   * ⚠ **ONLY A `kind === "messages"` ROW CARRIES ONE.** A channel or thread row
   * names no message; passing a seq for one would scroll a reader somewhere they
   * did not ask to be.
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
  // ⚠ **THE RAW PAYLOAD, NOT `useChannels`' SELECTED ROWS** — /home also renders
  // the caller's LEGACY unbound links, which have no channel to hang off.
  const channelsQuery = useAccountChannels();
  const identity = useQuery({
    queryKey: bootQueryKey(null),
    queryFn: ({ signal }) => fetchBoot(null, signal),
  });

  const rows = useMemo(
    () => (channelsQuery.data ? homeRows(channelsQuery.data) : []),
    [channelsQuery.data]
  );
  /**
   * 🔒 **THE SEARCH NARROWING IS DELETED (Samuel, 2026-09-17:** *"right now,
   * during search, it just filters by channel name, and it like removes channel
   * on the left sidebar. that doesnt make sense, it should be a pop up like
   * this."*). `visibleRows`, its `searchText`, the list's `totalRows` prop and
   * its "No matches" line went with it — DELETED, not disarmed. The list is
   * every row the operator has, always; what a query answers arrives in the
   * header pill's popup (`@/features/search/components/search-popup`).
   * ⚠ **The record pane therefore falls back to the first REAL row again**,
   * which is what the narrowing had to be lifted here to keep true.
   */

  /**
   * The row the record pane is showing — the explicit selection, else the first
   * row the reader can SEE.
   *
   * ⚠ **RESOLVED ABOVE THE LOADING/ERROR RETURNS SINCE 2026-09-13**, because the
   * unread-refresh HOOK below needs it and a hook may not sit after a conditional
   * return. It moved; it did not change, and it is still the pane's and the
   * list's one answer.
   */
  const selected =
    rows.find((row) => row.id === selectedId) ?? rows[0] ?? null;
  useHomeUnreadClear(
    selected?.kind === "channel" ? selected.channel.id : null
  );

  const error = channelsQuery.error ?? workspacesQuery.error ?? identity.error;
  const pending =
    channelsQuery.isPending || workspacesQuery.isPending || identity.isPending;

  // ⚠ THE PAGE'S OWN FRAME, not the shared page ghost (2026-08-28). This gate
  // used to render `PageLoading` inside a bare `h-screen` box, which painted a
  // centred `max-w-[960px]` column under a 52px bar — a surface /home has never
  // had. `HomePageSkeleton` mirrors what resolves here: the rail, the base
  // panel's header, the 290px list and the bordered record pane.
  if (pending) return <HomePageSkeleton label="Opening home" />;
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
    // ⚠ `!bg-home-frame` (×3) STOOD HERE AND IS DELETED (Samuel, 2026-08-30).
    // Home's frame is one dark slab — shell root, shell surface, account rail —
    // and this page used to be the only surface that said so, forcing the ink
    // on three mounts. The RULING made that the app's frame: `.root`,
    // `.surface`, `.sidebar` and `.rail` all paint `--home-frame` at the source
    // now, so /home simply mounts the shell and gets its slab. **Do not put the
    // overrides back** — the whole point is that there is one statement of the
    // frame and the workspace pages cannot drift off it.
    //
    // ⚠ THE PANEL BUTTS FLUSH-LEFT AGAINST THE RAIL ON /home (Samuel, twice:
    // "rail glyphs look off-centre"). MEASURED cause: the account rail's tiles
    // are perfectly centred in the 54px rail (tile [7,47], rail [0,54]) — but
    // on /home the surface's 8px left margin AND `.page-float`'s 8px left margin
    // are BOTH painted this same home-frame ink, so the panel's left edge lands
    // at x=70 and the eye reads the dark column as 0..70. A rail-centred tile
    // then shows 7px on its left and 23px on its right — the "shifted left" look
    // that TWO glyph resizes could never touch, because resizing never moves the
    // tile within the rail. `!ml-0` on the surface and the panel (below) zero
    // those two dark left margins so the light panel starts at the rail's right
    // edge (x=54): the visible dark column becomes the 54px rail, and the tiles'
    // 7px/7px gutters read centred. The panel keeps its top/right/bottom float —
    // the rail is simply the slab's left frame, so there is no left gap to float
    // over.
    //
    // ⚠ WHY THE WORKSPACE SHELL DOES NOT NEED THE SAME `!ml-0` even though its
    // surface is now the same frame ink (2026-08-30): there the rail is followed
    // by the 232px SIDEBAR, so the dark region is ~294px wide and reads as a
    // frame, not as a column the tiles are supposed to be centred in. The
    // illusion this zeroes is specific to a 70px sliver.
    <div className={shell.root}>
      <div className={shell.body}>
        <AccountRail
          workspaces={workspacesQuery.data ?? []}
          activeWorkspacePublicId={null}
          onNavigate={(path) => navigate(path)}
          onCreateWorkspace={() => setCreateWsOpen(true)}
        />
        {/* ⚠ `!ml-0` DROPPED FROM THE SURFACE (2026-08-30) — `--shell-gap-left`
            is 0 now, so the surface already starts at the rail's right edge on
            BOTH hosts. The one on `<main>` below stays: that is `.page-float`'s
            own left margin, and the workspace panel zeroes the same one in
            `app-shell.module.css › .panel`. */}
        <div className={shell.surface}>
          {/* Layered panels: the BASE panel (`bg-home-panel`) carries the
              header + relationship list; the record pane sits on it, bounded by
              the account palette's 2px line rather than by an elevation (Samuel,
              2026-08-27 — see the pane's own note below). The bg utility outranks
              `.page-float`'s own fill (utility layer > kit layer) — the float
              keeps radius/margins/shadow. */}
          <main
            className={cn(
              // `!ml-0`: flush-left against the rail — see the frame docblock
              // above. `!` beats `.page-float`'s own non-important margin.
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
            {/* ⚠ ONE LAYOUT FOR ALL FOUR TABS (Samuel, 2026-08-24). The
                conversation column and the pane's size and position do not move
                between Overview, Channels, Knowledge and Agents — only what is
                INSIDE the pane swaps. A tab that went full-width read as a
                different page, and Overview joined on that same rule
                (2026-09-01): its GLOBAL sections do not vary with the
                selection, but the list stays put beside them because its
                CHANNEL-SCOPED half is driven by exactly that selection.
                `border-2` + `data-frame-skin`: the pane's outer line reads a
                weight up, and the skin carries that colour and weight INTO the
                shared channel surface — on the workspace channels page too,
                since R-38. */}
            <div className="flex min-h-0 flex-1">
              <RelationshipList
                rows={rows}
                selectedId={selected?.id ?? null}
                // ⚠ A MANUAL PICK DROPS ANY HELD THREAD — "take me to this
                // channel", not "take me back to that thread".
                // 🔒 **AND IT RAISES THE CHANNEL FACE FROM WHEREVER YOU ARE —
                // UNCONDITIONALLY SINCE 2026-09-13** (Samuel, over the Ontology
                // face: *"wherever the user is, if they click on a different
                // channel in the picker, it needs to go to the channel page of
                // that"*). ⚠ **THIS SUPERSEDES THE 2026-09-09 CARVE-OUT** that
                // raised it from OVERVIEW alone, on the argument that Knowledge
                // and Agents render the selected channel's contents so the list
                // beside them is their picker. Samuel's ruling is that the
                // picker names a CHANNEL and the channel's page is where naming
                // one lands; re-pointing a face at another channel is the
                // header selector's job, one click away. Same rule the create
                // path has followed since 2026-09-09 (`NewChannelDialog` below).
                // ⚠ EVERY ROW, INCLUDING THE SELECTED ONE — the row is a plain
                // button with no same-id guard, so clicking where you already
                // are still takes you to its channel page.
                onSelect={(id) => {
                  setSelectedId(id);
                  jump.clear();
                  setTab("channels");
                }}
              />
              <div
                className={cn(
                  // ⚠ NOT `.bento` ANY MORE (Samuel, live review 2026-08-27 — the shadow seam
                  // at the top of the record pane, beside the info column's tab pills).
                  //
                  // ⚠ THE CLASS WAS PAINTING EXACTLY ONE THING: its shadow. `.bento` supplies
                  // fill + a 1px `--border-default` hairline + a 14px radius + two drops, and
                  // the three utilities beside it already restate every one of those except
                  // the drops (`bg-home-card`, `border-2 border-home-panel-line`,
                  // `rounded-[14px]` — the utility layer outranks the kit layer). So the only
                  // live effect it had was `0 1px 2px` + `0 6px 18px` of black.
                  //
                  // ⚠ AND IT HAD NOWHERE TO FALL ON TWO SIDES. The pane takes `mb-3 mr-3` and
                  // NO top or left margin (the header selector is aligned to this pane's left
                  // edge, so a margin there would break that alignment), so the upward half of
                  // an 18px blur printed straight into the 12px gap under the page header —
                  // a gray band running along the pane's top edge, arriving right beside the
                  // tab pills and the blue border. A drop shadow with no gap to fall into is
                  // not elevation, it is a smudge.
                  //
                  // ⚠ SAME RULING AS THE OTHER TWO SURFACES THIS WAVE (`agent-panel.tsx`,
                  // `agent-window.tsx`): these panes are COLUMNS of the surface they sit in,
                  // not cards floating on it. The 2px account-palette border is what says
                  // where the pane starts.
                  "mb-3 mr-3 flex min-w-0 flex-1 overflow-hidden rounded-[14px] border-2 border-home-panel-line bg-home-card"
                )}
                // THE ACCOUNT PALETTE SKIN — the kit's since R-38 (2026-09-17),
                // worn here where `home.module.css › .frame` used to fence it to
                // this page. The workspace channels page wears the same
                // attribute, which is the whole of the ruling.
                data-frame-skin
              >
                {/* ⚠ THE TOKEN, NOT THE CONTENT, is what crosses the fade —
                    the pane renders whatever `shown` names, which lags the
                    selection by one fade-out. ALL THREE faces are keyed by
                    conversation (Knowledge and Agents under their own
                    prefixes) — so every swap crossfades and a live message in
                    the open transcript does not. */}
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

      {/* ⚠ SELECTING THE NEW ROW IS OPTIMISTIC ABOUT ORDER, NOT ABOUT EXISTENCE.
          The row arrives with the channels refetch the write invalidates; until
          it does, `selected` falls back to the first visible row exactly as it
          always has, then snaps to this id. Nothing renders a channel the
          server has not confirmed. */}
      <NewChannelDialog
        open={newChannelOpen}
        onOpenChange={setNewChannelOpen}
        onCreated={(workspaceId) => {
          setSelectedId(channelRowId(workspaceId));
          // ⚠ AND THE FACE MOVES WITH IT (Samuel, 2026-09-09: a new channel
          // goes "directly to the channel's channel page"). Unconditional,
          // unlike the list's own pick above: creating IS the explicit act of
          // going somewhere, from whichever face the operator pressed it on.
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


/** ⚠ Link CONTAINERS never appear in the rail — see the file docblock. */
const selectStandardWorkspaces = (body: { workspaces?: WorkspaceLike[] }) =>
  (body.workspaces ?? []).filter(isStandardWorkspace);
