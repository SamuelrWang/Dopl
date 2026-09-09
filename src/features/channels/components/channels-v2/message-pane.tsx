"use client";

/**
 * Channels v2 — CENTER COLUMN: breadcrumb header, the transcript and the
 * composer card. TWO views over one column (INVARIANTS §5):
 *
 * - **Channel view** (`thread === null`) — the channel's posts plus one card per
 *   thread, crumb `# <channel>`.
 * - **Thread view** — the thread's OWN transcript, crumb `# <channel> / <title>`
 *   with the channel crumb THE WAY BACK. The composer stays put in both.
 *
 * Rows are `transcript.tsx`, the derivation `view-model.ts › channelRows` /
 * `› threadRows`; this file owns the chrome, the scroller and the scroll signal.
 *
 * ⚠ THE HEADER'S RIGHT SIDE IS ONE BUTTON (Samuel, 2026-08-19): the management
 * cluster moved to the right panel's SETTINGS tab (`channel-manage.tsx` →
 * `settings-tab.tsx`) and the inert sparkle was DELETED. The breadcrumb keeps its
 * bookmark — it acts on WHAT THE CRUMB NAMES.
 *
 * ⚠ THE BOOKMARK IS REAL NOW (Samuel, 2026-08-19, superseding the keep-hardcoded
 * ruling for Favorites specifically — the rest of `fixtures.ts` stays): it
 * favourites the OPEN CHANNEL for the viewer alone
 * (`channel_members.favorited_at`). **THREAD VIEW FAVOURITES THE CHANNEL TOO** —
 * no per-(user, thread) row exists.
 *
 * ⚠ TWO CHROMES, ONE PANE (`chrome`): `"page"`, and `"window"` for the POP-OUT
 * THREAD WINDOW (`thread-window.tsx`) — no info panel, no sidebar. Rendering it
 * here keeps ONE implementation of the scroll-target contract and the
 * stick-to-bottom rules (`use-stick-to-bottom.ts`, called from HERE alone).
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
 * moment somebody "optimizes" the state update with an equality check.
 */
export interface ScrollTarget {
  messageId: string;
  nonce: number;
}

/** ⚠ ONE REFERENCE for the default — the composer's recipient line memoizes on
 *  it, and a fresh `[]` per render would re-run that memo forever. */
const EMPTY_RECENT_AGENT_IDS: readonly string[] = [];

/**
 * What a scroll target that is NOT IN THE LOADED TRANSCRIPT says out loud. The
 * click still marks the mention read and navigates; silently doing two of three
 * things is the failure. ⚠ IT PROMISES NO REMEDY, because there is none: this
 * pane has no page argument and no deeper read (INVARIANTS §9).
 */
export const SCROLL_TARGET_MISSING_NOTE =
  "That message is older than the loaded history, so the transcript did not move.";

/** How long the flash tint stands on a row that WAS found. */
const FLASH_MS = 1600;
/** How long the "older than the loaded history" line stands. Longer than the
 *  flash: a tint is glanced at, a sentence is read. */
const MISSING_NOTICE_MS = 6000;

/** The default for the callbacks only the `"page"` chrome can fire — the pop-out
 *  window has no info panel, no channel view and no thread cards. */
const DECIDE_OUTBOUND_NOOP = () => {};
const NOOP = () => {};

