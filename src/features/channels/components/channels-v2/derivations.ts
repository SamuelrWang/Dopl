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
// ⚠ `RESILIENCE_WINDOW_MS` IS DELIBERATELY NOT IMPORTED HERE ANY MORE (2026-09-06):
// the author-stickiness rule below has no time window, and the constant still bounds
// the arms that ask a FRESHNESS question rather than a habit one.
import { recentAgentsAddressedBy } from "../../lib/agent-post-stamp";
import { channelRows, threadRows } from "./view-model-rows";
import { unfoldedMessages, withArtifactCards } from "./view-model-artifacts";
import { sidebarThreads } from "./view-model-requested";
import type { AuthorIndex } from "./view-model";
import type { TranscriptRow } from "./view-model-rows";
import type {
  ChannelMember,
  ChannelMessage,
  ChannelReadEntry,
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
  /** RR3 arm 3's input for the composer's recipient line: the agents that have
   *  posted in this room lately, most recent first. */
  recentAgentIds: string[];
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
  entries = null,
  threads,
  openThreadId,
  agentSessions = null,
  peerSessions = null,
}: {
  members: ChannelMember[];
  currentUserId: string;
  messages: ChannelMessage[];
  /**
   * THE PAGE'S FOLDED RENDERING, when the read produced one (artifacts #1220 §4).
   *
   * ⚠ **`null` IS THE ORDINARY CASE AND MEANS "NOTHING HERE IS IN AN ARTIFACT"**,
   * never "this build cannot fold". The envelope is ADDITIVE: `messages` stays
   * complete and authoritative, and a host that never passes this renders exactly
   * what it rendered before artifacts existed. Dropping `messages` is the breaking
   * flip, and it is a human decision that has not been made.
   *
   * 🔒 **`entries` MUST BE TOTAL OVER THE `messages` ARRAY IT IS PASSED BESIDE.**
   * Every message in that array is either a `message` arm here or a member of an
   * `artifact` arm here — never neither. It is not a nicety: the rows below are
   * built from `unfoldedMessages(entries)` ALONE when this is non-null, so a
   * message the envelope does not account for is a row the reader never sees, and
   * nothing fails while it happens.
   *
   * ⚠ **THE SERVER GUARANTEES IT PER PAGE, WHICH IS NOT THE SAME PROMISE.**
   * `readTranscript` folds the page it just read; the transcript renders that page
   * plus every scrolled-back history page plus every optimistic patch. Passing one
   * page's envelope beside the merged array is the hazard, and
   * `lib/message-window.ts › mergeEntries` is the ONE place allowed to build this
   * value for a channel view — every merge and every patch above it exists to
   * preserve this paragraph.
   */
  entries?: ChannelReadEntry[] | null;
  threads: ChannelThread[];
  /** The thread the operator asked for; resolved against `threads` below. */
  openThreadId: string | null;
  /**
   * THIS MACHINE'S OWN AGENTS, for the names the transcript renders (2026-08-27).
   * ⚠ `null` IS "no desktop feed" (a plain browser, the pop-out) and is not an error — the index
   * then holds no agents and every agent row reads `#<id>`, exactly as before.
   *
   * ⚠ **`state` IS READ, AND ONLY FOR "HAS IT ENDED"** (2026-09-06). This feed is live sessions
   * PLUS seven days of RETAINED ENDED ones (`main/session-summary.js › reportList`), which is why
   * a dead agent's tag used to tint blue as though it could still be reached. `indexAgents` turns
   * it into the terminal `AgentIdentity.ended` flag; nothing here filters the feed, because the
   * ended rows are exactly what ATTRIBUTION needs.
   */
  agentSessions?: ReadonlyArray<{
    agentId?: string | null;
    displayName?: string | null;
    description?: string | null;
    state?: string | null;
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
          // ⚠ AND SO IS ITS LIVENESS: a peer row carries no `state` (the projection drops ended
          // rows before they reach the wire), so an agent this machine reports as ENDED settles
          // as ended even if a stale projection still listed it.
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

  // ⚠ **THE THREAD VIEW NEVER FOLDS, AND IT DOES NOT DECIDE THAT HERE.** The
  // server already refuses to fold a read that NAMES messages
  // (`server/service-artifacts.ts › readNamesMessages`: a `thread` query is a
  // named subset), so a thread page arrives with `entries === null` and this arm
  // is the same code it always was. One answer to "does this read fold", on the
  // server, is the whole point of that pin — a second one here could disagree.
  const rows = useMemo(
    () =>
      openThread
        ? threadRows(messages, openThread.id, index, formatChannelTimestamp)
        : entries
          ? // ⚠ THE ORDINARY ROWS COME FROM THE UNFOLDED ARMS ONLY — handing the
            // full page to `channelRows` would draw every folded message again,
            // underneath the card that folded it.
            withArtifactCards(
              channelRows(
                unfoldedMessages(entries),
                threads,
                index,
                formatChannelTimestamp
              ),
              entries,
              messages,
              index,
              formatChannelTimestamp
            )
          : channelRows(messages, threads, index, formatChannelTimestamp),
    [messages, entries, threads, openThread, index]
  );

  /**
   * **WHO THIS PERSON LAST ADDRESSED — RR3 ARM 3's INPUT, DERIVED ONCE FOR THE
   * PANE** (2026-09-04).
   *
   * ⚠ **IT WAS "who spoke here last" FOR ONE DAY, AND THAT WAS THE BUG** (Samuel):
   * an agent addressing another agent re-pointed the room's default responder, so
   * the recipient line wandered with nothing the operator did. The rule is
   * stickiness per PERSON now — the agent YOU last tagged — and it reads only
   * rows this user authored whose tag the user typed themselves
   * (`lib/agent-post-stamp.ts › isAuthorTypedAgentTag`: recipients present,
   * `wake_reason` absent, so the server's OWN picks are not evidence).
   *
   * ⚠ **THE SAME FUNCTION THE SERVER'S ARM RUNS**
   * (`lib/agent-post-stamp.ts › recentAgentsAddressedBy`), over the transcript
   * this page has already read rather than a second fetch. The server asks it of a
   * bounded `channel_messages` query keyed on the same author; both sort by `seq`
   * and both drop threaded rows, so the composer's recipient line names the agent
   * the stored verdict will name.
   *
   * ⚠ **THERE IS NO WINDOW, AND THAT IS THE 2026-09-06 FIX** (Samuel's ruling).
   * This passed `RESILIENCE_WINDOW_MS` until then, so fifteen minutes after you
   * tagged an agent the line stopped naming it and quietly moved to whichever
   * session launched last — the operator's default wandering on a clock instead
   * of on something they did. Author stickiness has no expiry: the agent you last
   * addressed holds until you address a different LIVE agent, or that agent ends
   * and drops out of the candidate set (`lib/agent-mentions.ts ›
   * resolveDefaultResponder` intersects, so an ended id cannot eat the pick).
   * ⚠ **THE SERVER DROPPED THE SAME ARGUMENT IN THE SAME BREATH**
   * (`server/service-wake-verdict-resilience.ts › recentRoomAgents`) — the two
   * halves must bound the walk identically or the line predicts one agent and the
   * stored verdict names another, which is the defect the parity suite exists for.
   * ⚠ **THE CLOCK IS THE HELPER'S OWN DEFAULT, NOT A READ AT THIS CALL SITE** —
   * a component may not read `Date.now()` during render and a model may, which
   * is the arrangement `agents-model.ts` is already in. With no window nothing
   * here reads it at all, and the bound that remains is the transcript this pane
   * holds.
   *
   * ⚠ **IT IS NOT SCOPED TO THE OPEN THREAD**, on purpose: a thread composer
   * predicts RR1, which needs none of this, and the helper drops threaded rows
   * itself.
   */
  const recentAgentIds = useMemo(
    () => recentAgentsAddressedBy(currentUserId, messages),
    [currentUserId, messages]
  );

  return { index, openThread, treeThreads, rows, recentAgentIds };
}
