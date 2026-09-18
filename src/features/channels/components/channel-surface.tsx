"use client";

/**
 * ONE CHANNEL, WHOLE — everything right of the channel tree: the breadcrumb
 * header, the transcript, the composer, and the Info / Threads / Agents /
 * Settings column beside them.
 *
 * ⚠ EXTRACTED FROM `channels-core.tsx` ON 2026-08-23 SO A SECOND HOST CAN
 * MOUNT IT: the workspace page, and `channel-surface-standalone.tsx` for a
 * surface pinned to ONE channel with no tree beside it. **It is a FRAGMENT, not a
 * wrapper** — two flex siblings — so composing it changed no DOM.
 *
 * ⚠ IT RENDERS, IT DOES NOT FETCH. Every read, the refetch coordinator and the
 * writes are `channel-surface-data.ts`, mounted by the HOST: the coordinator must
 * stay registered while the page shows something other than a channel (INVARIANTS
 * §7), and a hook here would unmount with the branch.
 *
 * ⚠ TWO KNOBS, AND BOTH DEFAULT TO THE WORKSPACE PAGE'S BEHAVIOUR — see
 * {@link ChannelSurfaceSlots} and {@link ChannelSurfaceCapabilities}. A host that
 * passes neither gets the surface the channels page has always rendered.
 */

import type { ReactNode } from "react";
import type { Role } from "@/features/workspaces/types";
import { channelDisplayName } from "../lib/channel-display";
import { useMessageJump } from "./use-message-jump";
import { ChannelsMessagePane } from "./message-pane";
import { PopOutThreadButton } from "./pop-out";
import { AgentActivityRows, ownAgentsWorking } from "./agent-activity";
import { ChannelSingleColumn } from "./channel-single-column";
import { SurfaceAgentView } from "./surface-agent-view";
import { SurfaceInfoPanel } from "./surface-info-panel";
import { InfoResizeHandle } from "./info-resize-handle";
import { useInfoSlide } from "./use-info-slide";
import type { TabKey } from "./info-panel";
import type { ChannelWebView } from "./use-channel-web-view";
import { PeerActivityRow, peerWorkingOn } from "./peer-activity";
import type { ChannelSurfaceData } from "./channel-surface-data";
import type { ChannelsSelection } from "./use-channels-selection";
import type { Channel } from "../types";
import type {
  ChannelSurfaceCapabilities,
  ChannelSurfaceSlots,
} from "./channel-surface-contract";

/**
 * The host contract moved to `channel-surface-contract.ts` at §1's cap (wave
 * 1A, 2026-09-17) and is re-exported here so no caller moved. That file carries
 * every rule; this one composes panes.
 */
export type {
  ChannelInfoTabContext,
  ChannelInfoExtras,
  ChannelSurfaceSlots,
  ChannelSurfaceCapabilities,
  MentionsLayout,
} from "./channel-surface-contract";

export interface ChannelSurfaceProps {
  workspaceId: string;
  /** The workspace SEGMENT — the pop-out's route and the agent window's. */
  workspaceSlug: string;
  /** The RESOLVED row, not an id: the host owns which channel this is, and
   *  asking for both is how the two come to disagree. */
  channel: Channel;
  currentUserId: string;
  role: Role;
  data: ChannelSurfaceData;
  selection: ChannelsSelection;
  /** A host read the roster can invalidate — the workspace page's channel list.
   *  This surface always refetches its OWN roster beside it. */
  onRosterChanged?: () => void;
  /** The channel was DELETED from the Settings tab. A host that pins the surface
   *  to one channel has to stop rendering it, and this is its only notice. */
  onDeselect?: () => void;
  /**
   * 🔒 **A MESSAGE TO LAND ON, BY `channel_messages.seq` (F-714, 2026-09-17).**
   * A search hit on a message carries one (`search/contracts.ts › SearchItem`)
   * and Samuel's ruling is *"open channel at that seq so the transcript jumps"*.
   * ⚠ **INITIAL, NOT CONTROLLED, AND IT SITS BESIDE `initialThreadId` ON THE
   * HOSTS RATHER THAN HERE** — the surface takes the number and
   * `use-message-jump.ts` fires the existing nonced signal once the transcript
   * has rows. A seq outside the loaded page reaches the pane's "older than the
   * loaded history" notice by the same path a citation pill's miss does; there
   * is no second mechanism and there must not be.
   * ⚠ **ONLY A `kind === "messages"` ROW HAS ONE.** A channel or thread hit
   * names no message, and a host that passed a stale seq with a channel change
   * would scroll a reader somewhere they did not ask to be.
   */
  initialSeq?: number | null;
  slots?: ChannelSurfaceSlots;
  capabilities?: ChannelSurfaceCapabilities;
  /**
   * SINGLE COLUMN, AND WHICH FACE IS ON IT — the **WEB** channel page (Samuel,
   * 2026-09-04): one full-width main area with the faces behind a header dropdown
   * (`channel-single-column.tsx`; `use-channel-web-view.ts` says why the HOST owns
   * the state — it is in the URL and this file is router-free by construction).
   * ⚠ ABSENT IS EVERY DESKTOP MOUNT, byte for byte.
   */
  webView?: ChannelWebView;
}