export function ChannelsV2MessagePane({
  channelId,
  workspaceId,
  channelName,
  thread,
  rows,
  recentAgentIds = EMPTY_RECENT_AGENT_IDS,
  index,
  members,
  loading,
  stale = false,
  outboundAsk = null,
  outboundBusy = false,
  onDecideOutbound = DECIDE_OUTBOUND_NOOP,
  scrollTarget,
  newThreadSignal,
  infoOpen = false,
  viewSelect,
  favorited = false,
  gate,
  liveAgents,
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
  /** RR3 arm 3's input for the composer's recipient line: agents that posted in
   *  this room lately, most recent first. Handed down, not re-derived — one
   *  answer per page (`derivations.ts`). */
  recentAgentIds?: readonly string[];
  index: AuthorIndex;
  members: ChannelMember[];
  loading: boolean;
  /** THE RENDERED ROWS BELONG TO THE PREVIOUS CHANNEL — `use-channel-messages.ts ›
   *  stale` (`isPlaceholderData`), for the SCROLL rules alone (2026-09-08). ⚠ NOT
   *  `loading`: `keepPreviousData` keeps the old transcript on screen with
   *  `isPending` FALSE, so a channel open changes `rows.length` TWICE and only this
   *  tells the placeholder commit from the real one (`use-stick-to-bottom.ts` rule
   *  1). Defaults `false`. */
  stale?: boolean;
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
  /** THE WEB'S VIEW DROPDOWN — handed to `PaneHeader`, where it takes the info
   *  toggle's place. See that file for the ruling. */
  viewSelect?: ReactNode;
  /** `"page"` chrome only — the viewer has favourited THIS CHANNEL
   *  (`Channel.myFavoritedAt != null`). Drives the bookmark's fill and
   *  `aria-pressed`. */
  favorited?: boolean;
  /** The page's refetch coordinator, handed straight to the composer's writes. */
  gate: MutationGate;
  /** **THE CHANNEL'S LIVE AGENT SESSIONS — every member's** (2026-09-02, slice B10),
   *  for the composer's @-picker and recipient line. ⚠ HANDED DOWN, never read
   *  here: a second mount of `use-channel-agent-sessions.ts` is a second poll of an
   *  unpublished table. A host with none hands none; the picker offers members. */
  liveAgents?: readonly LiveAgentSession[];
  // ⚠ **`defaultResponderAgentName` IS OFF THIS SURFACE (2026-09-07, items 10 and 11)** — the
  // room-wide nomination is deleted and its per-member replacement is read from the ROSTER this
  // pane already passes down (`members`), which is what makes the pop-out exact with it.
  /** The page's launch controls (`use-agents-panel.ts › AgentLaunchControls`) for
   *  the composer's New Agent icon. ⚠ PASSED DOWN, never mounted here: a second
   *  `useAgentsPanel` is a second peer poll. ⚠ OPTIONAL — the pop-out renders no
   *  button rather than a dead one. */
  newAgent?: AgentLaunchControls;
  /** "Open as new window" (`pop-out.tsx › PopOutThreadButton`), a SLOT because it
   *  needs the workspace segment this file has no business knowing. THREAD VIEW
   *  ONLY, and it renders itself away outside the desktop shell. Immediately LEFT
   *  of the info toggle, same `IconButton` face (Samuel, 2026-08-19). */
  popOut?: ReactNode;
  /** MY agents mid-turn on this surface — `agent-activity.tsx`. Sits ABOVE the
   *  peer row: the operator's own machine is the nearer fact. */
  agentActivity?: ReactNode;
  /** "Anthony's agent is working…" (`peer-activity.tsx › PeerActivityRow`), a SLOT
   *  for `popOut`'s reason and wanted by BOTH chromes. ⚠ It sits BETWEEN the send
   *  box and the composer: context for what you are about to type, and never
   *  separating a decision from the draft it is about. */
  peerActivity?: ReactNode;
  /** Which header this pane wears — see the file docblock. */
  chrome?: "page" | "window";
  /** `"page"` chrome only. */
  onToggleInfo?: () => void;
  /** `"page"` chrome only — flips the viewer's favourite on this channel. */
  onToggleFavorite?: () => void;
  /** `"page"` chrome only — the channel crumb is the way back out of a thread. */
  onExitThread?: () => void;
  /** Set by an AGENT'S SENDER PILL — the transcript's way into the agent pane
   *  (Samuel, 2026-08-28). ⚠ OPTIONAL: the `"window"` chrome has no agent pane, so
   *  its pills stay inert. `transcript.tsx › Message` carries the rest. */
  onOpenAgent?: (agentId: string) => void;
  /** ANSWER an escalation card — set by a host that can WRITE. ⚠ OPTIONAL, and
   *  absent renders no option buttons at all (never disabled ones), so a card in
   *  the `"window"` chrome reads as a record rather than a dead control. */
  onAnswerEscalation?: (escalationMessageId: string, optionIndex: number) => void;
  /** An answer is in flight — the double-submit guard, not a capability. */
  answerBusy?: boolean;
  /** Set by an in-transcript thread card — the channel view's way IN. */
  onOpenThread?: (id: string) => void;
  /** SCROLL-UP PAGING — `use-channel-messages.ts`'s three values, handed down
   *  because a second mount is a second transcript read. ⚠ ALL THREE DEFAULT TO
   *  INERT: a host that knows nothing about paging requests nothing. */
  hasOlder?: boolean;
  loadingOlder?: boolean;
  onLoadOlder?: () => void;
}) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  // ⚠ DECLARED FIRST: its effects must run BEFORE the scroll-target effect below,
  // so a mention jump is never overwritten by a stick-to-bottom in the same commit.
  const releasePin = useStickToBottom(
    scrollerRef,
    `${channelId}:${thread?.id ?? ""}`,
    rows.length,
    // ⚠ THE NEWEST ROW — `rows` is ASCENDING, so the last is what just arrived, and the pin
    // smooth-scrolls to its START. Absent, the hook falls back to a plain jump-to-bottom.
    rows[rows.length - 1]?.id ?? null,
    // ⚠ RULE 1'S GATE — "the rows on screen are not this view's yet". Both halves: the read in
    // flight, and `keepPreviousData` still showing the previous channel's transcript.
    loading || stale
  );
  // ⚠ DECLARED SECOND, BETWEEN THE PIN AND THE SCROLL-TARGET EFFECT. Effects run
  // in declaration order, so on a commit that both prepends a page and satisfies a
  // mention jump, the anchor restores position and the jump still wins.
  useLoadOlder(scrollerRef, {
    canLoad: hasOlder && !loading,
    loading: loadingOlder,
    // The row the reader's position is measured against: `rows` is ascending, so
    // the first is the row a prepended page pushes down.
    topRowId: rows[0]?.id ?? null,
    rowCount: rows.length,
    onLoad: onLoadOlder,
  });

  // The flash is DERIVED: a target flashes until its nonce is spent by the
  // timeout. No synchronous setState in the effect.
  const [spentNonce, setSpentNonce] = useState(0);
  const live = scrollTarget !== null && scrollTarget.nonce !== spentNonce;
  // ⚠ ANSWERED FROM `rows`, NOT FROM THE DOM — a PURE question about the data
  // this pane was handed, which is what lets the notice below exist without a
  // `set-state-in-effect` violation. `row.id` renders as `data-message-id`, so
  // this and the DOM query below ask the same question of the same key.
  const loaded = live && rows.some((row) => row.id === scrollTarget.messageId);
  const flashId = loaded ? scrollTarget.messageId : null;
  // ⚠ NOT while the read is still in flight: "older than the loaded history" is
  // a claim about a FINISHED transcript, and an unloaded one has no history yet.
  const missing = live && !loading && !loaded;

  // Runs POST-render, so when a mention click also swapped the view the new
  // transcript is already in the DOM. Smooth scroll unless reduced motion.
  useEffect(() => {
    // Wait for the rows rather than spending the nonce against an empty
    // transcript — a target dropped mid-load is a lost navigation.
    if (!scrollTarget || loading) return;
    const row = scrollerRef.current?.querySelector(
      `[data-message-id="${scrollTarget.messageId}"]`
    );
    if (row) {
      // A deliberate landing in history IS a reading position: the next message
      // must not drag the reader back out of it.
      releasePin();
      const reduceMotion =
        typeof window.matchMedia === "function" &&
        window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      row.scrollIntoView({
        behavior: reduceMotion ? "auto" : "smooth",
        block: "center",
      });
    }
    // ⚠ THE NONCE IS SPENT EITHER WAY. Spending it only on a HIT pinned the flash
    // state on that nonce forever, so the next click on the same message did
    // nothing.
    const timer = setTimeout(
      () => setSpentNonce(scrollTarget.nonce),
      row ? FLASH_MS : MISSING_NOTICE_MS
    );
    return () => clearTimeout(timer);
  }, [scrollTarget, loading, releasePin]);

  return (
    // ⚠ `contain: inline-size` IS WHAT MAKES THIS COLUMN CONTRIBUTE ZERO WIDTH TO ITS
    // PARENT, AND `min-w-0` ALONE NEVER DID (measured live 2026-09-06): `min-w-0` lifts
    // only a flex item's own automatic minimum, while the item still hands its full
    // min-content width up as its CONTRIBUTION. One 1343px fenced code line ran the
    // surface to 1809px in a 656px viewport and put the OPEN info column off-screen.
    // ⚠ NOT `overflow-x-hidden`: that would clip the composer's popovers.
    <section className="flex min-w-0 flex-1 flex-col [contain:inline-size]">
      <PaneHeader
        channelName={channelName}
        threadTitle={thread?.title ?? null}
        infoOpen={infoOpen}
        viewSelect={viewSelect}
        favorited={favorited}
        popOut={popOut}
        chrome={chrome}
        onToggleInfo={onToggleInfo}
        onToggleFavorite={onToggleFavorite}
        onExitThread={onExitThread}
      />
      {/* ⚠ THE AWAITING STRIP STOOD HERE AND IS DELETED (Samuel, 2026-08-22) —
          the ruling retired the whole INBOUND consent lane. `thread-consent.tsx`
          keeps only the outbound send box, below the scroller. */}
      {/* ⚠ THE SCROLLER OWNS THE TRANSCRIPT'S GUTTER, and it is the only thing
          that may (Samuel, 2026-08-19: the rows ran "a little too close" to the
          pane edge). The rows' own `-mx-2 … px-2` pair cancels out of the sum by
          design — it bleeds the flash tint 8px wider WITHOUT moving the text —
          which is why per-row margins are the wrong knob here. */}
      <div ref={scrollerRef} className="min-h-0 flex-1 overflow-y-auto px-8 py-5">
        {/* ⚠ INSIDE THE SCROLLER, ABOVE THE ROWS — beside the transcript it is
            about. Same placement rule the clip notes follow. */}
        {missing && (
          <p
            role="status"
            className="mb-3 rounded-[8px] border border-border-default bg-card-surface-subtle px-2.5 py-2 text-caption text-text-muted"
          >
            {SCROLL_TARGET_MISSING_NOTE}
          </p>
        )}
        {/* ⚠ ABOVE THE ROWS AND INSIDE THE SCROLLER, and **it reserves height
            while it stands**: `use-load-older.ts` restores the reading position
            by MEASURING the anchor row, so the band is absorbed by that
            measurement rather than jolting the transcript. ⚠ NO "you have reached
            the beginning" TWIN — the minimal-copy ruling (INVARIANTS §5). */}
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
            // ICON DOES: a second `useAgentsPanel` is a second peer poll. Absent
            // (the pop-out) renders no button, which is correct — that surface
            // has no thread cards either.
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
      {/* ⚠ TWO ACTIVITY LANES, MINE FIRST — `agent-activity.tsx` then
          `peer-activity.tsx`. Separate slots because they read different facts with
          opposite failure modes, and mine renders in CHANNEL view too while the
          peer row is thread-only. Neither reserves a blank band. */}
      {agentActivity}
      {peerActivity}
      <ChannelsV2Composer
        newThreadSignal={newThreadSignal}
        channelId={channelId}
        workspaceId={workspaceId}
        members={members}
        currentUserId={index.currentUserId}
        liveAgents={liveAgents}
        recentAgentIds={recentAgentIds}
        // ⚠ RR1's ANSWER, COMPUTED FROM THE THREAD ROW THIS PANE IS ALREADY RENDERING — an
        // unaddressed reply goes to the exchange's OTHER party, and the composer must not
        // re-derive that pair. `null` in channel view, where there is no exchange.
        threadOtherParty={threadOtherPartyOf(thread, members, index.currentUserId)}
        gate={gate}
        newAgent={newAgent}
        // ⚠ THE OPEN THREAD IS THE TARGET, and `null` is a real answer, not a
        // missing one: channel view starts a CHANNEL-LEVEL agent.
        openThreadId={thread?.id ?? null}
      />
    </section>
  );
}
