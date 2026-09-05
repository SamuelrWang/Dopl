"use client";

/**
 * ONE CHANNEL, WHOLE — everything right of the channel tree: the breadcrumb
 * header, the transcript, the composer, and the Info / Threads / Agents /
 * Settings column beside them.
 *
 * ⚠ EXTRACTED FROM `channels-v2-core.tsx` ON 2026-08-23 SO A SECOND HOST CAN
 * MOUNT IT. The workspace page is one host (the tree, the Inbox takeover and the
 * first-run explainer stay there); `channel-surface-standalone.tsx` is the other,
 * for a surface pinned to ONE channel with no tree beside it. **It is a
 * FRAGMENT, not a wrapper** — two flex siblings, exactly the two the core used to
 * render inline — so composing it changed no DOM on the workspace page.
 *
 * ⚠ IT RENDERS, IT DOES NOT FETCH. Every read, the refetch coordinator and the
 * writes are `channel-surface-data.ts`, mounted by the HOST: the coordinator has
 * to stay registered while the workspace page is showing something other than a
 * channel (INVARIANTS §7), and a hook inside this file would unmount with the
 * branch.
 *
 * ⚠ TWO KNOBS, AND BOTH DEFAULT TO THE WORKSPACE PAGE'S BEHAVIOUR — see
 * {@link ChannelSurfaceSlots} and {@link ChannelSurfaceCapabilities}. A host that
 * passes neither gets the surface the channels page has always rendered.
 */

import type { ReactNode } from "react";
import type { MutationGate } from "@/shared/hooks/use-api-mutation";
import type { Role } from "@/features/workspaces/types";
import { channelDisplayName } from "../../lib/channel-display";
import { ChannelsV2MessagePane } from "./message-pane";
import { PopOutThreadButton } from "./pop-out";
import { AgentActivityRows, ownAgentsWorking } from "./agent-activity";
import { ChannelSingleColumn } from "./channel-single-column";
import { SurfaceAgentView } from "./surface-agent-view";
import { SurfaceInfoPanel } from "./surface-info-panel";
import { useInfoSlide } from "./use-info-slide";
import type { TabKey } from "./info-panel";
import type { ChannelWebView } from "./use-channel-web-view";
import { PeerActivityRow, peerWorkingOn } from "./peer-activity";
import type { ChannelSurfaceData } from "./channel-surface-data";
import type { ChannelsV2Selection } from "./use-channels-v2-selection";
import type { Channel } from "../../types";

/**
 * What this surface hands an injected Info tab.
 *
 * ⚠ IT CARRIES THE GATE AND THAT IS WHY THE SLOT IS A FUNCTION (2026-08-25).
 * The person card became WRITE-BEARING when the Main-info rows became
 * removable, and INVARIANTS §7/§8 allow exactly ONE `useRefetchGate` per live
 * surface — this one's. A slot handed a finished `ReactNode` could only mint a
 * second gate, which coordinates with nothing: the doorbell's refetch would
 * land mid-write and repaint the row the operator just deleted. Same reason
 * `settings-slot.tsx` is passed `gate={gate}` twenty lines below.
 */
export interface ChannelInfoTabContext {
  /** THE surface's refetch gate — hand it to every write the tab makes. */
  gate: MutationGate;
}

export interface ChannelSurfaceSlots {
  /**
   * REPLACES the Info tab's body in CHANNEL view — an account-level 1:1 shows a
   * person card where a workspace channel shows its metadata and roster.
   *
   * ⚠ A RENDER FUNCTION, not a node — see {@link ChannelInfoTabContext}. It is
   * called during this surface's render, like `Crossfade`'s own children.
   *
   * ⚠ THE TAB ROW IS NOT A SLOT and never becomes one: Info / Threads N /
   * Agents N / Settings is the column's design, and a host that could delete a
   * tab could ship a surface missing one with nothing saying so.
   *
   * ⚠ THREAD VIEW IGNORES IT, deliberately. With a thread open this column is
   * already thread-scoped (Samuel, 2026-08-21 — `info-panel.tsx` owns the rule),
   * so Info renders the THREAD's facts; a person card there would answer a
   * question the reader did not ask.
   */
  infoTab?: (ctx: ChannelInfoTabContext) => ReactNode;
}

