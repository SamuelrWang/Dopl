"use client";

/**
 * Channels v2 — CENTER COLUMN: breadcrumb header, the transcript and the
 * composer card.
 *
 * TWO views over one column (MAPPING.md § the center-pane state machine):
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
 */

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import type { MutationGate } from "@/shared/hooks/use-api-mutation";
import { Bookmark, ChevronRight, Hash, Info, Sparkles } from "lucide-react";
import { IconButton } from "./bits";
import { Transcript } from "./transcript";
import { ChannelsV2Composer } from "./composer";
import type { AuthorIndex, TranscriptRow } from "./view-model";
import type { ChannelMember, ChannelThread } from "../../types";

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
 * How close to the bottom still counts as being AT the bottom. A reader who has
 * drifted a line is still following the conversation; one who has scrolled up
 * to read history is not, and yanking them down is the classic chat bug.
 */
const STICK_SLACK_PX = 64;

/**
 * STICK TO BOTTOM — the behaviour the retired page had and this pane lost at
 * the cutover. A transcript that renders oldest-first and never scrolls opens
 * on the oldest message in the channel, which is the wrong end of every chat
 * surface ever built.
 *
 * THREE RULES, and the third is the one the old page got wrong:
 *
 *  1. A CHANNEL OR THREAD SWITCH LANDS AT THE BOTTOM. A new view has no reading
 *     position to preserve, so there is nothing to be polite about.
 *  2. NEW ROWS FOLLOW, while the reader is at the bottom.
 *  3. ⚠ A READER SCROLLED UP IS NEVER YANKED. The old page followed
 *     unconditionally, so a message arriving mid-scrollback threw the reader
 *     back to the end of the conversation. The near-bottom guard is one
 *     subtraction and is strictly better.
 *
 * ⚠ REFS, NOT STATE, AND THAT IS NOT A MICRO-OPTIMISATION.
 * `react-hooks/set-state-in-effect` is an ERROR in this tree; a pin held in
 * state would also re-render the whole transcript on every scroll event, to
 * decide something nothing renders.
 *
 * ⚠ THE PIN IS MEASURED ON THE USER'S OWN SCROLL AND NOWHERE ELSE — the same
 * rule the desktop's session stream keeps (`renderer/session/session.js`,
 * `bottomGap`). A row that GROWS after paint must not silently un-pin a reader
 * sitting at the bottom; only a scroll says "I moved away".
 *
 * Returns `release`, which the mention jump calls: a deliberate landing in
 * history is a reading position, and the next arriving message must not undo
 * it.
 */
function useStickToBottom(
  scrollerRef: RefObject<HTMLDivElement | null>,
  /** Channel + thread — the identity of the VIEW, so a switch is one change. */
  viewKey: string,
  rowCount: number
) {
  const pinned = useRef(true);

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const onScroll = () => {
      pinned.current =
        el.scrollHeight - el.scrollTop - el.clientHeight <= STICK_SLACK_PX;
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, [scrollerRef]);

  // Rule 1. Re-arms the pin as well as moving: the previous view's reading
  // position says nothing about this one.
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    pinned.current = true;
    el.scrollTop = el.scrollHeight;
  }, [scrollerRef, viewKey]);

  // Rules 2 and 3. ⚠ DECLARED BEFORE THE SCROLL-TARGET EFFECT BELOW, which is
  // load-bearing: effects run in declaration order, so on the commit where a
  // mention click both swapped the view and asked for a jump, the jump runs
  // LAST and wins. A stick-to-bottom that ran afterwards would land the reader
  // at the newest message they did not ask for.
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el || !pinned.current) return;
    el.scrollTop = el.scrollHeight;
  }, [scrollerRef, rowCount]);

  return useCallback(() => {
    pinned.current = false;
  }, []);
}

