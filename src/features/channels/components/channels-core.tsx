"use client";

import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { LinkLike } from "@/shared/ui/link-like";
import { meetsMinRole, type Role } from "@/features/workspaces/types";
import { useChannels } from "../hooks/use-channels";
import { channelKeys } from "../client/query-keys";
import { ChannelsSkeleton } from "./channels-skeleton";
import { ChannelsOnboardingCore } from "./channels-onboarding-core";
import { ChannelsOverlays } from "./overlays";
import { ChannelsSidebar } from "./sidebar";
import { ChannelSurface } from "./channel-surface";
import { useChannelSurfaceData } from "./channel-surface-data";
import type { Channel } from "../types";
import type { SearchItem } from "@/features/search/contracts";
// Kept on one line each: this file has repeatedly sat within a handful of lines
// of the 500-line cap, and CROSSED it on 2026-08-20 (re-measure, do not quote).
import { splitChannels } from "./view-model";
import { useChannelsSelection } from "./use-channels-selection";

export interface ChannelsCoreProps {
  workspaceId: string;
  workspaceSlug: string;
  currentUserId: string;
  role: Role;
  /**
   * Router-agnostic link — `next/link` on the web, react-router in the SPA.
   * ⚠ ONE consumer, and it is the reason the prop exists at all: the first-run
   * explainer's step cards (`channels-onboarding-core.tsx`). Nothing else in
   * this tree routes, and nothing else may take it.
   */
  Link: LinkLike;
  /**
   * The channel a CALLER named, as an initial selection — the desktop's
   * `/channels/:channelId` route hands its param down (wiring plan Phase 9,
   * renamed off `channels-v2` at the Phase 12 cutover). A plain prop,
   * deliberately: this tree is router-free, so the SPA page owns the param read
   * and this owns nothing but the selection.
   */
  initialChannelId?: string | null;
  /**
   * The thread a CALLER named, as an initial selection inside `initialChannelId`,
   * read off `?thread=` by the SPA page (wiring plan Phase 10, 2026-08-18).
   * ⚠ IT WAS THE POP-OUT WINDOW'S LANDING UNTIL 2026-08-19 — the pop-out has a
   * thread-ONLY route of its own now (`pages/thread-window/`) and never lands here.
   *
   * ⚠ A SELECTION, NOT A ROUTE. A thread is not a page: it is which transcript
   * the channels page has open, so this rides the `channels/:channelId` row the
   * cutover built and adds no route and no deep-link grammar. It is
   * also DERIVED-CHECKED below like every other pick — a thread id not in this
   * channel's list falls back to the channel view rather than an empty thread.
   */
  initialThreadId?: string | null;
  /**
   * WHERE A SEARCH-POPUP ROW GOES WHEN IT IS NOT IN THIS PAGE (2026-09-17).
   *
   * ⚠ **A PATH, NOT A ROUTER.** This tree is router-free by construction (see
   * `Link` above), and the popup's Knowledge / Agents / Members / Skills / Chats
   * rows NAME a different PAGE of this workspace — so the host navigates and this
   * file only says where. A host that passes nothing simply does not move for
   * those rows; the channel, thread and message rows are answered here.
   */
  onNavigatePath?: (path: string) => void;
}

