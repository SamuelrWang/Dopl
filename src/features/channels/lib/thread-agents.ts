/**
 * WHO IS WORKING IN THIS THREAD — the participant set, joined to the roster.
 *
 * A thread's participants arrive as identity references (`{kind, userId |
 * agentId}`) and nothing else: no handle, no status. The agent roster
 * (`useChannelAgents`) has both. This module is the join, kept pure because the
 * thing an operator wants to read off a thread card at a glance ("two agents
 * are in here, one is working") is exactly the thing that must not depend on
 * render order or a loaded cache.
 *
 * DEGRADES QUIETLY, in both directions:
 *  - A thread with no participant set (every legacy pair-gated thread) yields
 *    `[]` and the card shows NOTHING extra. It does not show "0 agents": an
 *    empty set here means "we don't know", and a zero is a claim.
 *  - A participant naming an agent this client hasn't loaded (dismissed in
 *    another era, a row from a channel we only partly read) stays in the list
 *    with `agent: null`. It is real membership; only its handle is unknown.
 */

import type { AgentStatus, ChannelAgent, ChannelThread } from "../types";
import { readThreadParticipants } from "./rooms";

/** One agent seated in a thread, resolved against the loaded roster. */
export interface ThreadAgentEntry {
  agentId: string;
  /** The roster row, or null when this client has not loaded that agent. */
  agent: ChannelAgent | null;
  /** The handle to render. Falls back to a neutral word, never an id. */
  handle: string;
  /** The lifecycle status, or null when unresolved. */
  status: AgentStatus | null;
  /** True when a session is working this agent right now (the live dot). */
  live: boolean;
}

/** The fallback shown for a participant whose agent row we never loaded. */
export const UNKNOWN_AGENT_HANDLE = "agent";

/**
 * The thread's AGENT participants, in participant order, deduped by agent id
 * (the same agent added twice is one seat, not two).
 *
 * Human participants are deliberately dropped: the card already carries the
 * opener's avatar and the channel header carries the roster, and the question
 * this row answers is which AGENTS are in the room.
 */
export function threadAgentEntries(
  thread: ChannelThread,
  agents: readonly ChannelAgent[]
): ThreadAgentEntry[] {
  const byId = new Map(agents.map((a) => [a.id, a]));
  const seen = new Set<string>();
  const entries: ThreadAgentEntry[] = [];
  for (const participant of readThreadParticipants(thread)) {
    if (participant.kind !== "agent") continue;
    const agentId = participant.agentId;
    if (typeof agentId !== "string" || agentId.length === 0) continue;
    if (seen.has(agentId)) continue;
    seen.add(agentId);
    const agent = byId.get(agentId) ?? null;
    entries.push({
      agentId,
      agent,
      handle: agent?.name ?? UNKNOWN_AGENT_HANDLE,
      status: agent?.status ?? null,
      live: agent?.status === "active",
    });
  }
  return entries;
}

/**
 * How the row admits it is not live. `channel_task_participants` is
 * deliberately outside the realtime publication (migration 20260731130000; see
 * the note at the top of `client/realtime.ts`), so this set only refreshes when
 * the thread list refetches — which a message event does and a silent join does
 * not. An agent can therefore be seated in a thread and missing from this row
 * until something happens in it.
 *
 * That is a caveat the row can either state or hide. It states it: an operator
 * who knows the list lags will re-read it, and one who was told nothing would
 * read a missing handle as "not in the thread". Copy rule: no em dashes.
 */
export const THREAD_AGENTS_FRESHNESS_NOTE =
  "Updates when the thread has activity.";

/**
 * The row's one-line title: who is in the thread, what they are doing, and how
 * current the answer is. Null when there is nothing to say, which is what keeps
 * a legacy thread's card exactly as it is today.
 */
export function threadAgentsLabel(entries: readonly ThreadAgentEntry[]): string | null {
  if (entries.length === 0) return null;
  const live = entries.filter((e) => e.live).length;
  const handles = entries.map((e) => `@${e.handle}`).join(", ");
  const working = live === 0 ? "" : ` ${live} working now.`;
  return `${handles} in this thread.${working} ${THREAD_AGENTS_FRESHNESS_NOTE}`;
}
