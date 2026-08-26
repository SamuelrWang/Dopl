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
import { PageError, PageLoading, isUnauthorized } from "#/components/page-states";
import { SignedOutScreen } from "#/pages/boot/signed-out-screen";
import { bootQueryKey, fetchBoot } from "#/pages/boot/use-boot-state";
import { AccountRail } from "#/components/app-shell";
import { RelationshipList } from "./relationship-list";
import { RelationshipRecord } from "./relationship-record";
import { PendingLinkCard } from "./link-out-panel";
import { NewChannelDialog } from "./new-channel-dialog";
import { HomeSearch } from "./home-search";
import { HomeKnowledgePanels } from "./knowledge-panels";
import { HomeAgentPanels } from "./agent-panels";

import {
  HOME_CHANNELS_PATH,
  channelRowId,
  hasLinkOut,
  homeRows,
  visibleRows,
  type HomeFilter,
} from "./home-rows";

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
 * ⚠ THE PAGE HAS THREE FACES (Samuel's wireframe, 2026-08-24) AND ALL THREE ARE
 * BUILT — the header's selector replaces the old "Home" title. Chat, Knowledge
 * (2026-08-26, `docs/specs/home-knowledge-panels.plan.md` M3) and Agents
 * (2026-08-26, `docs/specs/home-agents-tab.plan.md` M2). It is LOCAL state, not
 * a route: nothing links to them.
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
  const [filter, setFilter] = useState<HomeFilter>("all");
  const [tab, setTab] = useState<HomeTab>("chat");

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
  // ⚠ THE FILTER LIVES HERE, not in the list. The record pane falls back to the
  // first row when nothing is selected, and it has to be the first row the
  // reader can SEE — with the filter private to the list, typing into search
  // left the pane on a person the list had already dropped.
  const visible = useMemo(
    () => visibleRows(rows, filter, query),
    [rows, filter, query]
  );
  // ⚠ COUNTED OVER ALL ROWS AND BY THE FILTER'S OWN PREDICATE — the badge is a
  // promise about what picking "Links" will show, and an inline copy of the
  // rule here is how the two come to disagree.
  const linkCount = rows.filter(hasLinkOut).length;

  const error = channelsQuery.error ?? workspacesQuery.error ?? identity.error;
  const pending =
    channelsQuery.isPending || workspacesQuery.isPending || identity.isPending;

  if (pending) {
    return (
      <div className="flex h-screen w-screen flex-col">
        <PageLoading label="Opening home" />
      </div>
    );
  }
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
  // (2026-08-26). Chat always was; Knowledge and then Agents had to become so
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
        onDeleted={() => {
          setSelectedId(null);
          void channelsQuery.refetch();
        }}
      />
    );
  };

  return (
    // `!bg-home-frame` (×3): Home's frame is one dark slab — shell root,
    // shell surface and the account rail — with the base panel floating on it.
    // `!` because the module fills are the same one-class specificity and
    // stylesheet order between module CSS and utilities is not guaranteed.
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
    // over. Workspace shell is unaffected: there `.surface` is the LIGHT
    // `--shell-surface`, so the rail's right edge is already visible at 54px.
    <div className={cn(shell.root, "!bg-home-frame")}>
      <div className={shell.body}>
        <AccountRail
          className="!bg-home-frame"
          workspaces={workspacesQuery.data ?? []}
          activeWorkspacePublicId={null}
          onNavigate={(path) => navigate(path)}
          onCreateWorkspace={() => setCreateWsOpen(true)}
        />
        <div className={cn(shell.surface, "!bg-home-frame", "!ml-0")}>
          {/* Layered panels: the BASE panel (`bg-home-panel`) carries the
              header + relationship list; the record floats on it as a raised
              card. The bg utility outranks `.page-float`'s own fill (utility
              layer > kit layer) — the float keeps radius/margins/shadow. */}
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
            <div className="flex items-center justify-between gap-3 py-3 pl-[var(--home-list-w)] pr-5">
              {/* The selector REPLACES the page title — the surface names
                  itself by which face is raised. */}
              <SegmentedControl<HomeTab>
                options={HOME_TABS}
                value={tab}
                onChange={setTab}
                variant="track"
                size="lg"
              />
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
            {/* ⚠ ONE LAYOUT FOR ALL THREE TABS (Samuel, 2026-08-24). The
                conversation column and the pane's size and position do not move
                between Chat, Knowledge and Agents — only what is INSIDE the
                pane swaps. A tab that went full-width read as a different page.
                `border-2` + `home.frame`: the pane's outer line reads a weight
                up, and `home.frame` carries that colour and weight INTO the
                shared channel surface — scoped to /home, so the workspace
                channels page keeps its neutral hairlines. */}
            <div className="flex min-h-0 flex-1">
              <RelationshipList
                rows={visible}
                linkCount={linkCount}
                selectedId={selected?.id ?? null}
                onSelect={setSelectedId}
                filter={filter}
                onFilterChange={setFilter}
              />
              <div
                className={cn(
                  "bento mb-3 mr-3 flex min-w-0 flex-1 overflow-hidden rounded-[14px] border-2 border-home-panel-line bg-home-card",
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

/** No conversation selected. A token, so the empty pane crossfades like any
 *  other pane content — and it can never collide with a row id. */
const EMPTY_PANE = "empty";

/** Knowledge tokens are `knowledge:<rowId>`. ⚠ The separator matters: row ids
 *  are `rel:`/`link:`-prefixed (`home-rows.ts`), so no chat token can ever be
 *  mistaken for a knowledge one and `slice` recovers the row id exactly. */
const KNOWLEDGE_PANE = "knowledge:";

/** Agents tokens are `agents:<rowId>`. ⚠ Same argument as `KNOWLEDGE_PANE` —
 *  row ids are `rel:`/`link:`-prefixed, so a chat token can never wear this
 *  prefix — plus one more: neither face's prefix is a prefix OF the other, so
 *  the `startsWith` branches in `renderPane` cannot claim each other's tokens. */
const AGENTS_PANE = "agents:";

/** The account surface's three faces, all built (2026-08-26).
 *  ⚠ `"agents"` here is the TEMPLATE face — the channel info column's Agents
 *  tab is a different surface listing live sessions (INVARIANTS §5A). */
type HomeTab = "chat" | "knowledge" | "agents";

const HOME_TABS = [
  { key: "chat", label: "Chat" },
  { key: "knowledge", label: "Knowledge" },
  { key: "agents", label: "Agents" },
] as const satisfies ReadonlyArray<{ key: HomeTab; label: string }>;

/** ⚠ Link CONTAINERS never appear in the rail — see the file docblock. */
const selectStandardWorkspaces = (body: { workspaces?: WorkspaceLike[] }) =>
  (body.workspaces ?? []).filter(isStandardWorkspace);
