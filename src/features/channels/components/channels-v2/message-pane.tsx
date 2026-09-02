"use client";

/**
 * Channels v2 — CENTER COLUMN: breadcrumb header, the transcript and the
 * composer card.
 *
 * TWO views over one column (the port's intent doc § the center-pane state
 * machine, deleted at the Phase 12 cutover — INVARIANTS §5):
 *
 * - **Channel view** (`thread === null`) — the channel's own posts plus one
 *   card per thread, crumb `# <channel>`.
 * - **Thread view** — the thread's OWN transcript replaces it, crumb becomes
 *   `# <channel> / <title>` and the channel crumb is THE WAY BACK. The composer
 *   stays put in both; only the transcript and the crumb trail swap.
 *
 * The rows themselves are `transcript.tsx`; the derivation is
 * `view-model.ts › channelRows` / `› threadRows`. This file owns the chrome,
 * the scroller and the scroll-to-message signal.
 *
 * ⚠ THE HEADER'S RIGHT SIDE IS ONE BUTTON (Samuel, 2026-08-19). It used to carry
 * the whole channel-management cluster — settings sliders, working folder,
 * invite, kebab — plus an inert sparkle. **The cluster moved into the right
 * panel's SETTINGS tab** (`channel-manage.tsx` → `settings-tab.tsx`), the sparkle
 * was DELETED rather than moved because it was decoration with no handler, and
 * what is left on the right is the info toggle, with the thread view's pop-out
 * immediately to its left. The breadcrumb keeps its bookmark, which stays beside
 * the title rather than joining the right-hand cluster: it acts on WHAT THE CRUMB
 * NAMES, not on the pane.
 *
 * ⚠ THE BOOKMARK IS REAL NOW (Samuel, 2026-08-19, superseding the keep-hardcoded
 * ruling for Favorites specifically — the rest of the furniture in `fixtures.ts`
 * stays). It favourites the OPEN CHANNEL for the viewer alone
 * (`channel_members.favorited_at`), and the sidebar's Favorites section is the
 * list it feeds. **THREAD VIEW FAVOURITES THE CHANNEL TOO** — a thread is not a
 * favouritable thing (no per-(user, thread) row exists) and the crumb still names
 * the channel, so the control's meaning does not change when a thread opens.
 *
 * ⚠ TWO CHROMES, ONE PANE (`chrome`). `"page"` is the surface above. `"window"`
 * is the POP-OUT THREAD WINDOW (`thread-window.tsx`): the same transcript,
 * scroller and composer with the crumb reduced to the thread's own title and no
 * chrome at all — there is no info panel to toggle, no channel to go back to and
 * no sidebar beside it. Rendering it here rather than assembling a second pane
 * out of `transcript.tsx` + `composer.tsx` is deliberate: the scroll-target
 * contract below and the stick-to-bottom rules (`use-stick-to-bottom.ts`, split
 * out at the cap on 2026-08-20 and called from HERE alone) have exactly one
 * implementation, and a second copy of either is a second answer.
 */

import { useEffect, useRef, useState, type ReactNode } from "react";
import type { MutationGate } from "@/shared/hooks/use-api-mutation";
import { PaneHeader } from "./message-pane-header";
import { useStickToBottom } from "./use-stick-to-bottom";
import { useLoadOlder } from "./use-load-older";
import { Transcript } from "./transcript";
import { ChannelsV2Composer } from "./composer";
import { ThreadSendBox } from "./thread-consent";
import type { AgentLaunchControls } from "./use-agents-panel";
import {
  threadOtherPartyOf,
  type LiveAgentSession,
} from "../../lib/draft-recipients";
import type { AuthorIndex } from "./view-model";
import type { TranscriptRow } from "./view-model-rows";
import type {
  ChannelConsentRequest,
  ChannelMember,
  ChannelThread,
} from "../../types";

/**
 * The Tags inbox's scroll-to-message signal. NONCED: clicking the same mention
 * twice must re-scroll, and a plain `{messageId}` object would be swallowed the
 * moment somebody "optimizes" the state update with an equality check — the
 * nonce makes every click a distinct value by construction.
 */
export interface ScrollTarget {
  messageId: string;
  nonce: number;
}