export interface ChannelSurfaceCapabilities {
  /**
   * Whether this container's membership can be CHANGED. Default `true` — the
   * workspace page's behaviour. `false` hides the invite affordance and its
   * dialog, AND the Settings tab's delete row, for a fixed two-person container
   * where "add members" names an operation that cannot happen and deleting the
   * one channel would strand the container it lives in.
   */
  memberManagement?: boolean;
  /**
   * Whether this surface's HEADER may name the channel after its counterpart.
   * Default `true` — `channel-display.ts › channelDisplayName`, which returns
   * the peer's name when `channels.is_direct`, and is what the workspace
   * channels page has always rendered for a DM.
   *
   * 🔒 **`false` PINS THE HEADER TO `channel.name`, AND /home PASSES IT
   * (Samuel, 2026-09-01).** A home container is a CHANNEL, not a DM: its
   * identity is its own name and does not change when its roster does. The
   * /home list row and Info tab were fixed at their own derivation
   * (`pages/home/home-rows.ts › channelTitle`), but this header reads a
   * DIFFERENT one — so a container whose channel carries `is_direct = true`
   * (every one minted before the 2026-08-24 channel-first inversion, which came
   * out of `../../server/service-writes.ts › createDirectChannel`) would still
   * have shown the peer's name at the
   * top of the pane, under a row and an Info card that both said the channel's.
   *
   * ⚠ **REAL DMs ARE UNAFFECTED, WHICH IS WHY THIS IS A FLAG AND NOT AN EDIT TO
   * `channel-display.ts`.** That module is the ONE counterpart derivation for
   * the workspace surfaces — `sidebar.tsx` (name + avatar) and
   * `channel-manage.tsx` — and a DM there must keep naming its peer. What
   * changed is which surfaces ASK it.
   */
  peerNamedHeader?: boolean;
  /**
   * Whether the VIEWER'S OWN STAKE in this channel — the membership row they
   * hold and the agent they run in it — is theirs to manage HERE. Default
   * `true` — every desktop mount. `false` hides the "Leave channel" row AND the
   * whole `ChannelAgentSettings` block.
   *
   * ⚠ ONE FLAG, TWO CONTROLS, BECAUSE THERE IS ONE STORY (Samuel, ruling
   * R2/R3, 2026-08-25). The GUEST LANE (`src/app/c/[workspaceId]`) is a person
   * with no Dopl desktop whose entire application is this channel: they run no
   * agent, so a tool profile governs a session that does not exist, and leaving
   * is a one-way exit from the only surface they have — the link that brought
   * them was revoked at claim. Two flags would let a future host turn one half
   * off and ship the other half's dead control with nothing saying so.
   *
   * ⚠ IT IS ABOUT THE VIEWER, WHERE `memberManagement` IS ABOUT THE CONTAINER.
   * The desktop's own home surface passes `memberManagement: false` (a fixed
   * two-person roster) and leaves this one alone: the operator absolutely does
   * manage their own agent there.
   */
  selfManagement?: boolean;
  /**
   * Draw the KNOWLEDGE tab — the knowledge bases granted INTO this channel,
   * read-only unless the grant carries `guest_write` (Home Knowledge Panels M4,
   * `knowledge-tab.tsx`).
   *
   * ⚠ DEFAULT `false`, WHICH INVERTS THE OTHER TWO, and the inversion is the
   * decision. `memberManagement`/`selfManagement` default to the workspace
   * page's behaviour because they REMOVE something; this one ADDS a tab.
   *
   * ⚠ EXACTLY ONE HOST PASSES IT SINCE 2026-08-27 — THE GUEST LANE (Samuel's
   * F-340 ruling). Both container surfaces did from M4, on the argument that the
   * operator should see what the guest sees; that cost the info column a FIFTH
   * tab on a width budget measured for four, and the row tightened and then
   * scrolled. **The duplicate view gave way, not the capability:** /home's own
   * header carries a full Knowledge FACE over the same bases
   * (`pages/home/knowledge-panels.tsx`), whereas for a guest this tab is the
   * ONLY way to read a base granted into the channel. Pinned in both directions
   * by `knowledge-tab.test.tsx › the capability, per host`.
   *
   * ⚠ THE WORKSPACE CHANNEL PAGE DELIBERATELY DOES NOT PASS IT (this wave). The
   * lane is scoped to ONE channel's grants, and that page already carries the
   * full knowledge surface, where the same bases are reachable with their
   * folders, search, authoring and the grant controls that CREATED these rows. A
   * narrower read of the same data one tab away would be a second answer to
   * "what is in this knowledge base" with nothing saying which is complete.
   *
   * ⚠ IT IS SAFE ON EVERY HOST REGARDLESS: the tab reads the guest-floored lane
   * (`knowledge-lane.ts`), never `/api/knowledge/**`. Turning it on somewhere
   * new is a product decision, not an authorization one.
   */
  knowledge?: boolean;
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
  selection: ChannelsV2Selection;
  /** A host read the roster can invalidate — the workspace page's channel list.
   *  This surface always refetches its OWN roster beside it. */
  onRosterChanged?: () => void;
  /**
   * The channel was DELETED from the Settings tab. The selection is cleared here
   * either way; a host that pins the surface to one channel (rather than picking
   * from a tree) has to stop rendering it, and this is the only notice it gets.
   */
  onDeselect?: () => void;
  slots?: ChannelSurfaceSlots;
  capabilities?: ChannelSurfaceCapabilities;
  /**
   * SINGLE COLUMN, AND WHICH FACE IS ON IT — the **WEB** channel page (Samuel,
   * 2026-09-04). Present swaps this surface's two columns for one full-width
   * main area with the faces behind a header dropdown; see
   * `channel-single-column.tsx` for the layout and `use-channel-web-view.ts` for
   * why the HOST owns the state (it is in the URL, and this file is router-free
   * by construction).
   *
   * ⚠ ABSENT IS EVERY DESKTOP MOUNT, byte for byte — the transcript with the
   * Info / Threads / Agents / Settings column sliding beside it.
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
  slots,
  capabilities,
  webView,
}: ChannelSurfaceProps) {
  const {
    members,
    agentSessions,
    agentsPanel,
    index,
    openThread,
    rows,
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
  // never a flip inside the mutation. Two fast clicks send `true` then `false`
  // and converge; a toggle verb would race. Named because BOTH layouts' headers
  // fire it and a second copy is a second answer.
  const toggleFavorite = () =>
    data.favorite.mutate({
      channelId: channel.id,
      favorite: channel.myFavoritedAt == null,
    });
  const messagePane = (viewSelect?: ReactNode) => (
    <ChannelsV2MessagePane
      channelId={channel.id}
      workspaceId={workspaceId}
      channelName={channelName}
      thread={openThread}
      rows={rows}
      index={index}
      members={members}
      loading={data.messagesLoading}
      outboundAsk={openThread ? (data.outboundByThread.get(openThread.id) ?? null) : null}
      outboundBusy={data.consentBusy}
      onDecideOutbound={data.decideOutbound}
      scrollTarget={sel.scrollTarget}
      // The Threads tab's "New thread", arriving from the OTHER column
      // (2026-08-24). It travels through the selection hook because that is
      // where cross-surface asks live, and because both hosts of this surface
      // then get it without a second wiring.
      newThreadSignal={sel.newThreadSignal}
      infoOpen={sel.infoOpen}
      favorited={channel.myFavoritedAt != null}
      onToggleFavorite={toggleFavorite}
      gate={gate}
      // THE @-PICKER'S AND THE RECIPIENT LINE'S FACTS (2026-09-02, slice B10): every member's
      // live sessions in this room, off the poll the Agents tab already makes, plus the
      // channel's nominated responder. Both handed down for `newAgent`'s reason — a second
      // mount of that hook is a second poll of an unpublished table.
      liveAgents={agentsPanel.peerSessions}
      defaultResponderAgentName={channel.defaultResponderAgentName}
      // The composer's New Agent icon (2026-08-21) — handed down whole,
      // never re-mounted: a second `useAgentsPanel` is a second peer poll.
      newAgent={agentsPanel}
      // THE POP-OUT (Phase 10). Rendered only with a thread open, and it
      // hides ITSELF outside the desktop shell (feature detection), so the
      // web tree gets no affordance for a window it cannot open.
      popOut={
        openThread ? (
          <PopOutThreadButton
            workspaceSlug={workspaceSlug}
            channelId={channel.id}
            threadId={openThread.id}
          />
        ) : null
      }
      // ⚠ MY OWN agents mid-turn, off the SAME bridge feed this surface
      // already reads (`data.agentSessions` — no new read, no poll). Rendered
      // in CHANNEL view as well as thread view, and scoped by `ownAgentsFor`
      // so it always tracks the composer's own target: a channel-level
      // composer shows every agent in the channel, a thread-scoped one shows
      // that thread's. `null` sessions ("could not ask") render nothing.
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
      // SCROLL-UP PAGING — the three values `use-channel-messages.ts` returns
      // for it, handed down whole. The pane owns the trigger and the anchor;
      // the hook owns the cursor.
      hasOlder={data.hasOlderMessages}
      loadingOlder={data.loadingOlderMessages}
      onLoadOlder={data.loadOlderMessages}
      viewSelect={viewSelect}
      onToggleInfo={sel.toggleInfo}
      onExitThread={() => sel.openThread(null)}
      // AN AGENT'S SENDER PILL OPENS THAT AGENT'S PANE (Samuel, 2026-08-28).
      // ⚠ THE AGENTS TAB'S OWN OPEN MECHANISM, NOT A SECOND ONE — literally the
      // function handed to `onOpenAgent` twenty lines below, so the card's Open
      // button and the transcript's pill cannot come to mean different things.
      // Safe on BOTH hosts of this surface: each one mounts the pane this moves
      // (`overlays.tsx` on the workspace page, the panel inside
      // `channel-surface-standalone.tsx` everywhere else).
      onOpenAgent={sel.setOpenAgent}
      // ANSWER AN ESCALATION — the transcript's one WRITE, and the only place
      // an option button can reach a mutation. `message-pane.tsx` passes it
      // straight down; the pop-out hands none, so a card there is read-only.
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
  // slide-out shell is not merely closed in the first branch, it is NOT
  // RENDERED: a column reserving width is what kept the chat off the page edge.
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
      {/* THE INFO COLUMN SLIDES (Samuel, 2026-08-24). The shell is ALWAYS
          rendered — a column that mounts at its open width has no 0-width start
          state to animate from — and the panel inside mounts on open and stays
          one transition past close so the closing slide has content to clip. */}
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
