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

import { useEffect, useRef, useState } from "react";
import type { MutationGate } from "@/shared/hooks/use-api-mutation";
import {
  Bookmark,
  ChevronRight,
  Hash,
  Info,
  MoreHorizontal,
  Sparkles,
} from "lucide-react";
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
  onToggleInfo: () => void;
  onExitThread: () => void;
  /** Set by an in-transcript thread card — the channel view's way IN. */
  onOpenThread: (id: string) => void;
}) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  // The flash is DERIVED: a target flashes until its nonce is marked spent by
  // the timeout. No synchronous setState in the effect — the render pass
  // already knows the flash is on the moment the target lands.
  const [spentNonce, setSpentNonce] = useState(0);
  const flashId =
    scrollTarget && scrollTarget.nonce !== spentNonce
      ? scrollTarget.messageId
      : null;

  // Runs POST-render, so when a mention click also swapped the view, the new
  // transcript is already in the DOM by the time we look the row up. Smooth
  // scroll unless the user asked for reduced motion; the flash fades on its own
  // via the row's colour transition.
  useEffect(() => {
    if (!scrollTarget) return;
    const row = scrollerRef.current?.querySelector(
      `[data-message-id="${scrollTarget.messageId}"]`
    );
    if (!row) return;
    const reduceMotion =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    row.scrollIntoView({
      behavior: reduceMotion ? "auto" : "smooth",
      block: "center",
    });
    const timer = setTimeout(() => setSpentNonce(scrollTarget.nonce), 1600);
    return () => clearTimeout(timer);
  }, [scrollTarget]);

  return (
    <section className="flex min-w-0 flex-1 flex-col">
      <PaneHeader
        channelName={channelName}
        threadTitle={thread?.title ?? null}
        infoOpen={infoOpen}
        onToggleInfo={onToggleInfo}
        onExitThread={onExitThread}
      />
      <div ref={scrollerRef} className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
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
  onToggleInfo,
  onExitThread,
}: {
  channelName: string;
  threadTitle: string | null;
  infoOpen: boolean;
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
      <span className="flex-1" />
      <IconButton icon={MoreHorizontal} label="More actions" />
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
