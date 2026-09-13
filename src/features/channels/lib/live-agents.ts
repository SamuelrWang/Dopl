/**
 * **WHICH AGENTS EXIST TO BE ADDRESSED ON A CHANNEL SURFACE** — the @-picker's,
 * the recipient line's and the tint's ONE candidate set, as a content key
 * (2026-09-13).
 *
 * ⚠ **ITS OWN FILE ON §1's SEAM.** `lib/draft-recipients.ts` answers *who a
 * DRAFT would reach* and moves when the RR rules move; this answers *which agents
 * are live here* and moves when a SOURCE of that fact changes — which is what
 * this file is: the poll and the desktop's own feed, reconciled once.
 */

import type { LiveAgentSession } from "./draft-recipients";

/**
 * A row of THIS MACHINE'S OWN session feed, widened locally rather than imported
 * (`spa-bridge.ts › DesktopSessionSummary` is the DESKTOP's to widen — the rule
 * `view-model.ts › indexAgents` follows).
 */
export interface OwnAgentSessionRow {
  channelId?: string | null;
  /** The minted instance id. ⚠ A legacy main reports only `name`, and that is
   *  what the peer projection's `name` column carries too. */
  agentId?: string | null;
  name?: string | null;
  displayName?: string | null;
  state?: string | null;
}

/** ⚠ ONE SHARED EMPTY INSTANCE, so an empty key is referentially stable across
 *  every render that produces one. */
const NO_LIVE_AGENTS: readonly LiveAgentSession[] = [];

const AGENT_KEY_FIELD_SEP = "\u0000";
const AGENT_KEY_ROW_SEP = "\u001f";

/**
 * **EVERY LIVE AGENT THIS SURFACE CAN ADDRESS, AS A CONTENT KEY — the peer
 * projection UNION this machine's own feed** (2026-09-13, Samuel's *"when I launch
 * an agent … I have to wait a minute"*).
 *
 * ⚠ **THE UNION IS THE FIX AND THE PROJECTION ALONE WAS THE BUG.** The @-picker's
 * candidates were `use-agents-panel.ts › peerSessions` and nothing else — an HTTP
 * read of `channel_sessions`, which is UNPUBLISHED (INVARIANTS §7) and therefore
 * POLLED at `PEER_SESSIONS_POLL_MS` (30 s). An agent the operator has just
 * launched is spawn-idle by ruling (INVARIANTS §5 — nothing on that lane sends a
 * turn), so it rings no `channel_messages` doorbell, and the launcher's own
 * `void refetch()` fires BEFORE main's push has landed the row — it re-reads the
 * old set and RESTARTS the interval. The operator therefore waited a full poll
 * period, and two whenever the push landed after that tick. The machine that
 * spawned the agent knew about it within `session-summary.js › PUSH_COALESCE_MS`
 * (200 ms) the whole time; it was simply not asked.
 *
 * ⚠ **NOT A RETURN TO "THIS MACHINE'S OWN AGENTS" (the 2026-09-02 widening,
 * Samuel's ruling).** The peer projection is still the base and is still what
 * makes tagging work off-desktop; the own feed is ADDED in front of the poll it
 * is faster than. A browser hands `null` and this answers exactly what it did.
 *
 * ⚠ **DEDUPED BY AGENT ID, AND THAT IS LOAD-BEARING RATHER THAN TIDY.** Once the
 * push lands, the operator's own agent is in BOTH sets — and
 * `lib/agent-mentions.ts` MINTS a suffix per candidate, so a duplicate would
 * offer one agent as `@coder` AND `@coder-1`, the second of which reaches
 * nothing. Peers keep their order (`Map.set` on a present key does not move it)
 * and own-only agents append, which keeps members-before-agents and the
 * shortlist's cap behaving as they did.
 *
 * ⚠ **AN ENDED OWN ROW IS DROPPED.** That feed carries seven days of retained
 * ended sessions (`main/session-summary.js › reportList`), which is why
 * `view-model.ts › indexAgents` reads `state` at all; offering one would be a
 * handle that wakes nobody. The peer projection needs no such filter — an ended
 * row never reaches the wire (`main/session-state-push.js › liveForWire`).
 *
 * ⚠ **A STRING, NOT THE ARRAY, FOR THE REASON `view-model.ts › agentIndexKey`
 * IS ONE.** The own feed is paced by TELEMETRY — a single working agent hands the
 * renderer a brand-new array about five times a second — so a merged array built
 * per render would re-derive the whole @-shortlist and the tint index at that
 * rate. Key in, array out ({@link liveAgentsFromKey}), two memos, no
 * render-phase cache.
 */
export function liveAgentsKey(
  peers: readonly LiveAgentSession[],
  own: readonly OwnAgentSessionRow[] | null,
  channelId: string
): string {
  const byId = new Map<string, string>();
  for (const peer of peers) {
    const id = peer.name.trim();
    if (id) byId.set(id, peer.displayName ?? "");
  }
  for (const row of own ?? []) {
    if (!channelId || row.channelId !== channelId) continue;
    if (row.state === "ended") continue;
    const id = (row.agentId ?? row.name ?? "").trim();
    if (!id) continue;
    // ⚠ `||` AND NOT `??` ON THE FALLBACK: the local feed is the fresher name for
    // the operator's own agent (`derivations.ts` argues the same precedence), but
    // an UNNAMED local row must not delete a name the projection already carries.
    byId.set(id, (row.displayName ?? "").trim() || (byId.get(id) ?? ""));
  }
  const parts: string[] = [];
  for (const [id, displayName] of byId) {
    parts.push([id, displayName].join(AGENT_KEY_FIELD_SEP));
  }
  return parts.join(AGENT_KEY_ROW_SEP);
}

/** {@link liveAgentsKey}'S INVERSE — the candidate list back out of the key, so a
 *  `useMemo` over it is referentially stable across telemetry churn. */
export function liveAgentsFromKey(key: string): readonly LiveAgentSession[] {
  if (key === "") return NO_LIVE_AGENTS;
  const out: LiveAgentSession[] = [];
  for (const row of key.split(AGENT_KEY_ROW_SEP)) {
    const [name, displayName] = row.split(AGENT_KEY_FIELD_SEP);
    if (!name) continue;
    out.push({ name, displayName: displayName || null });
  }
  return out;
}