export function ChannelSurface({
  workspaceId,
  workspaceSlug,
  channel,
  currentUserId,
  role,
  data,
  selection: sel,
  onRosterChanged,
  onDeselect,
  initialSeq = null,
  slots,
  capabilities,
  webView,
}: ChannelSurfaceProps) {
  const {
    members,
    agentSessions,
    agentsPanel,
    liveAgents,
    index,
    openThread,
    rows,
    recentAgentIds,
    gate,
  } = data;
  // 🔒 THE HEADER NAME, AND `peerNamedHeader: false` IS THE /home ANSWER — see
  // the capability's own docblock for the ruling.
  const channelName =
    capabilities?.peerNamedHeader === false
      ? channel.name
      : channelDisplayName(channel, members, currentUserId);
  // ⚠ THE PANEL OUTLIVES `infoOpen` BY ONE TRANSITION, so the closing slide has
  // something to clip — `use-info-slide.ts` owns the timer and the reasons.
  const infoMounted = useInfoSlide(sel.infoOpen);

  // ⚠ THE DESIRED STATE IS COMPUTED HERE, from the row the header is rendering —
  // never a flip inside the mutation: two fast clicks send `true` then `false` and
  // converge, where a toggle verb would race. Named because BOTH layouts fire it.
  const toggleFavorite = () =>
    data.favorite.mutate({
      channelId: channel.id,
      favorite: channel.myFavoritedAt == null,
    });
  /**
   * 🔒 **THE CITATION PILL'S JUMP, AND THE SEARCH HIT'S — ONE MECHANISM.**
   * `use-message-jump.ts` holds the resolver, the miss path and the initial-seq
   * wait, with the whole argument for each. It is a hook rather than three lines
   * here because {@link initialSeq} needs an effect, and §1's cap on this file
   * is the reason it is not FOUR lines here.
   */
  const jumpToSeq = useMessageJump({
    rows,
    openThreadId: openThread?.id ?? null,
    initialSeq,
    channelId: channel.id,
    jumpToMessage: sel.jumpToMessage,
  });
  const messagePane = (viewSelect?: ReactNode) => (
    <ChannelsMessagePane
      channelId={channel.id}
      workspaceId={workspaceId}
      channelName={channelName}
      thread={openThread}
      rows={rows}
      // RR3 arm 3's input for the composer's recipient line — derived once in
      // `derivations.ts` from the transcript this page has already read.
      recentAgentIds={recentAgentIds}
      index={index}
      members={members}
      loading={data.messagesLoading}
      // ⚠ RULE 1'S OTHER HALF (`use-stick-to-bottom.ts`): through a channel switch these rows
      // are still the PREVIOUS channel's, and `messagesLoading` is false the whole time.
      stale={data.messagesStale}
      outboundAsk={openThread ? (data.outboundByThread.get(openThread.id) ?? null) : null}
      outboundBusy={data.consentBusy}
      onDecideOutbound={data.decideOutbound}
      scrollTarget={sel.scrollTarget}
      // 🔒 THE CITATION PILL'S JUMP — resolved above, into the SAME nonced scroll
      // signal the Tags inbox already uses, so a `#1759` in a body and a mention
      // click move the transcript by one mechanism rather than two.
      onJumpToSeq={jumpToSeq}
      // The Threads tab's "New thread", arriving from the OTHER column
      // (2026-08-24) through the selection hook, where cross-surface asks live —
      // so both hosts of this surface get it without a second wiring.
      newThreadSignal={sel.newThreadSignal}
      infoOpen={sel.infoOpen}
      favorited={channel.myFavoritedAt != null}
      onToggleFavorite={toggleFavorite}
      gate={gate}
      // THE @-PICKER'S AND THE RECIPIENT LINE'S FACTS (2026-09-02, slice B10): every member's
      // live sessions in this room, off the poll the Agents tab already makes. Handed down —
      // a second mount of that hook is a second poll of an unpublished table.
      // ⚠ **AND IT IS THE POLL *UNION* THIS MACHINE'S OWN FEED SINCE 2026-09-13**
      // (`channel-surface-data.ts › liveAgents`, over `lib/live-agents.ts ›
      // liveAgentsKey`). The projection ALONE is what made a just-launched agent
      // un-taggable for a full 30s poll period — Samuel's *"I have to wait a minute"*.
      // Never narrow this back to `agentsPanel.peerSessions`.
      liveAgents={liveAgents}
      // The composer's New Agent icon (2026-08-21) — handed down whole,
      // never re-mounted: a second `useAgentsPanel` is a second peer poll.
      newAgent={agentsPanel}
      // THE POP-OUT (Phase 10). Thread view only, and it hides ITSELF outside
      // the desktop shell (feature detection).
      popOut={
        openThread ? (
          <PopOutThreadButton
            workspaceSlug={workspaceSlug}
            channelId={channel.id}
            threadId={openThread.id}
          />
        ) : null
      }
      // ⚠ MY OWN agents mid-turn, off the SAME bridge feed this surface already
      // reads. Rendered in CHANNEL view too, and scoped so it tracks the
      // composer's own target. `null` sessions render nothing.
      agentActivity={
        <AgentActivityRows
          agents={ownAgentsWorking(
            agentSessions,
            channel.id,
            openThread?.id ?? null
          )}
        />
      }
      // "Anthony's agent is working…", off the peer projection the Agents tab
      // already polls. Thread view only — the row is about ONE exchange.
      peerActivity={
        openThread ? (
          <PeerActivityRow
            peers={peerWorkingOn(
              agentsPanel.peerSessions,
              currentUserId,
              openThread.id
            )}
            byUser={index.byId}
            currentUserId={currentUserId}
          />
        ) : null
      }
      // SCROLL-UP PAGING — the pane owns the trigger and the anchor, the hook
      // owns the cursor.
      hasOlder={data.hasOlderMessages}
      loadingOlder={data.loadingOlderMessages}
      onLoadOlder={data.loadOlderMessages}
      viewSelect={viewSelect}
      onToggleInfo={sel.toggleInfo}
      onExitThread={() => sel.openThread(null)}
      // AN AGENT'S SENDER PILL OPENS THAT AGENT'S PANE (Samuel, 2026-08-28) — AND
      // CLOSES IT AGAIN ON A SECOND PRESS (Samuel, 2026-09-16: *"if they click the
      // badge of an agent already opened up in view, it goes back to the channel
      // info view, basically resets"*).
      // ⚠ THE TOGGLE IS THE PILL'S ALONE, which is why this is `toggleAgent` and the
      // tab column below still hands `setOpenAgent`: an Agents-tab card renders
      // "Viewing" for the open agent and pressing it must stay a no-op, where a pill
      // is the one control whose second press has nothing else to mean.
      // ⚠ ONE SELECTION HOOK, SO BOTH SURFACES GET IT — the workspace channels page
      // (`channels-core.tsx`) and /home's pane (`channel-surface-standalone.tsx`)
      // mount this same component.
      onOpenAgent={sel.toggleAgent}
      // ANSWER AN ESCALATION — the transcript's one WRITE. The pop-out hands
      // none, so a card there is read-only.
      onAnswerEscalation={data.answerEscalation}
      answerBusy={data.answerBusy}
      onOpenThread={sel.openThread}
    />
  );

  /** The tab column, or — with `fullTab` — ONE of its faces as the main area.
   *  ⚠ `surface-info-panel.tsx` owns the wiring; this file owns which pane. */
  const infoPanel = (fullTab?: TabKey) => (
    <SurfaceInfoPanel
      channel={channel}
      channelName={channelName}
      workspaceId={workspaceId}
      workspaceSlug={workspaceSlug}
      currentUserId={currentUserId}
      role={role}
      data={data}
      selection={sel}
      slots={slots}
      capabilities={capabilities}
      onDeselect={onDeselect}
      onRosterChanged={onRosterChanged}
      webView={webView}
      fullTab={fullTab}
    />
  );

  // ⚠ ONE COLUMN ON THE WEB, TWO ON THE DESKTOP — see the `webView` prop. The
  // slide-out shell is not merely closed here, it is NOT RENDERED: a column
  // reserving width is what kept the chat off the page edge.
  if (webView) {
    return (
      <ChannelSingleColumn
        channelName={channelName}
        threadTitle={openThread?.title ?? null}
        threadView={openThread !== null}
        favorited={channel.myFavoritedAt != null}
        onToggleFavorite={toggleFavorite}
        view={webView.view}
        onSelectView={webView.setView}
        openAgent={sel.openAgent}
        sessions={agentSessions}
        onCloseAgent={() => sel.setOpenAgent(null)}
        onExitThread={() => sel.openThread(null)}
        messagePane={messagePane}
        tabBody={webView.view === "channel" ? null : infoPanel(webView.view)}
        agentView={
          <SurfaceAgentView
            data={data}
            openAgent={sel.openAgent}
            onClose={() => sel.setOpenAgent(null)}
            currentUserId={currentUserId}
            workspaceSlug={workspaceSlug}
            full
          />
        }
      />
    );
  }

  return (
    <>
      {messagePane()}
      {/* THE DIVIDER IS DRAGGABLE (Samuel, 2026-09-13) — `info-resize-handle.tsx`
          owns the pill and `use-info-resize.ts` the width, its two limits and the
          per-device memory. ⚠ IT IS A ZERO-WIDTH FLEX SIBLING, so this row's box
          math did not move; and it is GONE while the column is collapsed, because a
          grab handle for a pane that is not there can only resize nothing. */}
      {sel.infoOpen && <InfoResizeHandle />}
      {/* THE INFO COLUMN SLIDES (Samuel, 2026-08-24). The shell is ALWAYS
          rendered — a column mounting at its open width has no 0-width start
          state — and the panel inside stays one transition past close so the
          closing slide has content to clip. */}
      <div
        className="channel-info-slide"
        data-open={sel.infoOpen}
        aria-hidden={!sel.infoOpen}
      >
        {infoMounted && infoPanel()}
      </div>
    </>
  );
}
