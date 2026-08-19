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
import {
  consentExemptThreadIds,
  requestedThreadIds,
  sidebarThreads,
} from "./view-model-requested";
import type { AuthorIndex } from "./view-model";
import type { TranscriptRow } from "./view-model-rows";
import type {
  ChannelConsentRequest,
  ChannelMember,
  ChannelMessage,
  ChannelThread,
} from "../../types";

export interface ChannelsV2Derivations {
  index: AuthorIndex;
  /** The open thread, or null — see the `openThreadId` note below. */
  openThread: ChannelThread | null;
  /** Thread ids the viewer has been asked about and has not answered. */
  requested: ReadonlySet<string>;
  /** Threads a pending consent request keeps reachable past the 24h window. */
  consentExempt: ReadonlySet<string>;
  /** The threads the sidebar may nest under the open channel. */
  treeThreads: ChannelThread[];
  /** The center pane's rows — the thread's own transcript, or the channel's. */
  rows: TranscriptRow[];
}

export function useChannelsV2Derivations({
  members,
  currentUserId,
  messages,
  threads,
  requests,
  openThreadId,
}: {
  members: ChannelMember[];
  currentUserId: string;
  messages: ChannelMessage[];
  threads: ChannelThread[];
  /** The viewer's OWN consent inbox, workspace-wide. */
  requests: ChannelConsentRequest[];
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
  // REQUESTED, derived from the viewer's OWN consent inbox joined to this
  // channel's transcript on the triggering seq (`view-model-requested.ts`). It
  // feeds three surfaces — the sidebar's admission rule, its Clock glyph, and
  // the card's `PendingChip` — from ONE derivation, so they cannot disagree.
  const requested = useMemo(
    () => requestedThreadIds(messages, requests),
    [messages, requests]
  );
  // ⚠ THE SECOND ARM, AND DELIBERATELY NOT `requested`: a pending inbound row
  // may legally carry no `message_seq`, names no thread, and so cannot earn a
  // Clock glyph — but it must still keep the threads it might be about
  // REACHABLE past the 24h window (`view-model-requested.ts`).
  const consentExempt = useMemo(
    () => consentExemptThreadIds(threads, requests),
    [threads, requests]
  );
  const treeThreads = useMemo(
    // `undefined` keeps the derivation's own `Date.now()` default.
    () => sidebarThreads(threads, requested, undefined, consentExempt),
    [threads, requested, consentExempt]
  );

  const rows = useMemo(
    () =>
      openThread
        ? threadRows(messages, openThread.id, index, formatChannelTimestamp)
        : channelRows(messages, threads, index, formatChannelTimestamp),
    [messages, threads, openThread, index]
  );

  return { index, openThread, requested, consentExempt, treeThreads, rows };
}
