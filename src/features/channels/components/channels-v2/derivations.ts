"use client";

/**
 * Channels v2 — THE PAGE'S DERIVATIONS, as one hook: everything the three
 * columns render that is a pure function of what the read hooks returned.
 *
 * ⚠ SPLIT OUT OF `channels-v2-core.tsx` ON 2026-08-19, for the same reason and
 * on the same precedent as `live.ts` (the Phase 10 cap): that file was within a
 * handful of lines of the 500-line cap and the Favorites wiring did not fit.
 * Nothing inside changed in the move — the memo dependencies, the ordering
 * between them and every ⚠ note are carried over verbatim.
 *
 * ⚠ THIS IS A HOOK BECAUSE OF `useMemo`, AND NOTHING ELSE. It fetches nothing,
 * holds no state and calls no setter. The PURE functions it composes live in
 * `view-model.ts`, `view-model-rows.ts` and `view-model-requested.ts` and are
 * tested there without React; this file only decides what is recomputed when.
 * A derivation that needs a setter belongs in the core, not here.
 */

import { useMemo } from "react";
import { formatChannelTimestamp } from "@/shared/lib/format-time";
import { indexMembers } from "./view-model";
import { channelRows, threadRows } from "./view-model-rows";
import { sidebarThreads } from "./view-model-requested";
import type { AuthorIndex } from "./view-model";
import type { TranscriptRow } from "./view-model-rows";
import type {
  ChannelMember,
  ChannelMessage,
  ChannelThread,
} from "../../types";

export interface ChannelsV2Derivations {
  index: AuthorIndex;
  /** The open thread, or null — see the `openThreadId` note below. */
  openThread: ChannelThread | null;
  /** The threads the sidebar may nest under the open channel. */
  treeThreads: ChannelThread[];
  /** The center pane's rows — the thread's own transcript, or the channel's. */
  rows: TranscriptRow[];
}

/**
 * ⚠ THREE DERIVATIONS LEFT THIS HOOK ON 2026-08-22 (Samuel — the inbound consent
 * retirement). `requested`, `consentExempt` and `pendingAsks` all read the
 * viewer's consent inbox to answer "who is waiting on your answer", which is a
 * question the product no longer asks: the Decline / Launch agent pair, the
 * awaiting strip, the sidebar's `Clock` glyph and its per-channel ask badge are
 * all deleted. **The consent inbox is not a dependency of this hook any more** —
 * the outbound send box joins its own rows in `use-inline-consent.ts`, which is a
 * different question with a different answer.
 */
export function useChannelsV2Derivations({
  members,
  currentUserId,
  messages,
  threads,
  openThreadId,
}: {
  members: ChannelMember[];
  currentUserId: string;
  messages: ChannelMessage[];
  threads: ChannelThread[];
  /** The thread the operator asked for; resolved against `threads` below. */
  openThreadId: string | null;
}): ChannelsV2Derivations {
  const index = useMemo(
    () => indexMembers(members, currentUserId),
    [members, currentUserId]
  );
  // DERIVED, never stored: a thread id that is not in THIS channel's list is a
  // stale pick (channel switched, thread aged past the read's ceiling), and the
  // pane falls back to the channel view rather than rendering an empty thread.
  const openThread = openThreadId
    ? (threads.find((t) => t.id === openThreadId) ?? null)
    : null;
  // The 24h activity window, and nothing else — the "OR requested" arm went with
  // the inbound lane (`view-model-requested.ts › sidebarThreads` says why).
  const treeThreads = useMemo(() => sidebarThreads(threads), [threads]);

  const rows = useMemo(
    () =>
      openThread
        ? threadRows(messages, openThread.id, index, formatChannelTimestamp)
        : channelRows(messages, threads, index, formatChannelTimestamp),
    [messages, threads, openThread, index]
  );

  return { index, openThread, treeThreads, rows };
}
