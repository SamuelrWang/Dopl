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
import type { MutationGate } from "@/shared/hooks/use-api-mutation";
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
import type { MentionsBundle } from "./mentions-disclosure";
import type { ChannelHeaderEdit } from "./info-inline-edit";
import type { Channel } from "../types";

/**
 * What this surface hands an injected Info tab.
 *
 * ⚠ IT CARRIES THE GATE AND THAT IS WHY THE SLOT IS A FUNCTION (2026-08-25). The
 * person card is WRITE-BEARING, and INVARIANTS §7/§8 allow exactly ONE
 * `useRefetchGate` per live surface — a slot handed a finished `ReactNode` could
 * only mint a second one, which coordinates with nothing.
 */
export interface ChannelInfoTabContext {
  /** THE surface's refetch gate — hand it to every write the tab makes. */
  gate: MutationGate;
  /**
   * THIS SURFACE'S TAGS INBOX, ALREADY READ (2026-09-15).
   *
   * ⚠ **IT IS HANDED DOWN BECAUSE THE SLOT REPLACES THE BODY, AND THAT IS WHAT
   * LOST IT.** `surface-info-panel.tsx` fetches the mentions for EVERY mount,
   * home space included, and passes them to the default Info tab — so a surface
   * that injected its own tab paid for the read and then dropped the section on
   * the floor. The home space's Info tab had no Tags row for that reason alone,
   * not because the data was unavailable or wrongly scoped.
   *
   * ⚠ **THE HANDLERS CANNOT BE MINTED BY A TAB.** `onOpen` marks read, lands the
   * CENTRE PANE on the right transcript and then fires the nonced scroll signal;
   * only the surface holds the selection state that last step needs. A tab that
   * built its own would mark read and scroll nothing.
   *
   * ⚠ **THE QUERY IS SCOPED BY THE SURFACE'S `workspaceId`,** which for a home
   * channel IS the home CONTAINER id (`pages/home/relationship-record.tsx` passes
   * `homeChannel.workspaceId`). So the tenancy is the container's by
   * construction, and no caller may narrow or widen it here.
   */
  mentions: MentionsBundle;
  /**
   * THIS SURFACE'S HEADER WRITE AND ITS PERMISSION, ALREADY RESOLVED (Samuel,
   * 2026-09-17) — the click-to-edit Name and Description rows.
   *
   * ⚠ **IT RIDES WITH THE GATE FOR THE REASON `mentions` DOES.** Minted ONCE by
   * `surface-info-panel.tsx`, from this surface's single `useRefetchGate`
   * (§7/§8) and its mirror of `service-shared.ts › canManageChannel`, so ONE
   * object reaches the default Info tab and an injected one. Before this, a host
   * that replaced the body paid for the hook and dropped the edit — which is how
   * /home had a display-only card while the workspace page's edited in place.
   * ⚠ **A TAB MAY NOT MINT ITS OWN**: a second gate coordinates with nothing, and
   * the realtime doorbell repaints the old name mid-write.
   * ⚠ **THE DERIVED-NAME HALF IS STILL THE TAB'S** (`info-tab.tsx ›
   * headerEditable`) — a fact about the ROW, not about the reader.
   */
  headerEdit: ChannelHeaderEdit;
}

export interface ChannelSurfaceSlots {
  /**
   * REPLACES the Info tab's body in CHANNEL view — an account-level 1:1 shows a
   * person card where a workspace channel shows its metadata and roster.
   * ⚠ A RENDER FUNCTION, not a node — see {@link ChannelInfoTabContext}.
   *
   * ⚠ THE TAB ROW IS NOT A SLOT and never becomes one: a host that could delete a
   * tab could ship a surface missing one with nothing saying so. ⚠ THREAD VIEW
   * IGNORES IT — the column is already thread-scoped (Samuel, 2026-08-21;
   * `info-panel.tsx` owns the rule).
   */
  infoTab?: (ctx: ChannelInfoTabContext) => ReactNode;
}

export interface ChannelSurfaceCapabilities {
  /**
   * Whether this container's membership can be CHANGED. Default `true` — the
   * workspace page's behaviour. `false` hides the invite affordance and the
   * Settings tab's delete row, for a fixed two-person container where "add
   * members" cannot happen and deleting the one channel would strand it.
   */
  memberManagement?: boolean;
  /**
   * Whether this surface's HEADER may name the channel after its counterpart.
   * Default `true` — `channel-display.ts › channelDisplayName`.
   *
   * 🔒 **`false` PINS THE HEADER TO `channel.name`, AND /home PASSES IT (Samuel,
   * 2026-09-01).** A home container is a CHANNEL, not a DM. Its row and Info tab
   * were fixed at their own derivation (`pages/home/home-rows.ts › channelTitle`),
   * but this header reads a DIFFERENT one — so a container carrying
   * `is_direct = true` (every one minted before the 2026-08-24 channel-first
   * inversion) still showed the peer's name over a row that said the channel's.
   *
   * ⚠ **REAL DMs ARE UNAFFECTED, WHICH IS WHY THIS IS A FLAG AND NOT AN EDIT TO
   * `channel-display.ts`** — that module is the ONE counterpart derivation for the
   * workspace surfaces. What changed is which surfaces ASK it.
   */
  peerNamedHeader?: boolean;
  /**
   * Whether the VIEWER'S OWN STAKE — their membership row and the agent they run
   * here — is theirs to manage HERE. Default `true`; `false` hides "Leave channel"
   * AND the whole `ChannelAgentSettings` block.
   *
   * ⚠ ONE FLAG, TWO CONTROLS, BECAUSE THERE IS ONE STORY (Samuel, ruling R2/R3,
   * 2026-08-25): the GUEST LANE (`src/app/c/[workspaceId]`) runs no agent, so a
   * tool profile governs a session that does not exist, and leaving is a one-way
   * exit from their only surface. Two flags would let a host ship the other half's
   * dead control. ⚠ IT IS ABOUT THE VIEWER, WHERE `memberManagement` IS ABOUT THE
   * CONTAINER: /home passes `memberManagement: false` and leaves this one alone.
   */
  selfManagement?: boolean;
  /**
   * ⚠ **`knowledge` IS DELETED (Samuel's ruling R-18, 2026-09-17).** It drew a
   * fifth tab over bases granted into the channel. No host had passed it since
   * 2026-09-04 (the guest lane was the last, F-666), so the tab, its hook, its
   * client lane, its four API routes and this flag were unreachable product —
   * deleted, not parked (INVARIANTS §15). /home's Knowledge SHELF
   * (`pages/home/knowledge-panels.tsx`) is untouched and is the surface that
   * reads a granted base today. ⚠ Re-adding the FACE still needs Samuel's word.
   *
   * Draw the ARTIFACTS FACE toggle in the Threads tab — this channel's folded runs
   * as openable cards (Samuel, 2026-09-16; `artifacts-tab.tsx`).
   *
   * ⚠ DEFAULT `false`, WHICH INVERTS THE OTHER TWO: they REMOVE something, this
   * ADDS a control.
   *
   * ⚠ **EXACTLY ONE HOST PASSES IT — /home**, under Samuel's standing home-space
   * ruling for a new surface (2026-09-16). The workspace channel page and the guest
   * lane are LEFT ALONE rather than forgotten: this is not a tab (the row's width
   * budget is measured for four) and the reads mount with the face, so a host that
   * passes nothing fetches nothing and renders the Threads tab byte for byte.
   *
   * ⚠ SAFE ON ANY HOST REGARDLESS — the face reads the channel's own artifact route
   * at the same visibility gate the transcript already passed.
   */
  artifacts?: boolean;
}

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