/**
 * Channels root — the three-column shell (channel tree · transcript ·
 * channel info) over the REAL channels reads.
 *
 * ⚠ THERE IS NO FOURTH CENTER-COLUMN DESTINATION ANY MORE (Samuel, 2026-08-25).
 * `inbox-pane.tsx` — the consent Inbox, behind the sidebar's Inbox nav row — is
 * DELETED, along with that row, its badge and the selection's `inboxOpen`. The
 * outbound review it existed for moved INTO the work stream's own card
 * (`agent-stream.tsx › SentToChannelBox`), where a solo /home channel can reach
 * it too; the GATE is untouched (INVARIANTS §6). Do not reintroduce a takeover
 * pane for it — a second review surface is a second vocabulary for one decision.
 *
 * **THIS IS THE SHIPPING CHANNELS PAGE** since the cutover (wiring plan
 * Phase 12, 2026-08-18): `channels-view-core.tsx` and the two-pane surface
 * under it are DELETED, and `/:workspaceSegment/channels` mounts this tree.
 *
 * ⚠ EVERYTHING RIGHT OF THE TREE IS `channel-surface.tsx` NOW (2026-08-23), and
 * its state is `channel-surface-data.ts`. What is left HERE is the part that is
 * about the WORKSPACE rather than about one channel: the channel LIST, the tree,
 * the first-run explainer and the create dialogs. The move
 * was a lift — same DOM, same order, same hooks in the same order — because the
 * second host of that surface (`channel-surface-standalone.tsx`, one fixed
 * channel with no tree) must not be a second implementation of it.
 *
 * ⚠ NOT READ-ONLY ANY MORE (it was, through Phase 2). FIVE write families land
 * from this tree (INVARIANTS §7), all through the existing write layer, none a
 * new endpoint: the composer's send / request fan-out (Phase 3), the Tags
 * inbox's mark-read (Phase 6), the OUTBOUND send decision (Phase 8; its inbound
 * half retired 2026-08-22, and its Inbox pane deleted 2026-08-25 — the decision
 * is the work stream's card), the channel-management writes the CUTOVER
 * added (create / invite / visibility / archive / delete / leave / tool profile —
 * TRUST went with that same retirement), which arrived WHOLESALE
 * from the deleted page and live in `channel-manage.tsx`, and the header
 * bookmark's FAVOURITE (2026-08-19), which rides the same per-member preference
 * route as the tool profile. All five hold the same `useRefetchGate` gate the
 * reads register.
 *
 * ⚠ A FAVOURITE IS A MOVE, NOT A SHORTCUT (Samuel, 2026-08-19 — superseding the
 * SHORTCUT / Slack-semantics ruling of the same day). The favourited channel
 * leaves Channels or Direct messages and renders only in Favorites; one channel
 * is one row. The sidebar's docblock owns the rest of the rule.
 * ⚠ Every read of `myFavoritedAt` is `!= null`, never `!==` — version skew;
 * `sidebar.tsx › isFavorite` carries the reason.
 *
 * ⚠ NO PARALLEL HOOK LAYER AND NO AD-HOC FETCHES. Every read on this surface is
 * a feature hook — `use-channels` here, and `use-channel-messages`,
 * `use-channel-members`, `use-channel-threads`, `use-consent-inbox` and
 * `use-channel-mentions` in the surface's data hook. Where a hook's shape did not
 * fit (the sidebar's 24h window, the transcript's sides, the thread parties) the
 * adaptation is `view-model.ts`, at the COMPONENT boundary, never a fork of the
 * hook.
 *
 * ⚠ Next-free by construction so the desktop SPA can bundle it — the same
 * constraint the retired `channels-view-core.tsx` documented. The ONE router
 * dependency arrives as the `Link` prop and has exactly one consumer, the
 * first-run explainer (`channels-onboarding-core.tsx`), which the cutover
 * rehomed onto this surface's no-channels branch — Samuel's ruling was KEEP
 * for now, redesign later, and the old page was its only reachable entry.
 *
 * ⚠ REALTIME IS LIVE IN BOTH CLIENTS and this surface registers for it; the
 * SPA rides the ui-sync DOORBELL, not a websocket (INVARIANTS §7, F-199 —
 * `live.ts` carries the mechanism). Every write family hands `settleWith` to
 * the ONE `useRefetchGate` the reads register, and AN EVENT IS A DOORBELL,
 * NEVER CONTENT: the signal triggers a filtered refetch, no payload is merged,
 * so RLS and the service filters stay authoritative.
 *   ⚠ THE COORDINATOR IS MOUNTED ABOVE THE CHANNEL BRANCH and always has been:
 *   the empty-workspace explainer renders with no channel open, and the channel
 *   list has to keep hearing the doorbell through it.
 *   That is why `useChannelSurfaceData` is called HERE rather than inside the
 *   surface it feeds.
 *   ⚠ THE INBOX TAKEOVER WAS THE SECOND SUCH STATE AND IS DELETED (2026-08-25);
 *   the mount point does NOT move back down for that — the explainer branch
 *   still needs it, and so would the next no-channel state.
 */
