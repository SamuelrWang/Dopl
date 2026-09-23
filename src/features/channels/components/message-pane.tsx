"use client";

/**
 * Channels center column: header, transcript, composer. Two views over one column (INVARIANTS §5):
 * channel view (`thread === null`) and thread view, whose channel crumb is the way back.
 * `chrome="window"` is the pop-out thread window (`thread-window.tsx`), so one pane owns the scroll rules.
 */

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { MutationGate } from "@/shared/hooks/use-api-mutation";
import { PaneHeader } from "./message-pane-header";
import { useStickToBottom } from "./use-stick-to-bottom";
import { useLoadOlder } from "./use-load-older";
import { Transcript } from "./transcript";
import {
  TRANSCRIPT_FILTER_ALL,
  TranscriptFilterSelect,
  filterTranscriptRows,
  resolveTranscriptFilter,
  transcriptFilterAgents,
  transcriptFilterViewKey,
  type TranscriptFilter,
} from "./transcript-filter";
import { ChannelsComposer } from "./composer";
import { FadeSwap } from "./fade-swap";
import { ThreadSendBox } from "./thread-consent";
import type { AgentLaunchControls } from "./use-agents-panel";
import {
  threadOtherPartyOf,
  type LiveAgentSession,
} from "../lib/draft-recipients";
import type { AuthorIndex } from "./view-model";
import type { TranscriptRow } from "./view-model-rows";
import type {
  ChannelConsentRequest,
  ChannelMember,
  ChannelThread,
} from "../types";

/** `nonce` exists so clicking the same mention twice re-scrolls. */
export interface ScrollTarget {
  messageId: string;
  nonce: number;
}

/** Shown when the target is not in the loaded transcript; promises no remedy, since the pane has none (INVARIANTS §9). */
export const SCROLL_TARGET_MISSING_NOTE =
  "That message is older than the loaded history, so the transcript did not move.";

/** How long the flash tint stands on a found row. */
const FLASH_MS = 1600;

/** How long the missing-target note stands — longer than the flash, because it is read. */
const MISSING_NOTICE_MS = 6000;

/** Stable default: the composer's recipient line memoizes on it. */
const EMPTY_RECENT_AGENT_IDS: readonly string[] = [];

/** Defaults for callbacks only the `"page"` chrome fires. */
const DECIDE_OUTBOUND_NOOP = () => {};
const NOOP = () => {};

