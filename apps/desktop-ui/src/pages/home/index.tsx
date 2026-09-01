import { useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { Link2, Search } from "lucide-react";
import { cn } from "@/shared/lib/utils";
import { CreateWorkspaceDialogCore } from "@/features/workspaces/components/create-workspace-dialog-core";
import { isStandardWorkspace } from "@/features/workspaces/types";
import { workspaceSegment } from "@/features/workspaces/url";
import { EmptyState } from "@/shared/ui/empty-state";
import { SegmentedControl } from "@/shared/ui/segmented-control";
import { Crossfade } from "@/shared/ui/crossfade";
import type { WorkspaceLike } from "@/shared/layout/app-shell/workspace-types";
import type { HomeChannelsPayload } from "@/features/home/types";
import shell from "@/shared/layout/app-shell/app-shell.module.css";
import home from "./home.module.css";
import { useApiQuery } from "#/hooks/use-api-query";
import { PageError, isUnauthorized } from "#/components/page-states";
import { SignedOutScreen } from "#/pages/boot/signed-out-screen";
import { bootQueryKey, fetchBoot } from "#/pages/boot/use-boot-state";
import { AccountRail } from "#/components/app-shell";
import { HomeSettingsControl } from "./home-settings-control";
import { RelationshipList } from "./relationship-list";
import { RelationshipRecord } from "./relationship-record";
import { PendingLinkCard } from "./link-out-panel";
import { NewChannelDialog } from "./new-channel-dialog";
import { HomeSearch } from "./home-search";
import { HomePageSkeleton } from "./home-skeleton";
import { HomeKnowledgePanels } from "./knowledge-panels";
import { HomeAgentPanels } from "./agent-panels";
import { HomeOverviewPanels } from "./overview-panels";
import { useActivityJump } from "./use-activity-jump";

import {
  HOME_CHANNELS_PATH,
  channelRowId,
  homeRows,
  visibleRows,
} from "./home-rows";
// ⚠ THE FACE VOCABULARY LIVES IN ITS OWN MODULE (2026-09-01) — see
// `home-tabs.ts`, which carries the disjointness rule the prefixes rely on.
import {
  AGENTS_PANE,
  EMPTY_PANE,
  HOME_DEFAULT_TAB,
  HOME_TABS,
  KNOWLEDGE_PANE,
  OVERVIEW_PANE,
  type HomeTab,
} from "./home-tabs";

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
 * ⚠ THE PAGE HAS FOUR FACES AND ALL FOUR ARE BUILT — the header's selector
 * replaces the old "Home" title. Overview (2026-09-01), Channels, Knowledge
 * (2026-08-26, `docs/specs/home-knowledge-panels.plan.md` M3) and Agents
 * (2026-08-26, `docs/specs/home-agents-tab.plan.md` M2). It is LOCAL state, not
 * a route: nothing links to them.
 *
 * ⚠ "CHANNELS" WAS "CHAT" UNTIL 2026-09-01 (Samuel). LABEL AND LOCAL KEY ONLY —
 * `/home` has no per-face route, so there was no URL, no deep link and no
 * persisted value to migrate. Do not read the rename as licence to rename the
 * `channels` PAGE segment (`routes.tsx › WORKSPACE_PAGES`), which is a real
 * path with a hand copy in `dopl-desktop-app/main/deep-link-target.js`.
 *
 * ⚠ "AGENTS" HERE MEANS TEMPLATE IDENTITIES, not running sessions — the channel
 * info column has its own **Agents** tab and that one lists live sessions. Both
 * names stay (Samuel's ruling Q6, 2026-08-26); see `agent-panels.tsx` and
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

  const workspacesQuery = useApiQuery<
    { workspaces?: WorkspaceLike[] },
    WorkspaceLike[]
  >("/api/workspaces", { select: selectStandardWorkspaces });
  const channelsQuery = useApiQuery<HomeChannelsPayload>(HOME_CHANNELS_PATH);
  const identity = useQuery({
    queryKey: bootQueryKey(null),
    queryFn: ({ signal }) => fetchBoot(null, signal),
  });

  const rows = useMemo(
    () => (channelsQuery.data ? homeRows(channelsQuery.data) : []),
    [channelsQuery.data]
  );
  // ⚠ THE NARROWING LIVES HERE, not in the list. The record pane falls back to
  // the first row when nothing is selected, and it has to be the first row the
  // reader can SEE — with it private to the list, typing into search left the
  // pane on a person the list had already dropped.
  const visible = useMemo(() => visibleRows(rows, query), [rows, query]);

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

  const selected =
    visible.find((row) => row.id === selectedId) ?? visible[0] ?? null;


  // 🔒 EVERY FACE THAT RENDERS A CHANNEL IS KEYED BY THE ROW, NOT BY THE TAB
  // (2026-08-26). Channels always was; Knowledge and then Agents had to become so
  // the moment they started rendering a CHANNEL's contents. Keyed by the bare
  // tab name, switching channels leaves the token frozen at `"knowledge"` /
  // `"agents"` — the crossfade never fires and the pane swaps one channel's
  // bases (or templates) for another's UNDER a token that says nothing changed,
  // which is the 150ms wrong-channel flash.
  const paneToken =
    tab === "knowledge"
      ? `${KNOWLEDGE_PANE}${selected?.id ?? EMPTY_PANE}`
      : tab === "agents"
        ? `${AGENTS_PANE}${selected?.id ?? EMPTY_PANE}`
        : tab === "overview"
          // 🔒 THE OVERVIEW TOKEN CARRIES NO ROW (2026-09-01). Every other face
          // renders a CHANNEL's contents and so must re-key on the selection;
          // this one is cross-channel, so keying it by `selected` would remount
          // and refetch the whole analytics face every time the operator
          // clicked a different row in the list beside it — a crossfade with
          // nothing to fade to.
          ? OVERVIEW_PANE
          : (selected?.id ?? EMPTY_PANE);

  /** The row a pane token names, or `null`. ⚠ READ OUT OF THE TOKEN, never out
   *  of `selected` — that is what makes the pane pure in `shown` and lets the
   *  outgoing channel's panels finish their fade against their own data. */
  const rowFor = (id: string) =>
    visible.find((candidate) => candidate.id === id) ?? null;

  /** What the pane shows for one token. ⚠ PURE IN `shown`, because the crossfade
   *  renders the PREVIOUS token for a beat after the selection moves — reading
   *  `selected` here instead would swap the content before the fade.
   *
   *  ⚠ FIXED BRANCH ORDER, PREFIXED FACES FIRST. The two prefixes are disjoint
   *  and neither can be a row id (see their docblocks), so no token is claimed
   *  twice; the order is fixed anyway so that adding a fourth face is a
   *  one-line insertion above the bare-row fallback rather than a re-reading of
   *  which branch wins. */
  const renderPane = (shown: string) => {
    if (shown === OVERVIEW_PANE) {
      // ⚠ NO ROW IS READ OUT OF THIS TOKEN and there is none in it — the face is
      // cross-channel (see `paneToken` above and
      // `home/server/service-overview.ts`, which carries why the channel-scoped
      // half was deleted).
      // ⚠ `homeWorkspaceId` is the SAME boot query the other faces read — the
      // credit bar is the PAYER's, and a home channel's MCP burn reroutes to
      // that workspace (`billing/server/credits-service.ts ›
      // resolveBillingTarget`). NULL until the caller is onboarded.
      return (
        <HomeOverviewPanels
          homeWorkspaceId={identity.data.workspace?.id ?? null}
          onOpenActivity={jump.open}
        />
      );
    }
    if (shown.startsWith(AGENTS_PANE)) {
      const shownRow = rowFor(shown.slice(AGENTS_PANE.length));
      return (
        <HomeAgentPanels
          // 🔒 KEYED BY THE TOKEN — one token, one instance, and it was NOT so
          // until 2026-08-26 (F-338). `Crossfade` renders `{children(shownToken)}`
          // with no key of its own and every `agents:<rowId>` token returns this
          // element at the SAME position, so React reconciled ONE instance across
          // a channel switch and the panel's held state (`scope`, `editing`,
          // `copying`) survived while `channel.workspaceId` moved underneath it.
          // That is not a stale render: the editor and the copy dialog take the
          // target workspace as a PROP, so a create composed against the old row
          // POSTed into the NEW container and SUCCEEDED — no 404, no rollback,
          // the wrong relationship's container. ⚠ AND THE SWITCH NEED NOT BE A
          // CLICK: `selected` falls back to `visible[0]` whenever the selected
          // row leaves `visible` (a roster change, an archive, the peer-joins
          // teardown), so the held row can move with nobody touching the list.
          // ⚠ THE KEY IS THE TOKEN, NOT THE ROW: keying a face by the same value
          // its parent swaps on is the whole statement — one token, one
          // instance — and it stays true for a face keyed by more than a row id.
          key={shown}
          channel={shownRow?.kind === "channel" ? shownRow.channel : null}
          // ⚠ SAME BOOT QUERY AS KNOWLEDGE'S SCOPE C — the home workspace is
          // `POST /api/boot`'s no-segment answer, so the second template list
          // costs no extra identity read. NULL until the caller is onboarded.
          // ⚠ The SEGMENT rides it too and the home-workspace editor needs it
          // (its teams read is keyed by the segment, not the id); boot's `role`
          // does NOT go to this face — nothing on it is role-gated.
          homeWorkspaceId={identity.data.workspace?.id ?? null}
          homeWorkspaceSegment={identity.data.segment}
          currentUserId={identity.data.userId}
        />
      );
    }
    if (shown.startsWith(KNOWLEDGE_PANE)) {
      const shownRow = rowFor(shown.slice(KNOWLEDGE_PANE.length));
      return (
        <HomeKnowledgePanels
          // 🔒 KEYED BY THE ROW, exactly as the chat branch below is, and it was
          // NOT until 2026-08-26. `paneToken` fixes the CROSSFADE; it does not
          // remount, so React reconciled channel B's panels onto channel A's
          // component instance and the pane's own `useState` survived the
          // switch. `openBase` is the sharp one: a base opened in channel A
          // stayed open across the switch and was then mounted against channel
          // B's `workspaceId`, i.e. a 404 error pane over a base that exists.
          // `scope` survived too, which is merely wrong rather than broken.
          // ⚠ `knowledge-tab.tsx` had already solved this on the CHANNEL side;
          // this is the same fix on the /home side. A pane holding per-channel
          // state owes itself a key — the token is about the animation.
          key={shownRow?.id ?? EMPTY_PANE}
          channel={shownRow?.kind === "channel" ? shownRow.channel : null}
          // ⚠ ALREADY IN THIS PAGE'S BOOT QUERY — the home workspace is
          // `POST /api/boot`'s no-segment answer, so scope C costs no second
          // identity read. NULL until the caller is onboarded; the panel says
          // so rather than fetching a workspace that does not exist.
          homeWorkspaceId={identity.data.workspace?.id ?? null}
          homeWorkspaceSegment={identity.data.segment}
          homeRole={identity.data.role}
          currentUserId={identity.data.userId}
        />
      );
    }
    const row = rowFor(shown);
    if (row === null) {
      // ⚠ Two reasons for an empty pane, and they are not the same sentence:
      // nothing to show, or nothing MATCHING to show.
      return rows.length > 0 ? (
        <EmptyState icon={Search} title="No matches" />
      ) : (
        <EmptyState
          icon={Link2}
          title="No channels yet"
          description="Create one and launch an agent into it."
        />
      );
    }
    if (row.kind === "link") return <PendingLinkCard key={row.id} link={row.link} />;
    return (
      <RelationshipRecord
        key={row.id}
        homeChannel={row.channel}
        currentUserId={identity.data.userId}
        // ⚠ KEYED BY THE ROW, so a thread picked in channel A can never be
        // raised inside channel B — see `use-activity-jump.ts`.
        initialThreadId={jump.threadFor(row.id)}
        onDeleted={() => {
          setSelectedId(null);
          void channelsQuery.refetch();
        }}
      />
    );
  };

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
            {/* ⚠ SYMMETRIC PADDING. The controls are one 36px row and they sit
                CENTRED in the strip.
                ⚠ THE LEFT PAD IS THE LIST COLUMN'S WIDTH, not a spacer: it puts
                the selector's left edge on the record pane's (Samuel,
                2026-08-24). Same var the column is sized from — see
                `home.module.css › .page`. */}
            <div className="flex items-center justify-between gap-3 py-3 pr-5">
              {/* ⚠ THE LEFT PAD BECAME A REAL CELL (2026-08-30) AND THE WIDTH IS
                  WHY IT STILL ALIGNS. It was `pl-[var(--home-list-w)]` on this
                  row; the operator's face needed to live IN the list column, so
                  the pad is now a cell of exactly that width holding it, and the
                  selector starts on the record pane's left edge as before —
                  same var, same edge (`home.module.css › .page`).
                  ⚠ THE TWO ARE ONE GROUP, or `justify-between` would spread
                  three children and walk the selector off that edge. */}
              <div className="flex min-w-0 items-center">
                <div className="flex w-[var(--home-list-w)] shrink-0 items-center px-3">
                  <HomeSettingsControl
                    identity={identity.data}
                    onWorkspaceChanged={() => void workspacesQuery.refetch()}
                  />
                </div>
                {/* The selector REPLACES the page title — the surface names
                    itself by which face is raised. */}
                <SegmentedControl<HomeTab>
                  options={HOME_TABS}
                  value={tab}
                  onChange={setTab}
                  variant="track"
                  size="lg"
                />
              </div>
              <div className="flex items-center gap-2.5">
                <HomeSearch query={query} onQueryChange={setQuery} />
                {/* ⚠ ONE PRIMARY ACTION, AND IT IS "New channel" (Samuel,
                    2026-08-25). The mint popover was here as an interim while
                    links were still page-level; it now lives on the channel it
                    binds to (`person-info-tab.tsx`), because that is the thing
                    it acts on. Do not put a second black pill back here. */}
                <button
                  type="button"
                  onClick={() => setNewChannelOpen(true)}
                  className="auth-btn-3d flex h-9 cursor-pointer items-center rounded-full px-[15px] text-small font-semibold text-white"
                >
                  New channel
                </button>
              </div>
            </div>
            {/* ⚠ ONE LAYOUT FOR ALL FOUR TABS (Samuel, 2026-08-24). The
                conversation column and the pane's size and position do not move
                between Overview, Channels, Knowledge and Agents — only what is
                INSIDE the pane swaps. A tab that went full-width read as a
                different page, and Overview joined on that same rule
                (2026-09-01): its GLOBAL sections do not vary with the
                selection, but the list stays put beside them because its
                CHANNEL-SCOPED half is driven by exactly that selection.
                `border-2` + `home.frame`: the pane's outer line reads a weight
                up, and `home.frame` carries that colour and weight INTO the
                shared channel surface — scoped to /home, so the workspace
                channels page keeps its neutral hairlines. */}
            <div className="flex min-h-0 flex-1">
              <RelationshipList
                rows={visible}
                selectedId={selected?.id ?? null}
                // ⚠ A MANUAL PICK DROPS ANY HELD THREAD — "take me to this
                // channel", not "take me back to that thread".
                onSelect={(id) => {
                  setSelectedId(id);
                  jump.clear();
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
                  "mb-3 mr-3 flex min-w-0 flex-1 overflow-hidden rounded-[14px] border-2 border-home-panel-line bg-home-card",
                  home.frame
                )}
              >
                {/* ⚠ THE TOKEN, NOT THE CONTENT, is what crosses the fade —
                    the pane renders whatever `shown` names, which lags the
                    selection by one fade-out. ALL THREE faces are keyed by
                    conversation (Knowledge and Agents under their own
                    prefixes) — so every swap crossfades and a live message in
                    the open transcript does not. */}
                <Crossfade token={paneToken} className="flex min-w-0 flex-1">
                  {(shown) => renderPane(shown)}
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
        onCreated={(workspaceId) => setSelectedId(channelRowId(workspaceId))}
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
