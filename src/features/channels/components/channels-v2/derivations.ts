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
import { agentIndexFromKey, agentIndexKey, indexAgents, indexMembers } from "./view-model";
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
  agentSessions = null,
  peerSessions = null,
}: {
  members: ChannelMember[];
  currentUserId: string;
  messages: ChannelMessage[];
  threads: ChannelThread[];
  /** The thread the operator asked for; resolved against `threads` below. */
  openThreadId: string | null;
  /**
   * THIS MACHINE'S OWN AGENTS, for the names the transcript renders (2026-08-27).
   * ⚠ `null` IS "no desktop feed" (a plain browser, the pop-out) and is not an error — the index
   * then holds no agents and every agent row reads `#<id>`, exactly as before.
   */
  agentSessions?: ReadonlyArray<{
    agentId?: string | null;
    displayName?: string | null;
    description?: string | null;
  }> | null;
  /**
   * THE OTHER MEMBERS' AGENTS, from the server's peer projection (2026-08-31, Samuel's ruling;
   * `channel_sessions.display_name` via `use-agents-panel.ts › peerSessions`). Their `name` IS
   * the agent id (the handle column carries the instance id since multiplayer), so it keys the
   * same index the local feed fills — which is what lets the transcript render a PEER's
   * "Bug Reviewer" with no second lookup path. ⚠ Merged BELOW the local feed: for the
   * operator's own agents the local name is fresher than the last push.
   */
  peerSessions?: ReadonlyArray<{
    name?: string | null;
    displayName?: string | null;
  }> | null;
}): ChannelsV2Derivations {
  /**
   * ⚠ MEMOISED ON THE FEED'S IDENTITY CONTENT, NOT ON THE FEED (2026-08-28). Memoising on
   * `agentSessions` alone is what the 2026-08-27 rename wave shipped, and it is wrong for a
   * reason neither wave could see from its own side: **that array is paced by TELEMETRY and this
   * index holds only NAMES.**
   *
   * `main/session-summary.js › summariesDigest` is `JSON.stringify(list)` over rows that spread
   * `session-metrics.js › metrics`, which carries `lastActivityAt` — a field whose own comment
   * says it "moves on every dispatch" — plus `tokensSpent` and `contextUsed`. The quantization
   * that would damp that is on the SERVER wire (`session-telemetry.js`), never on this local IPC
   * push, and the push coalesces at `PUSH_COALESCE_MS` (200). So a single WORKING agent hands
   * this hook a brand-new array about five times a second.
   *
   * Every one of those minted a new `Map`, moved `index`, and rebuilt `rows` — and nothing
   * downstream absorbs it: neither `transcript.tsx` nor `message-markdown.tsx` memoises, so every
   * message in the channel re-ran `marked.lexer` plus both mention-index builds, five times a
   * second, for as long as an agent was working. ⚠ THE IDLE CASE HID IT: an empty feed returns
   * the shared `view-model.ts › NO_AGENTS`, so `index` never moved and the churn appeared only
   * while the operator was watching an agent run.
   *
   * ⚠ THE MAP IS BUILT FROM THE KEY, WHICH IS WHAT MAKES ITS IDENTITY A FUNCTION OF ITS CONTENT.
   * A ref-held cache would do the same thing and is forbidden outright — `react-hooks/refs`, "cannot
   * access refs during render" — so the round trip (`view-model.ts › agentIndexKey` /
   * `› agentIndexFromKey`) is the honest form: two memos, no render-phase mutation, and the second
   * one genuinely does not re-run when the key is unchanged.
   *
   * ⚠ THE RENAME STILL LANDS WITHOUT A REFETCH, which is the property the original memo existed
   * for and the one this must not cost: a rename or a describe MOVES the key; a token count does
   * not.
   */
  const agentKey = useMemo(
    () =>
      agentIndexKey(
        indexAgents([
          // ⚠ PEERS FIRST, OWN LAST — `indexAgents` is last-write-wins per id, and the local
          // feed's name for the operator's own agent is fresher than its last server push.
          ...(peerSessions ?? []).map((p) => ({
            agentId: p.name,
            displayName: p.displayName,
          })),
          ...(agentSessions ?? []),
        ])
      ),
    [agentSessions, peerSessions]
  );
  const agents = useMemo(() => agentIndexFromKey(agentKey), [agentKey]);
  const index = useMemo(
    () => indexMembers(members, currentUserId, agents),
    [members, currentUserId, agents]
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