/**
 * What a scroll target that is NOT IN THE LOADED TRANSCRIPT says out loud.
 *
 * ⚠ The click still marks the mention read and still navigates — those are
 * correct and they happen. What could not happen is the scroll, because the row
 * is below the transcript read's own ceiling. Silently doing two of three
 * things is the failure: the operator clicks a tag, the panel visibly reacts,
 * and the transcript does not move, with nothing anywhere saying why.
 *
 * ⚠ IT PROMISES NO REMEDY, because there is none to offer: this pane has no
 * page argument and no deeper read (the same shape the two clip notes are in —
 * INVARIANTS §9). It states what happened and stops.
 */
export const SCROLL_TARGET_MISSING_NOTE =
  "That message is older than the loaded history, so the transcript did not move.";

/** How long the flash tint stands on a row that WAS found. */
const FLASH_MS = 1600;
/** How long the "older than the loaded history" line stands. Longer than the
 *  flash: a tint is glanced at, a sentence is read. */
const MISSING_NOTICE_MS = 6000;

/**
 * The default for the callbacks only the `"page"` chrome can fire. The pop-out
 * window has no info panel to toggle, no channel view to return to and no thread
 * cards in its rows, so it hands over none of them.
 */
const DECIDE_OUTBOUND_NOOP = () => {};
const NOOP = () => {};