export function ChannelsV2MessagePane({
  channelId,
  workspaceId,
  channelName,
  thread,
  rows,
  index,
  members,
  loading,
  requested,
  scrollTarget,
  infoOpen,
  gate,
  manage,
  popOut,
  onToggleInfo,
  onExitThread,
  onOpenThread,
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
  /** Thread ids the viewer has been asked about and has not answered. */
  requested: ReadonlySet<string>;
  scrollTarget: ScrollTarget | null;
  infoOpen: boolean;
  /** The page's refetch coordinator, handed straight to the composer's writes. */
  gate: MutationGate;
  /**
   * The channel-management cluster (`channel-manage.tsx ›
   * ChannelsV2ManageActions`), injected as a SLOT rather than imported: it is
   * write-bearing and channel-scoped, and this file owns the chrome only.
   */
  manage?: ReactNode;
  /**
   * "Open as new window" (`pop-out.tsx › PopOutThreadButton`), a SLOT for the
   * same reason `manage` is: it needs the workspace segment, which this file
   * has no business knowing. THREAD VIEW ONLY — the channel view has no thread
   * to pop out — and it renders itself away outside the desktop shell (wiring
   * plan Phase 10).
   */
  popOut?: ReactNode;
  onToggleInfo: () => void;
  onExitThread: () => void;
  /** Set by an in-transcript thread card — the channel view's way IN. */
  onOpenThread: (id: string) => void;
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
        manage={manage}
        popOut={popOut}
        onToggleInfo={onToggleInfo}
        onExitThread={onExitThread}
      />
      <div ref={scrollerRef} className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
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
        {loading ? (
          <p role="status" aria-busy="true" className="sr-only">
            Loading transcript
          </p>
        ) : (
          <Transcript
            rows={rows}
            index={index}
            flashId={flashId}
            requested={requested}
            onOpenThread={onOpenThread}
          />
        )}
      </div>
      <ChannelsV2Composer
        channelId={channelId}
        workspaceId={workspaceId}
        members={members}
        currentUserId={index.currentUserId}
        gate={gate}
      />
    </section>
  );
}

function PaneHeader({
  channelName,
  threadTitle,
  infoOpen,
  manage,
  popOut,
  onToggleInfo,
  onExitThread,
}: {
  channelName: string;
  threadTitle: string | null;
  infoOpen: boolean;
  manage?: ReactNode;
  popOut?: ReactNode;
  onToggleInfo: () => void;
  onExitThread: () => void;
}) {
  return (
    <header className="flex h-[56px] shrink-0 items-center gap-1 border-b border-border-default px-4">
      <Hash size={14} className="shrink-0 text-text-muted" />
      <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-1">
        {threadTitle === null ? (
          <span className="truncate text-body font-semibold text-text-primary">
            {channelName}
          </span>
        ) : (
          <>
            <button
              type="button"
              onClick={onExitThread}
              className="truncate rounded-[7px] px-1 py-0.5 text-body text-text-secondary transition-colors hover:bg-surface-raised-1 hover:text-text-primary"
            >
              {channelName}
            </button>
            <ChevronRight size={12} className="shrink-0 text-text-disabled" />
            <span className="truncate text-body font-semibold text-text-primary">
              {threadTitle}
            </span>
          </>
        )}
      </nav>
      {/* Bookmarking a channel is a WRITE with no column behind it; the
          assistant lane is its own surface. Both ride later phases. */}
      <IconButton icon={Bookmark} label="Bookmark channel" size={14} className="h-6 w-6" />
      {/* THREAD VIEW ONLY — it pops out the open thread, and the channel view
          has none. Sits beside the crumb it acts on rather than in the
          channel-scoped cluster on the right (wiring plan Phase 10). */}
      {threadTitle !== null && popOut}
      <span className="flex-1" />
      {/* The channel-management cluster: settings, working folder, invite and
          the kebab. It carried over WHOLESALE from the retired page at the
          cutover (wiring plan Phase 12) and REPLACED an inert "More actions"
          placeholder — the kebab inside it is the real one. */}
      {manage}
      <IconButton icon={Sparkles} label="Ask the assistant" />
      <IconButton
        icon={Info}
        label="Channel info"
        active={infoOpen}
        onClick={onToggleInfo}
      />
    </header>
  );
}