export function ChannelsCore({
  workspaceId,
  workspaceSlug,
  currentUserId,
  role,
  Link,
  initialChannelId = null,
  initialThreadId = null,
  onNavigatePath,
}: ChannelsCoreProps) {
  // WHAT THIS PAGE HAS OPEN — `use-channels-selection.ts`, including the
  // render-time re-application of a routed `initialChannelId` (a second
  // notification changes the route but not the component).
  const sel = useChannelsSelection({ initialChannelId, initialThreadId });
  // ⚠ THE SEQ A SEARCH ROW NAMED, **KEYED TO THE CHANNEL IT NAMED IT IN**. A bare
  // number re-fired into whatever the reader opened next, because
  // `use-message-jump.ts` keys on `channelId:threadId:seq` and a new channel is a
  // new key. /home has always keyed it (`use-activity-jump.ts › seqFor(rowId)`).
  const [searchSeq, setSearchSeq] = useState<{ channelId: string; seq: number } | null>(null);
  const queryClient = useQueryClient();

  const { channels, loading, refetch: refetchChannels } = useChannels(workspaceId);

  /**
   * OPENING WHAT A SEARCH-POPUP ROW NAMES (2026-09-17).
   *
   * ⚠ **THE THREE CONVERSATION KINDS ARE ANSWERED WITH THE SELECTION THIS PAGE
   * ALREADY OWNS** — `sel.selectChannel` / `sel.openThread` — so a search hit and
   * a sidebar click land through one mechanism. Everything else is another PAGE
   * and goes out through the host's `onNavigatePath`.
   *
   * 🔒 **`item.seq` IS HONOURED SINCE 2026-09-17 (F-714 RESOLVED).** A message
   * row hands the surface an `initialSeq` and the transcript jumps to it
   * (`channel-surface.tsx › initialSeq`, `use-message-jump.ts`) — the SAME
   * nonced signal a citation pill and a Tags mention use, including its "older
   * than the loaded history" notice when the seq is outside the loaded page.
   * ⚠ **AND ONLY FOR `kind === "messages"`.** A channel row and a thread row name
   * no message; carrying a stale seq into them would scroll a reader somewhere
   * they did not ask to be, so the seq is CLEARED on every other kind rather
   * than left standing.
   */
  const openSearchHit = (item: SearchItem) => {
    if (item.kind === "knowledge") return onNavigatePath?.(`/${workspaceSlug}/knowledge`);
    if (item.kind === "agentTemplates") return onNavigatePath?.(`/${workspaceSlug}/agents`);
    if (item.kind === "members") return onNavigatePath?.(`/${workspaceSlug}/members`);
    if (item.kind === "skills") return onNavigatePath?.(`/${workspaceSlug}/skills`);
    if (item.kind === "chats") return onNavigatePath?.(`/${workspaceSlug}/chats`);
    if (item.channelId) sel.selectChannel(item.channelId);
    if (item.threadId) sel.openThread(item.threadId);
    setSearchSeq(
      item.kind === "messages" && item.channelId && item.seq != null
        ? { channelId: item.channelId, seq: item.seq }
        : null
    );
  };

  // A manual pick is the reader asking for a channel, not for a seq inside it.
  const selectChannel = (id: string) => {
    setSearchSeq(null);
    sel.selectChannel(id);
  };

  // Explicit pick that still exists wins, else the first row — the same rule the
  // deleted `channels-view-core.tsx` used, so a deleted channel cannot strand the pane.
  const effectiveId = useMemo(() => {
    const picked = sel.selectedId;
    if (picked && channels.some((c) => c.id === picked)) return picked;
    return channels[0]?.id ?? null;
  }, [sel.selectedId, channels]);
  const channel = channels.find((c) => c.id === effectiveId) ?? null;

  // The open channel's reads, its derivations, its writes and THE refetch
  // coordinator — `channel-surface-data.ts`. The channel LIST is the one read
  // this page owns that the surface does not, so it rides the same doorbell
  // through `onDoorbell` rather than standing up a second coordinator
  // (INVARIANTS §7/§8: one `useRefetchGate` per live surface).
  //
  // ⚠ INVALIDATE THE PREFIX, don't refetch ONE observer. `query.refetch()`
  // revalidates only the mounted key-variant, so any other variant of the
  // channels list stays stale behind a doorbell that fired for it.
  // `client/query-keys.ts` designs the WRITE path around prefix invalidation for
  // exactly this reason. ⚠ **The list's one other variant, `?include=archived`,
  // went with the archive feature on 2026-09-17 (R-21)** — so this is kept for the
  // NEXT variant, not for a live case, and it stays because the rule is cheaper
  // than rediscovering it.
  const data = useChannelSurfaceData({
    workspaceId,
    // The Info tab's activity strip is channel-scoped and the route is
    // segment-addressed — see `channel-surface-data.ts`'s series read.
    workspaceSlug,
    channel,
    currentUserId,
    openThreadId: sel.requestedThreadId,
    onDoorbell: () => {
      void queryClient.invalidateQueries({ queryKey: channelKeys.list().all });
    },
  });

  // A create lands the operator ON the new channel — the same rule the retired
  // page used, so a fresh room is never created into an unchanged view.
  const onCreated = (created: Channel) => {
    sel.selectChannel(created.id);
    void refetchChannels();
  };

  if (loading && channels.length === 0) return <ChannelsSkeleton />;

  const { direct, rooms } = splitChannels(channels);
  const canCreate = meetsMinRole(role, "member");

  return (
    // `relative` is the agent view's containing block: it is absolutely
    // positioned against this surface, and `.page-float`'s `overflow: hidden`
    // clips it to the page card's radius on the way in and out.
    //
    // `data-frame-skin` — THE ACCOUNT PALETTE, ON THIS PAGE TOO SINCE R-38
    // (Samuel, 2026-09-17: *"the workspace pages adopt /home's frame model and
    // palette — the two surfaces must match"*). The kit owns the rules
    // (`src/app/globals.css` › THE ACCOUNT PALETTE SKIN); this page and /home's
    // record pane wear them. ⚠ The guest web lane (`src/app/c/[workspaceId]/
    // guest-channel.tsx`) deliberately does NOT — it keeps the kit hairlines.
    <div className="page-float relative flex antialiased" data-frame-skin>
      <ChannelsSidebar
        workspaceId={workspaceId}
        rooms={rooms}
        direct={direct}
        threads={data.treeThreads}
        members={data.members}
        currentUserId={currentUserId}
        selectedChannelId={channel?.id ?? null}
        openThreadId={data.openThread?.id ?? null}
        onSelectChannel={selectChannel}
        onOpenThread={sel.openThread}
        canCreate={canCreate}
        onCreateChannel={() => sel.setCreateOpen(true)}
        onCreateDirect={() => sel.setDirectOpen(true)}
        onSearchNavigate={openSearchHit}
      />

      {channel ? (
        // ⚠ A FRAGMENT of the same two panes this file used to render inline, so
        // the DOM this page emits did not move when the surface was extracted.
        <ChannelSurface
          workspaceId={workspaceId}
          workspaceSlug={workspaceSlug}
          channel={channel}
          currentUserId={currentUserId}
          role={role}
          data={data}
          selection={sel}
          initialSeq={searchSeq?.channelId === channel?.id ? searchSeq.seq : null}
          onRosterChanged={refetchChannels}
          // 🔒 `artifacts: true` — THE ARTIFACTS FACE COMES TO THIS PAGE (Samuel's
          // ruling R-16, 2026-09-17, after F-712): the inline artifact card already
          // renders in this transcript, so a reader here could SEE an artifact and
          // not browse the channel's. The capability's own docblock carries the
          // rest (`channel-surface-contract.ts`).
          capabilities={{ artifacts: true }}
        />
      ) : (
        // THE FIRST-RUN EXPLAINER, rehomed here at the cutover. It says what
        // channels are for and what responding needs; Samuel's third-round
        // ruling was KEEP for now, redesign later, and the page that used to
        // render it is deleted.
        <ChannelsOnboardingCore
          workspaceSlug={workspaceSlug}
          canCreate={canCreate}
          onCreate={() => sel.setCreateOpen(true)}
          Link={Link}
        />
      )}

      {/* ⚠ One object where nine forwarded props stood (wave 1A, 2026-09-17):
          the agent pane is `surface-agent-view.tsx` now, so everything it needs
          — the agent COLOUR included — reaches it off this surface's own read.
          `overlays.tsx` carries the drift that bought the collapse. */}
      <ChannelsOverlays
        data={data}
        openAgent={sel.openAgent}
        currentUserId={currentUserId}
        workspaceId={workspaceId}
        workspaceSlug={workspaceSlug}
        createOpen={sel.createOpen}
        directOpen={sel.directOpen}
        onCloseAgent={() => sel.setOpenAgent(null)}
        onCreateOpenChange={sel.setCreateOpen}
        onDirectOpenChange={sel.setDirectOpen}
        onCreated={onCreated}
      />
    </div>
  );
}