export function ChannelsV2MessagePane({
  channelId,
  workspaceId,
  channelName,
  thread,
  rows,
  index,
  members,
  loading,
  outboundAsk = null,
  outboundBusy = false,
  onDecideOutbound = DECIDE_OUTBOUND_NOOP,
  scrollTarget,
  newThreadSignal,
  infoOpen = false,
  favorited = false,
  gate,
  liveAgents,
  defaultResponderAgentName = null,
  newAgent,
  popOut,
  agentActivity,
  peerActivity,
  chrome = "page",
  onToggleInfo = NOOP,
  onToggleFavorite = NOOP,
  onExitThread = NOOP,
  onOpenAgent,
  onAnswerEscalation,
  answerBusy = false,
  onOpenThread = NOOP,
  hasOlder = false,
  loadingOlder = false,
  onLoadOlder = NOOP,
}: {
  channelId: string;
  workspaceId: string;
  channelName: string;
  /** The open thread, or `null` for the channel view. */
  thread: ChannelThread | null;
  rows: TranscriptRow[];
  index: AuthorIndex;
  members: ChannelMember[];
  loading: boolean;
  /** The OPEN thread's pending outbound review (my agent's draft awaiting my
   *  Send), or null. Caller joins it — `pendingOutboundByThread`. */
  outboundAsk?: ChannelConsentRequest | null;
  outboundBusy?: boolean;
  onDecideOutbound?: (id: string, decision: "allow" | "deny") => void;
  scrollTarget: ScrollTarget | null;
  /** Nonced ask from the Threads tab to open the composer's new-thread panel.
   *  ⚠ PASSED STRAIGHT DOWN — the panel's state belongs to the composer. */
  newThreadSignal?: number;
  /** `"page"` chrome only — the info toggle's pressed state. */
  infoOpen?: boolean;
  /** `"page"` chrome only — the viewer has favourited THIS CHANNEL
   *  (`Channel.myFavoritedAt != null`, computed by the caller). Drives the
   *  bookmark's fill and its `aria-pressed`. */
  favorited?: boolean;
  /** The page's refetch coordinator, handed straight to the composer's writes. */
  gate: MutationGate;
  /**
   * **THE CHANNEL'S LIVE AGENT SESSIONS — every member's** (2026-09-02, slice B10), for the
   * composer's @-picker and its recipient line. ⚠ HANDED DOWN, never read here, for the reason
   * `newAgent` is: a second mount of `use-channel-agent-sessions.ts` is a second poll of an
   * unpublished table. A host with no such read hands none and the picker offers members only.
   */
  liveAgents?: readonly LiveAgentSession[];
  /** `channels.default_responder_agent_name` — who answers an untagged message (RR3 arm 1).
   *  ⚠ Absent is not "nobody": the composer's line still falls to the room's one live agent. */
  defaultResponderAgentName?: string | null;
  /**
   * The page's launch controls (`use-agents-panel.ts › AgentLaunchControls`),
   * for the composer's New Agent icon. ⚠ PASSED DOWN, never mounted here: a
   * second `useAgentsPanel` would be a second peer poll of `channel_sessions` on
   * its own interval. ⚠ OPTIONAL — the pop-out thread window has no panel to
   * hand over, and the composer renders no button rather than a dead one.
   */
  newAgent?: AgentLaunchControls;
  /**
   * "Open as new window" (`pop-out.tsx › PopOutThreadButton`), injected as a
   * SLOT rather than imported: it needs the workspace segment, which this file
   * has no business knowing. THREAD VIEW ONLY — the channel view has no thread
   * to pop out — and it renders itself away outside the desktop shell (wiring
   * plan Phase 10). It sits immediately LEFT of the info toggle and wears the
   * same `IconButton` face (Samuel, 2026-08-19).
   */
  popOut?: ReactNode;
  /**
   * "Anthony's agent is working…" (`peer-activity.tsx › PeerActivityRow`), a
   * SLOT for the same reason `popOut` is — it needs a read this file has no
   * business making — and wanted by BOTH chromes. ⚠ Its place is between the
   * send box and the composer: above the composer so it reads as context for
   * what you are about to type, below the send box so it never separates a
   * decision from the draft it is about.
   */
  /** MY agents mid-turn on this surface — `agent-activity.tsx`. Sits ABOVE the
   *  peer row: the operator's own machine is the nearer fact. */
  agentActivity?: ReactNode;
  peerActivity?: ReactNode;
  /** Which header this pane wears — see the file docblock. */
  chrome?: "page" | "window";
  /** `"page"` chrome only. */
  onToggleInfo?: () => void;
  /** `"page"` chrome only — flips the viewer's favourite on this channel. */
  onToggleFavorite?: () => void;
  /** `"page"` chrome only — the channel crumb is the way back out of a thread. */
  onExitThread?: () => void;
  /**
   * Set by an AGENT'S SENDER PILL — the transcript's way into the agent pane (Samuel,
   * 2026-08-28). ⚠ PASSED STRAIGHT DOWN, and OPTIONAL for the same reason `newAgent` is: the
   * `"window"` chrome has no agent pane beside it, so it hands none and its pills stay inert
   * rather than becoming buttons that open nothing. `transcript.tsx › Message` carries the
   * rest of the gate.
   */
  onOpenAgent?: (agentId: string) => void;
  /**
   * ANSWER an escalation card — set by a host that can WRITE.
   *
   * ⚠ OPTIONAL, and absent renders no option buttons at all (never disabled
   * ones) — the same rule `onOpenAgent` above and `newAgent` follow. The
   * `"window"` chrome hands none, so a card popped out reads as the record of a
   * question rather than as a control that cannot fire.
   */
  onAnswerEscalation?: (escalationMessageId: string, optionIndex: number) => void;
  /** An answer is in flight — the double-submit guard, not a capability. */
  answerBusy?: boolean;
  /** Set by an in-transcript thread card — the channel view's way IN. */
  onOpenThread?: (id: string) => void;
  /**
   * SCROLL-UP PAGING — the three values `use-channel-messages.ts` returns for
   * it, handed down rather than read here for the same reason `newAgent` is: a
   * second mount of that hook would be a second transcript read.
   *
   * ⚠ ALL THREE DEFAULT TO INERT, so a host that knows nothing about paging (the
   * pop-out window's own reads, and every test that mounts this pane with a
   * fixed row list) gets today's behaviour: no trigger, no indicator, no
   * `before` request.
   */
  hasOlder?: boolean;
  loadingOlder?: boolean;
  onLoadOlder?: () => void;
}) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  // ⚠ DECLARED FIRST. Its effects must run BEFORE the scroll-target effect
  // below, so a mention jump is never overwritten by a stick-to-bottom in the
  // same commit — see the hook's own note.
  const releasePin = useStickToBottom(
    scrollerRef,
    `${channelId}:${thread?.id ?? ""}`,
    rows.length
  );
  // ⚠ DECLARED SECOND, BETWEEN THE PIN AND THE SCROLL-TARGET EFFECT BELOW.
  // Effects run in declaration order: on a commit that both prepends a page and
  // satisfies a mention jump, the pin is a no-op (a reader at the top is not
  // pinned), the anchor restores the reading position, and the jump — declared
  // last — still wins.
  useLoadOlder(scrollerRef, {
    canLoad: hasOlder && !loading,
    loading: loadingOlder,
    // The row the reader's position is measured against. `rows` is ascending, so
    // the first one is the top of the loaded window and the row a prepended page
    // pushes down.
    topRowId: rows[0]?.id ?? null,
    rowCount: rows.length,
    onLoad: onLoadOlder,
  });

  // The flash is DERIVED: a target flashes until its nonce is marked spent by
  // the timeout. No synchronous setState in the effect — the render pass
  // already knows the flash is on the moment the target lands.
  const [spentNonce, setSpentNonce] = useState(0);
  const live = scrollTarget !== null && scrollTarget.nonce !== spentNonce;
  // ⚠ ANSWERED FROM `rows`, NOT FROM THE DOM. Whether the target is inside the
  // loaded transcript is a PURE question about the data this pane was handed,
  // and answering it during render is what lets the notice below exist without
  // a `set-state-in-effect` violation. Every row kind carries its message id as
  // `row.id` and renders it as `data-message-id`, so this and the query below
  // ask the same question of the same key.
  const loaded = live && rows.some((row) => row.id === scrollTarget.messageId);
  const flashId = loaded ? scrollTarget.messageId : null;
  // ⚠ NOT while the read is still in flight: "older than the loaded history" is
  // a claim about a FINISHED transcript, and an unloaded one has no history yet.
  const missing = live && !loading && !loaded;

  // Runs POST-render, so when a mention click also swapped the view, the new
  // transcript is already in the DOM by the time we look the row up. Smooth
  // scroll unless the user asked for reduced motion; the flash fades on its own
  // via the row's colour transition.
  useEffect(() => {
    // Wait for the rows rather than spending the nonce against an empty
    // transcript — a target dropped mid-load is a silently lost navigation.
    if (!scrollTarget || loading) return;
    const row = scrollerRef.current?.querySelector(
      `[data-message-id="${scrollTarget.messageId}"]`
    );
    if (row) {
      // A deliberate landing in history IS a reading position: the next message
      // to arrive must not drag the reader back down out of it.
      releasePin();
      const reduceMotion =
        typeof window.matchMedia === "function" &&
        window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      row.scrollIntoView({
        behavior: reduceMotion ? "auto" : "smooth",
        block: "center",
      });
    }
    // ⚠ THE NONCE IS SPENT EITHER WAY. It used to be spent only on a HIT — a
    // miss returned early, so the flash state pinned on that nonce forever and
    // the next click on the same message was a no-op on top of a no-op.
    const timer = setTimeout(
      () => setSpentNonce(scrollTarget.nonce),
      row ? FLASH_MS : MISSING_NOTICE_MS
    );
    return () => clearTimeout(timer);
  }, [scrollTarget, loading, releasePin]);

  return (
    <section className="flex min-w-0 flex-1 flex-col">
      <PaneHeader
        channelName={channelName}
        threadTitle={thread?.title ?? null}
        infoOpen={infoOpen}
        favorited={favorited}
        popOut={popOut}
        chrome={chrome}
        onToggleInfo={onToggleInfo}
        onToggleFavorite={onToggleFavorite}
        onExitThread={onExitThread}
      />
      {/* ⚠ THE AWAITING STRIP STOOD HERE AND IS DELETED (Samuel, 2026-08-22).
          "This request is awaiting your answer" + Decline / Launch agent under
          the header was the INBOUND consent surface; the ruling retired the
          whole lane. `thread-consent.tsx` keeps only the outbound send box,
          below the scroller. */}
      {/* ⚠ THE SCROLLER OWNS THE TRANSCRIPT'S GUTTER, and it is the only thing
          that may (Samuel, 2026-08-19: the rows ran "a little too close" to the
          pane edge). `px-6` → `px-8` is one step on the scale this tree actually
          uses — there is no `px-7` anywhere in `src/` — so a row's content edge
          moves 24px → 32px. The rows' own `-mx-2 … px-2` pair cancels out of
          that sum by design: it exists so the flash tint can bleed 8px wider
          than the text WITHOUT moving it, which is why per-row margins are the
          wrong knob here — they would compound with that pair and with the
          avatar gutter, and the two chromes would drift apart. Both chromes and
          both views scroll through this one box. */}
      <div ref={scrollerRef} className="min-h-0 flex-1 overflow-y-auto px-8 py-5">
        {/* ⚠ INSIDE THE SCROLLER, ABOVE THE ROWS — beside the transcript it is
            about, not in a footer a skimmer drops. Same placement rule the clip
            notes follow. */}
        {missing && (
          <p
            role="status"
            className="mb-3 rounded-[8px] border border-border-default bg-card-surface-subtle px-2.5 py-2 text-caption text-text-muted"
          >
            {SCROLL_TARGET_MISSING_NOTE}
          </p>
        )}
        {/* ⚠ ABOVE THE ROWS AND INSIDE THE SCROLLER — it belongs to the edge it
            describes, and it is the one thing between the reader and the page
            they are waiting for. **It reserves height while it stands**, which
            is not decoration: `use-load-older.ts` restores the reading position
            by MEASURING the anchor row, so a band that appears and disappears is
            absorbed by that measurement rather than jolting the transcript.
            ⚠ NO "you have reached the beginning" TWIN when the history runs out
            — the minimal-copy ruling (INVARIANTS §5): the absence of more rows
            is the message, and a permanent sentence at the top of every fully
            read channel is an explainer nobody asked for. */}
        {loadingOlder && (
          <p
            role="status"
            aria-busy="true"
            className="mb-3 text-center text-caption text-text-muted"
          >
            Loading earlier messages
          </p>
        )}
        {loading ? (
          <p role="status" aria-busy="true" className="sr-only">
            Loading transcript
          </p>
        ) : (
          <Transcript
            rows={rows}
            index={index}
            flashId={flashId}
            // ⚠ THE CARD'S LAUNCH RIDES THE SAME CONTROLS THE COMPOSER'S BOT
            // ICON DOES, handed down rather than re-mounted: a second
            // `useAgentsPanel` is a second peer poll. Absent (the pop-out
            // window) renders no button, which is correct — that surface has no
            // thread cards in its rows either.
            canLaunchAgent={newAgent?.canLaunch ?? false}
            launchBusy={newAgent?.launchBusy ?? false}
            onLaunchAgent={(id) => void newAgent?.launchAgent(id)}
            onOpenAgent={onOpenAgent}
            onAnswerEscalation={onAnswerEscalation}
            answerBusy={answerBusy}
            onOpenThread={onOpenThread}
          />
        )}
      </div>
      <ThreadSendBox
        thread={thread}
        outboundAsk={outboundAsk}
        busy={outboundBusy}
        onDecide={onDecideOutbound}
      />
      {/* ⚠ TWO ACTIVITY LANES, MINE FIRST. `agentActivity` is this machine's own
          agents (`agent-activity.tsx`), `peerActivity` is everybody else's
          (`peer-activity.tsx`) — separate slots because they read different
          facts with opposite failure modes, and because mine renders in CHANNEL
          view as well while the peer row is thread-only. Both render nothing
          when nothing is working; neither reserves a blank band. */}
      {agentActivity}
      {peerActivity}
      <ChannelsV2Composer
        newThreadSignal={newThreadSignal}
        channelId={channelId}
        workspaceId={workspaceId}
        members={members}
        currentUserId={index.currentUserId}
        liveAgents={liveAgents}
        defaultResponderAgentName={defaultResponderAgentName}
        // ⚠ RR1's ANSWER, COMPUTED FROM THE THREAD ROW THIS PANE IS ALREADY RENDERING — an
        // unaddressed reply in a thread goes to the exchange's OTHER party, and the composer must
        // not re-derive that pair. `null` in channel view, where there is no exchange.
        threadOtherParty={threadOtherPartyOf(thread, members, index.currentUserId)}
        gate={gate}
        newAgent={newAgent}
        // ⚠ THE OPEN THREAD IS THE TARGET, and `null` is a real answer rather
        // than a missing one: channel view starts a CHANNEL-LEVEL agent.
        openThreadId={thread?.id ?? null}
      />
    </section>
  );
}