export function ChannelsMessagePane({
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
  onJumpToSeq,
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
  /** Agents that posted here lately, newest first — the composer's RR3 input, derived once per page. */
  recentAgentIds?: readonly string[];
  index: AuthorIndex;
  members: ChannelMember[];
  loading: boolean;
  /** Rows are the previous channel's placeholder (`use-channel-messages.ts › stale`); gates the scroll
   *  rules, since `loading` is false while `keepPreviousData` shows old rows. */
  stale?: boolean;
  /** The open thread's pending outbound review (my agent's draft awaiting my Send), or null. */
  outboundAsk?: ChannelConsentRequest | null;
  outboundBusy?: boolean;
  onDecideOutbound?: (id: string, decision: "allow" | "deny") => void;
  scrollTarget: ScrollTarget | null;
  /** Nonced ask from the Threads tab to open the composer's new-thread dialog. */
  newThreadSignal?: number;
  infoOpen?: boolean;
  /** The web's view dropdown; replaces the info toggle in `PaneHeader`. */
  viewSelect?: ReactNode;
  /** `"page"` chrome only — the viewer favourited this channel (thread view too; no per-thread favourite). */
  favorited?: boolean;
  gate: MutationGate;
  /** Every member's live agent sessions, for the composer. Handed down: a second
   *  `use-channel-agent-sessions.ts` mount is a second poll. */
  liveAgents?: readonly LiveAgentSession[];
  /** Launch controls for the composer's New Agent icon, handed down (a second `useAgentsPanel` is a
   *  second peer poll); absent renders no button. */
  newAgent?: AgentLaunchControls;
  /** Thread-view "Open as new window" slot (`pop-out.tsx › PopOutThreadButton`). */
  popOut?: ReactNode;
  /** My agents mid-turn, drawn at the end of the composer's recipient line. */
  agentActivity?: ReactNode;
  /** Peer agents working (`peer-activity.tsx › PeerActivityRow`), between the send box and the composer. */
  peerActivity?: ReactNode;
  /** `"window"` is the pop-out thread window: no info panel, no sidebar. */
  chrome?: "page" | "window";
  onToggleInfo?: () => void;
  onToggleFavorite?: () => void;
  onExitThread?: () => void;
  /** An agent sender pill's way into the agent pane; absent (pop-out) leaves pills inert. */
  onOpenAgent?: (agentId: string) => void;
  /** Absent renders no option buttons on escalation cards (never disabled ones). */
  onAnswerEscalation?: (escalationMessageId: string, optionIndex: number) => void;
  answerBusy?: boolean;
  onOpenThread?: (id: string) => void;
  /** Jump to a cited message by seq; the host resolves it so there is one resolver. Absent renders
   *  citations as plain text. */
  onJumpToSeq?: (seq: number) => void;
  /** Scroll-up paging from `use-channel-messages.ts`, handed down; the defaults are inert. */
  hasOlder?: boolean;
  loadingOlder?: boolean;
  onLoadOlder?: () => void;
}) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  // Declared first: its effects must run before the scroll-target effect, so a
  // mention jump is never overwritten by a stick-to-bottom in the same commit.
  const releasePin = useStickToBottom(
    scrollerRef,
    `${channelId}:${thread?.id ?? ""}`,
    rows.length,
    // Newest row (`rows` is ascending); the pin smooth-scrolls to its start.
    rows[rows.length - 1]?.id ?? null,
    // Rows on screen are not this view's yet (`use-stick-to-bottom.ts` rule 1).
    loading || stale
  );
  // Declared between the pin and the scroll-target effect: on a commit that prepends
  // a page and satisfies a jump, the anchor restores position and the jump still wins.
  useLoadOlder(scrollerRef, {
    canLoad: hasOlder && !loading,
    loading: loadingOlder,
    // `rows` is ascending, so the first is the row a prepended page pushes down.
    topRowId: rows[0]?.id ?? null,
    rowCount: rows.length,
    onLoad: onLoadOlder,
  });

  // Keyed by channel: agent ids don't carry across rooms. Component state, never
  // localStorage — a transcript must not open days later already filtered.
  const [filterByChannel, setFilterByChannel] = useState<
    Readonly<Record<string, TranscriptFilter>>
  >({});
  const filterAgents = useMemo(
    () => transcriptFilterAgents(rows, index),
    [rows, index]
  );
  // The shared `all` constant, never a literal: this is a `useMemo` key below.
  const stored = filterByChannel[channelId] ?? TRANSCRIPT_FILTER_ALL;
  // Memoised: pruning a paged-out agent mints a new object, which would re-filter every render.
  const filter = useMemo(
    () => resolveTranscriptFilter(stored, filterAgents),
    [stored, filterAgents]
  );
  /** Only `Transcript` sees the filtered rows; the pin, paging and scroll target use full `rows`. */
  const visibleRows = useMemo(
    () => filterTranscriptRows(rows, index, filter),
    [rows, index, filter]
  );

  // Citation ceiling: what the pane holds (`rows`, not `visibleRows`); null when empty.
  const newestSeq = rows.length > 0 ? (rows[rows.length - 1]?.seq ?? null) : null;

  // The flash is derived: a target flashes until the timeout spends its nonce.
  const [spentNonce, setSpentNonce] = useState(0);
  const live = scrollTarget !== null && scrollTarget.nonce !== spentNonce;
  // Answered from `rows`, not the DOM, so the notice needs no setState in an effect.
  const loaded = live && rows.some((row) => row.id === scrollTarget.messageId);
  const flashId = loaded ? scrollTarget.messageId : null;
  // Not while loading: "older than the loaded history" needs a finished transcript.
  const missing = live && !loading && !loaded;

  // Post-render, so a view swap's new transcript is already in the DOM.
  useEffect(() => {
    // Spending the nonce against an unloaded transcript would lose the navigation.
    if (!scrollTarget || loading) return;
    const row = scrollerRef.current?.querySelector(
      `[data-message-id="${scrollTarget.messageId}"]`
    );
    if (row) {
      // A deliberate landing in history is a reading position; unpin so the next
      // message does not drag the reader back out of it.
      releasePin();
      const reduceMotion =
        typeof window.matchMedia === "function" &&
        window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      row.scrollIntoView({
        behavior: reduceMotion ? "auto" : "smooth",
        block: "center",
      });
    }
    // Spent on hit or miss, else a repeat click on the same message does nothing.
    const timer = setTimeout(
      () => setSpentNonce(scrollTarget.nonce),
      row ? FLASH_MS : MISSING_NOTICE_MS
    );
    return () => clearTimeout(timer);
  }, [scrollTarget, loading, releasePin]);

  return (
    // `contain: inline-size` stops wide content (a long code line) widening the column;
    // `min-w-0` alone does not. Not `overflow-x-hidden`: it would clip composer popovers.
    <section className="flex min-w-0 flex-1 flex-col [contain:inline-size]">
      <PaneHeader
        channelName={channelName}
        threadTitle={thread?.title ?? null}
        infoOpen={infoOpen}
        viewSelect={viewSelect}
        transcriptFilter={
          // No agents loaded: All and People name the same set, so no control.
          filterAgents.length === 0 ? undefined : (
            <TranscriptFilterSelect
              value={filter}
              agents={filterAgents}
              onChange={(next) =>
                setFilterByChannel((prev) => ({ ...prev, [channelId]: next }))
              }
            />
          )
        }
        favorited={favorited}
        popOut={popOut}
        chrome={chrome}
        onToggleInfo={onToggleInfo}
        onToggleFavorite={onToggleFavorite}
        onExitThread={onExitThread}
      />
      {/* The scroller owns the transcript's gutter; rows' `-mx-2 px-2` only bleeds the flash tint. */}
      <div ref={scrollerRef} className="min-h-0 flex-1 overflow-y-auto px-8 py-5">
        {missing && (
          <p
            role="status"
            className="mb-3 rounded-[8px] border border-border-default bg-card-surface-subtle px-2.5 py-2 text-caption text-text-muted"
          >
            {SCROLL_TARGET_MISSING_NOTE}
          </p>
        )}
        {/* Inside the scroller: `use-load-older.ts` measures the anchor row, so this band is absorbed. */}
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
          /* Fades on filter change only (`transcriptFilterViewKey`); wraps the transcript, not the
             scroller, so paging and the pin are untouched. */
          <FadeSwap viewKey={transcriptFilterViewKey(channelId, filter)}>
          <Transcript
            rows={visibleRows}
            index={index}
            flashId={flashId}
            canLaunchAgent={newAgent?.canLaunch ?? false}
            launchBusy={newAgent?.launchBusy ?? false}
            onLaunchAgent={(id) => void newAgent?.launchAgent(id)}
            onOpenAgent={onOpenAgent}
            onAnswerEscalation={onAnswerEscalation}
            answerBusy={answerBusy}
            onOpenThread={onOpenThread}
            newestSeq={newestSeq}
            onJumpToSeq={onJumpToSeq}
          />
          </FadeSwap>
        )}
      </div>
      <ThreadSendBox
        thread={thread}
        outboundAsk={outboundAsk}
        busy={outboundBusy}
        onDecide={onDecideOutbound}
      />
      {peerActivity}
      <ChannelsComposer
        working={agentActivity}
        newThreadSignal={newThreadSignal}
        channelId={channelId}
        workspaceId={workspaceId}
        members={members}
        currentUserId={index.currentUserId}
        liveAgents={liveAgents}
        recentAgentIds={recentAgentIds}
        // RR1: an unaddressed thread reply goes to the exchange's other party; `null` in channel view.
        threadOtherParty={threadOtherPartyOf(thread, members, index.currentUserId)}
        gate={gate}
        newAgent={newAgent}
        // `null` is a real answer: channel view starts a channel-level agent.
        openThreadId={thread?.id ?? null}
      />
    </section>
  );
}
