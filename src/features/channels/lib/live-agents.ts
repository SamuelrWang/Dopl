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

// ⚠ THE ONE MEMBERSHIP TEST FOR A COLOUR KEY — this file reconciles two untrusted
// sources, so it narrows rather than casts. `lib/agent-colors.ts` says what a key is, once.
import { agentColorOrNull } from "./agent-colors";
import type { AgentColorKey } from "../types";
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
  /** ⚠ **PRESENT ON THE TYPE AND NOT YET ON THE WIRE, WHICH IS DELIBERATE RATHER THAN
   *  ASPIRATIONAL.** A colour is ASSIGNED BY THE SERVER (`20261005120000`'s per-channel
   *  live unique index), so no machine's local feed is in a position to know one — and
   *  `main/session-state-push.js › reportRow` puts the key on the wire while
   *  `main/session-summary.js › liveSummary` (the parked-session lane's file, 2026-09-13)
   *  is what will one day put it on THIS shape. Declaring it now is what makes
   *  {@link liveAgentsKey}'s precedence rule below expressible and testable; until then
   *  every own row reports `undefined` and the peer half supplies every colour.
   *  ⚠ `unknown`, on `view-model.ts › indexAgents`'s argument: it is narrowed against a
   *  CLOSED SET, and the union type here would delete that refusal branch. */
  color?: unknown;
}

/**
 * A row of the SERVER'S PEER PROJECTION as it arrives — `ChannelPeerSession`, widened for
 * `color` only (2026-09-13).
 *
 * ⚠ **THE INPUT AND THE OUTPUT OF THIS FILE HAVE DIFFERENT COLOUR TYPES ON PURPOSE, AND THAT
 * ASYMMETRY IS THE WHOLE POINT OF THE NARROWING.** What comes IN is a poll payload — possibly
 * cached against an older schema (INVARIANTS §8), possibly written by a newer desktop that has
 * learned a seventeenth key — so `unknown` is the only honest type and
 * `lib/agent-colors.ts › agentColorOrNull` is the gate. What goes OUT
 * ({@link LiveAgentSession}) is `AgentColorKey | null`, because by then it has passed that
 * gate and every consumer may hand it straight to `agentColorVar`.
 * ⚠ **TYPING THE INPUT AS THE UNION WOULD DELETE THE GATE** — the compiler would prove the
 * refusal branch unreachable, and the next cleanup would remove it. Same argument
 * `OwnAgentSessionRow.color` above carries, and `view-model.ts › indexAgents` before both.
 */
export interface PeerAgentSessionRow {
  name: string;
  displayName?: string | null;
  color?: unknown;
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
  peers: readonly PeerAgentSessionRow[],
  own: readonly OwnAgentSessionRow[] | null,
  channelId: string
): string {
  const byId = new Map<string, string>();
  /** ⚠ **A SECOND MAP RATHER THAN A WIDER VALUE IN `byId`**, because the two fields have
   *  OPPOSITE precedence and packing them would hide that. The local feed's NAME is the
   *  fresher one (it sees a rename before the next push); the local feed's COLOUR does not
   *  exist, so for colour the SERVER's projection is the only authority and an own row must
   *  never be able to speak about it at all. One map per precedence rule. */
  const colorById = new Map<string, AgentColorKey>();
  for (const peer of peers) {
    const id = peer.name.trim();
    if (!id) continue;
    byId.set(id, peer.displayName ?? "");
    const key = agentColorOrNull(peer.color);
    if (key) colorById.set(id, key);
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
    // ⚠ **ONLY EVER ADDS, NEVER OVERWRITES** — the precedence rule `colorById`'s docblock
    // states. A local row that reports a colour (a future main, or a replayed cache) is
    // taken when the projection has none, and is IGNORED when it disagrees: the index is
    // the authority, and a machine that believes it holds `agent-03` while the server has
    // given that key to another member must not paint the transcript with it.
    // ⚠ NOT NAMED `own` — that is this function's own parameter, and shadowing it here
    // would read as "the own feed" while meaning "one row's colour".
    const localKey = agentColorOrNull(row.color);
    if (localKey && !colorById.has(id)) colorById.set(id, localKey);
  }
  const parts: string[] = [];
  for (const [id, displayName] of byId) {
    // ⚠ THE COLOUR IS THE THIRD FIELD AND ALWAYS WRITTEN, empty for "none" — a key whose
    // field count varies per row is a key whose `split` silently shifts every field after
    // the missing one, which is why `view-model.ts › agentIndexKey` writes its empties too.
    parts.push(
      [id, displayName, colorById.get(id) ?? ""].join(AGENT_KEY_FIELD_SEP)
    );
  }
  return parts.join(AGENT_KEY_ROW_SEP);
}

/** {@link liveAgentsKey}'S INVERSE — the candidate list back out of the key, so a
 *  `useMemo` over it is referentially stable across telemetry churn. */
export function liveAgentsFromKey(key: string): readonly LiveAgentSession[] {
  if (key === "") return NO_LIVE_AGENTS;
  const out: LiveAgentSession[] = [];
  for (const row of key.split(AGENT_KEY_ROW_SEP)) {
    const [name, displayName, color] = row.split(AGENT_KEY_FIELD_SEP);
    if (!name) continue;
    // ⚠ NARROWED ON THE WAY BACK OUT, not trusted: this string was built from a peer's
    // projection, and an unknown key must read as "no colour" rather than reach a
    // `var(--agent-color-…)` that resolves to nothing and paints an invisible surface.
    out.push({ name, displayName: displayName || null, color: agentColorOrNull(color) });
  }
  return out;
}
