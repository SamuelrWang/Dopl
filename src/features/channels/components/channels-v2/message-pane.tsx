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
import { Bookmark, ChevronRight, Hash, Info } from "lucide-react";
import { IconButton } from "./bits";
import { useStickToBottom } from "./use-stick-to-bottom";
import { Transcript } from "./transcript";
import { ChannelsV2Composer } from "./composer";
import { ThreadAwaitingStrip, ThreadSendBox } from "./thread-consent";
import type { AgentLaunchControls } from "./use-agents-panel";
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
 * The default for the three callbacks only the `"page"` chrome can fire. The
 * pop-out window has no info panel to toggle, no channel view to return to and
 * no thread cards in its rows, so it hands over none of them.
 */
const DECIDE_NOOP = () => {};
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
  requested,
  onDecideThread = DECIDE_NOOP,
  outboundAsk = null,
  outboundBusy = false,
  onDecideOutbound = DECIDE_OUTBOUND_NOOP,
  scrollTarget,
  infoOpen = false,
  favorited = false,
  gate,
  newAgent,
  popOut,
  peerActivity,
  chrome = "page",
  onToggleInfo = NOOP,
  onToggleFavorite = NOOP,
  onExitThread = NOOP,
  onOpenThread = NOOP,
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
  /** Inline decision from the transcript's request card (Samuel, 2026-08-20). */
  onDecideThread?: (threadId: string, decision: "allow" | "deny") => void;
  /** The OPEN thread's pending outbound review (my agent's draft awaiting my
   *  Send), or null. Caller joins it — `pendingOutboundByThread`. */
  outboundAsk?: ChannelConsentRequest | null;
  outboundBusy?: boolean;
  onDecideOutbound?: (id: string, decision: "allow" | "deny") => void;
  scrollTarget: ScrollTarget | null;
  /** `"page"` chrome only — the info toggle's pressed state. */
  infoOpen?: boolean;
  /** `"page"` chrome only — the viewer has favourited THIS CHANNEL
   *  (`Channel.myFavoritedAt != null`, computed by the caller). Drives the
   *  bookmark's fill and its `aria-pressed`. */
  favorited?: boolean;
  /** The page's refetch coordinator, handed straight to the composer's writes. */
  gate: MutationGate;
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
  peerActivity?: ReactNode;
  /** Which header this pane wears — see the file docblock. */
  chrome?: "page" | "window";
  /** `"page"` chrome only. */
  onToggleInfo?: () => void;
  /** `"page"` chrome only — flips the viewer's favourite on this channel. */
  onToggleFavorite?: () => void;
  /** `"page"` chrome only — the channel crumb is the way back out of a thread. */
  onExitThread?: () => void;
  /** Set by an in-transcript thread card — the channel view's way IN. */
  onOpenThread?: (id: string) => void;
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
        favorited={favorited}
        popOut={popOut}
        chrome={chrome}
        onToggleInfo={onToggleInfo}
        onToggleFavorite={onToggleFavorite}
        onExitThread={onExitThread}
      />
      {/* Both thread consent surfaces live in `thread-consent.tsx`. */}
      <ThreadAwaitingStrip
        thread={thread}
        requested={requested}
        onDecideThread={onDecideThread}
      />
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
            onDecideThread={onDecideThread}
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
      {peerActivity}
      <ChannelsV2Composer
        channelId={channelId}
        workspaceId={workspaceId}
        members={members}
        currentUserId={index.currentUserId}
        gate={gate}
        newAgent={newAgent}
        // ⚠ THE OPEN THREAD IS THE TARGET, and `null` is a real answer rather
        // than a missing one: channel view starts a CHANNEL-LEVEL agent.
        openThreadId={thread?.id ?? null}
      />
    </section>
  );
}

function PaneHeader({
  channelName,
  threadTitle,
  infoOpen,
  favorited,
  popOut,
  chrome,
  onToggleInfo,
  onToggleFavorite,
  onExitThread,
}: {
  channelName: string;
  threadTitle: string | null;
  infoOpen: boolean;
  favorited: boolean;
  popOut?: ReactNode;
  chrome: "page" | "window";
  onToggleInfo: () => void;
  onToggleFavorite: () => void;
  onExitThread: () => void;
}) {
  // THE POP-OUT WINDOW'S HEADER: the crumb reduced to the thread's own title,
  // and nothing else. Every control the page header carries acts on something
  // this window does not have.
  if (chrome === "window") {
    return (
      <header className="flex h-[56px] shrink-0 items-center gap-1.5 border-b border-border-default px-4">
        <Hash size={14} className="shrink-0 text-text-muted" />
        <h1 className="truncate text-body font-semibold text-text-primary">
          {threadTitle ?? channelName}
        </h1>
      </header>
    );
  }

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
      {/* THE FAVOURITE TOGGLE. Stays with the crumb because it acts on what the
          crumb NAMES; the right-hand cluster acts on the pane.

          ⚠ THE LABEL NAMES THE CHANNEL, matching the knowledge card's wording
          family exactly (`knowledge-v2/home/base-card.tsx`: "Bookmark {name}" /
          "Remove bookmark from {name}") — one save affordance across the app
          means one sentence for it, and a screen-reader user in a thread needs
          the label to say WHICH thing gets bookmarked, since the crumb reads
          two. `aria-pressed` and the fill both come off the same boolean. */}
      <IconButton
        icon={Bookmark}
        label={
          favorited
            ? `Remove bookmark from ${channelName}`
            : `Bookmark ${channelName}`
        }
        size={14}
        className="h-6 w-6"
        active={favorited}
        filled={favorited}
        onClick={onToggleFavorite}
      />
      <span className="flex-1" />
      {/* THREAD VIEW ONLY — it pops out the open thread, and the channel view
          has none. Immediately LEFT of the info toggle, same `IconButton` face
          (Samuel, 2026-08-19); it was beside the crumb until then. */}
      {threadTitle !== null && popOut}
      <IconButton
        icon={Info}
        label="Channel info"
        active={infoOpen}
        onClick={onToggleInfo}
      />
    </header>
  );
}
