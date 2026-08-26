"use client";

import { useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { LinkLike } from "@/shared/ui/link-like";
import { meetsMinRole, type Role } from "@/features/workspaces/types";
import { useChannels } from "../../hooks/use-channels";
import { channelKeys } from "../../client/query-keys";
import { ChannelsSkeleton } from "../channels-skeleton";
import { ChannelsOnboardingCore } from "../channels-onboarding-core";
import { ChannelsV2Overlays } from "./overlays";
import { ChannelsV2Sidebar } from "./sidebar";
import { ChannelSurface } from "./channel-surface";
import { useChannelSurfaceData } from "./channel-surface-data";
import type { Channel } from "../../types";
// Kept on one line each: this file has repeatedly sat within a handful of lines
// of the 500-line cap, and CROSSED it on 2026-08-20 (re-measure, do not quote).
import { splitChannels } from "./view-model";
import { useChannelsV2Selection } from "./use-channels-v2-selection";

export interface ChannelsV2CoreProps {
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
}

/**
 * Channels v2 root — the three-column shell (channel tree · transcript ·
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
export function ChannelsV2Core({
  workspaceId,
  workspaceSlug,
  currentUserId,
  role,
  Link,
  initialChannelId = null,
  initialThreadId = null,
}: ChannelsV2CoreProps) {
  // WHAT THIS PAGE HAS OPEN — `use-channels-v2-selection.ts`, including the
  // render-time re-application of a routed `initialChannelId` (a second
  // notification changes the route but not the component).
  const sel = useChannelsV2Selection({ initialChannelId, initialThreadId });
  const queryClient = useQueryClient();

  const { channels, loading, refetch: refetchChannels } = useChannels(
    workspaceId,
    false
  );

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
  // channels list (`include=archived` is the one that exists) stays stale
  // behind a doorbell that fired for it. `client/query-keys.ts` designs the
  // WRITE path around prefix invalidation for exactly this reason.
  const data = useChannelSurfaceData({
    workspaceId,
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
    <div className="page-float relative flex antialiased">
      <ChannelsV2Sidebar
        rooms={rooms}
        direct={direct}
        threads={data.treeThreads}
        members={data.members}
        currentUserId={currentUserId}
        selectedChannelId={channel?.id ?? null}
        openThreadId={data.openThread?.id ?? null}
        onSelectChannel={sel.selectChannel}
        onOpenThread={sel.openThread}
        canCreate={canCreate}
        onCreateChannel={() => sel.setCreateOpen(true)}
        onCreateDirect={() => sel.setDirectOpen(true)}
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
          onRosterChanged={refetchChannels}
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

      <ChannelsV2Overlays
        openAgent={sel.openAgent}
        agentSessions={data.agentSessions}
        messages={data.messages}
        // ⚠ THE OUTBOUND REVIEW IS THE CARD NOW (Samuel, 2026-08-25) — the Inbox
        // pane this page used to take over the center column with is DELETED, so
        // these rows have exactly one surface and it is inside the work stream.
        pendingPosts={data.requests}
        onPostPending={(id) => data.decideOutbound(id, "allow")}
        postBusy={data.consentBusy}
        currentUserId={currentUserId}
        workspaceId={workspaceId}
        workspaceSlug={workspaceSlug}
        createOpen={sel.createOpen}
        directOpen={sel.directOpen}
        onCloseAgent={() => sel.setOpenAgent(null)}
        onRefreshSessions={data.refreshAgents}
        onCreateOpenChange={sel.setCreateOpen}
        onDirectOpenChange={sel.setDirectOpen}
        onCreated={onCreated}
      />
    </div>
  );
}
