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

import { useEffect, useState, type ReactNode } from "react";
import type { MutationGate } from "@/shared/hooks/use-api-mutation";
import type { Role } from "@/features/workspaces/types";
import { channelDisplayName } from "../../lib/channel-display";
import { ChannelsV2SettingsSlot } from "./settings-slot";
import { ChannelsV2MessagePane } from "./message-pane";
import { ChannelsV2InfoPanel } from "./info-panel";
import { PopOutThreadButton } from "./pop-out";
import { AgentActivityRows, ownAgentsWorking } from "./agent-activity";
import { PeerActivityRow, peerWorkingOn } from "./peer-activity";
import type { ChannelSurfaceData } from "./channel-surface-data";
import type { ChannelsV2Selection } from "./use-channels-v2-selection";
import type { Channel, ChannelMention } from "../../types";

/** The info column stays mounted this long after close so its slide can run.
 *  ⚠ Keep in sync with `.channel-info-slide`'s transition (globals.css + the
 *  desktop `kit.css` copy). */
const INFO_SLIDE_MS = 200;

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
}: ChannelSurfaceProps) {
  const {
    members,
    threads,
    mentions,
    agentSessions,
    agentsPanel,
    index,
    openThread,
    rows,
    gate,
  } = data;
  const channelName = channelDisplayName(channel, members, currentUserId);
  // ⚠ THE PANEL OUTLIVES `infoOpen` BY ONE TRANSITION, so the closing slide has
  // something to clip; the shell it sits in is always rendered (see the JSX).
  // Presentation only — `sel.infoOpen` stays the single source of truth for the
  // toggle, and the OR below means this can never hold the column open, only
  // briefly populated. Same shape as `Popover`'s exit phase.
  //
  // ⚠ THE ONLY setState IS INSIDE THE TIMER, and OPENING schedules a 0ms one it
  // does not need — because mounting is already handled by the OR. Both are
  // deliberate: `react-hooks/set-state-in-effect` (error, not warning) rejects a
  // synchronous setState in an effect body, and a 0ms timer is how the same
  // machine serves the open direction and the reduced-motion escape, where the
  // kit turns the transition off and nothing may wait for it.
  const [infoTrailing, setInfoTrailing] = useState(sel.infoOpen);
  useEffect(() => {
    if (infoTrailing === sel.infoOpen) return;
    const instant =
      sel.infoOpen ||
      (typeof window !== "undefined" &&
        typeof window.matchMedia === "function" &&
        window.matchMedia("(prefers-reduced-motion: reduce)").matches);
    const timer = setTimeout(
      () => setInfoTrailing(sel.infoOpen),
      instant ? 0 : INFO_SLIDE_MS
    );
    return () => clearTimeout(timer);
  }, [sel.infoOpen, infoTrailing]);
  const infoMounted = sel.infoOpen || infoTrailing;

  // The Tags inbox's click: mark read, land the center pane on the right
  // transcript, then signal the scroll. The scroll effect runs POST-render, so
  // the swapped transcript is in the DOM before it looks for the message row.
  //
  // ⚠ The mark-read is OPTIMISTIC (`use-mention-writes.ts`), which is what makes
  // the badge drop in the same frame as the navigation. The nonced scroll signal
  // is `use-channels-v2-selection.ts › jumpToMessage`.
  const openMention = (mention: ChannelMention) => {
    if (!mention.read) {
      data.markRead.mutate({
        channelId: channel.id,
        messageIds: [mention.messageId],
      });
    }
    sel.jumpToMessage(mention.threadId, mention.messageId);
  };

  // ⚠ MARK-ALL SENDS THE IDS IT IS DISPLAYING, never a flag. The list is
  // bounded and says when it clipped, so "all" can only honestly mean the page
  // — and naming the ids makes that true by construction rather than by comment
  // (INVARIANTS §9). Already-read rows are filtered out so a no-op click sends
  // no request at all.
  const markAllMentionsRead = () => {
    const unread = mentions.filter((m) => !m.read).map((m) => m.messageId);
    if (unread.length === 0) return;
    data.markRead.mutate({ channelId: channel.id, messageIds: unread });
  };

  return (
    <>
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
        // ⚠ THE DESIRED STATE IS COMPUTED HERE, from the row the header is
        // rendering — never a flip inside the mutation. Two fast clicks send
        // `true` then `false` and converge; a toggle verb would race.
        favorited={channel.myFavoritedAt != null}
        onToggleFavorite={() =>
          data.favorite.mutate({
            channelId: channel.id,
            favorite: channel.myFavoritedAt == null,
          })
        }
        gate={gate}
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
      {/* THE INFO COLUMN SLIDES (Samuel, 2026-08-24). The shell is ALWAYS
          rendered — a column that mounts at its open width has no 0-width start
          state to animate from — and the panel inside mounts on open and stays
          one transition past close so the closing slide has content to clip. */}
      <div
        className="channel-info-slide"
        data-open={sel.infoOpen}
        aria-hidden={!sel.infoOpen}
      >
      {infoMounted && (
        <ChannelsV2InfoPanel
          channel={channel}
          channelName={channelName}
          members={members}
          threads={threads}
          threadsTruncated={data.threadsTruncated}
          threadsLoading={data.threadsLoading}
          index={index}
          openThread={openThread}
          onOpenThread={sel.openThread}
          onNewThread={sel.requestNewThread}
          agentSessions={agentSessions}
          peerSessions={agentsPanel.peerSessions}
          canLaunchAgent={
            agentsPanel.canLaunch &&
            !!openThread &&
            (openThread.createdBy === currentUserId ||
              openThread.targetUserId === currentUserId)
          }
          launchBusy={agentsPanel.launchBusy}
          launchError={agentsPanel.launchError}
          // ⚠ THE PROMISE IS HANDED THROUGH, not voided (2026-08-22). The
          // template picker inside the tab AWAITS this to learn whether main
          // asked for a first-use approval; a `void` wrapper here would make
          // every picker launch look like a build with no bridge.
          onLaunchAgent={(id, templateId, overrides) =>
            agentsPanel.launchAgent(id, templateId, overrides)
          }
          onApproveTemplate={agentsPanel.approveTemplate}
          openAgent={sel.openAgent}
          onOpenAgent={sel.setOpenAgent}
          mentions={mentions}
          mentionsTruncated={data.mentionsTruncated}
          mentionsLoading={data.mentionsLoading}
          onOpenMention={openMention}
          onMarkAllMentionsRead={markAllMentionsRead}
          // THE KNOWLEDGE TAB (M4) — opt-in, see `ChannelSurfaceCapabilities`.
          knowledge={capabilities?.knowledge}
          // ⚠ CALLED, not passed. The tab is a render function so it can be
          // handed THIS surface's refetch gate — see `ChannelInfoTabContext`.
          infoTab={slots?.infoTab?.({ gate })}
          // THE SETTINGS TAB (Samuel, 2026-08-19). This cluster hung off the
          // pane HEADER until then; the header keeps only the info toggle.
          // ⚠ THREAD-SCOPED WHILE A THREAD IS OPEN (2026-08-21) — the branch
          // is `settings-slot.tsx`, which owns why it lives at the MOUNT.
          settings={
            <ChannelsV2SettingsSlot
              channel={channel}
              workspaceId={workspaceId}
              workspaceSlug={workspaceSlug}
              currentUserId={currentUserId}
              role={role}
              members={members}
              thread={openThread}
              agentSessions={agentSessions}
              gate={gate}
              memberManagement={capabilities?.memberManagement}
              selfManagement={capabilities?.selfManagement}
              onDeselect={() => {
                sel.selectChannel(null);
                onDeselect?.();
              }}
              onExitThread={() => sel.openThread(null)}
              onRosterChanged={() => {
                onRosterChanged?.();
                data.refetchMembers();
              }}
            />
          }
        />
      )}
      </div>
    </>
  );
}
