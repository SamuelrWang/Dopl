import "server-only";
import {
  AGENT_COLOR_KEYS,
  agentColorOrNull,
  firstFreeAgentColor,
} from "../lib/agent-colors";
import type { AgentColorKey } from "../types";
import type { SessionStateUpsert } from "./collab-dto";

/**
 * **WHICH COLOUR EACH REPORTED SESSION ACTUALLY GETS** — the policy half of agent
 * colours, pure and database-free (Samuel, 2026-09-13; docs/specs/agent-colors.md).
 *
 * ── WHY THE SERVER DECIDES AND THE MACHINE ONLY ASKS ────────────────────────────
 *
 * ⚠ **TWO MEMBERS' DESKTOPS CANNOT SEE EACH OTHER.** Each one pushes its own live
 * set and neither can enumerate the other's; so "no two agents in this channel wear
 * one colour" is not a fact any machine is in a position to establish. The database
 * establishes it (`channel_sessions_channel_color_live_key`), and this function is
 * what keeps the push from ever HITTING that index — because a unique violation on
 * this lane is not a nice error, it is a 400/500 that discards the whole projection
 * for that workspace (`schema-sessions.ts` carries the argument in full).
 *
 * ⚠ **SO THE REPORTED COLOUR IS A REQUEST, AND THE REQUEST IS USUALLY GRANTED.**
 * The operator picked it in the New-agent popup against the same taken set, so the
 * ordinary path is "honoured unchanged". The overrule exists for the race the popup
 * cannot close: two members choosing `agent-03` seconds apart.
 *
 * ── THE FOUR RULES, IN ORDER, AND WHY THE FIRST ONE IS FIRST ────────────────────
 *
 * For each reported session, in the channel it names:
 *
 *  1. **KEEP WHAT THIS SESSION ALREADY HOLDS.** If the stored row for this
 *     `session_key` carries a colour still free of FOREIGN claims, that colour wins
 *     over everything below — including a different request from the machine.
 *     ⚠ **THIS RULE IS THE WHOLE REASON THE FEATURE IS USABLE.** A colour that can
 *     move under a running agent is worse than no colour: the operator learns that
 *     the teal one is their reviewer, and a reassignment on some later push makes
 *     every earlier post in the transcript re-render in somebody else's colour. It
 *     also keeps the reconcile QUIET — `sessionRowMatches` compares `color`, so a
 *     colour that wobbled would touch `updated_at` on every push and destroy the
 *     read's ordering.
 *  2. **GRANT THE REQUEST** if the machine named a key nothing else holds.
 *  3. **FIRST FREE** otherwise — the key the caller asked for is taken, or they
 *     asked for none. `lib/agent-colors.ts › firstFreeAgentColor` is the order.
 *  4. **`null`** when the bank is empty. ⚠ **NEVER A REFUSAL.** A seventeenth live
 *     agent in one room runs UNCOLOURED and its posts wear the neutral box; dropping
 *     a machine's whole projection over a decoration is not a trade anyone would
 *     make.
 *
 * ⚠ **THE WITHIN-BATCH CLAIM IS AS REAL AS THE FOREIGN ONE.** One push may carry
 * several of the operator's own agents in one channel, and two of them wanting
 * `agent-01` is the same unique violation as two members wanting it. So every key
 * this function hands out is added to the working set as it goes — which is also why
 * it resolves the WHOLE array at once rather than exposing a per-row helper somebody
 * could call in a loop without the accumulator.
 *
 * ⚠ **IT IS PURE AND TAKES THE FOREIGN SET RATHER THAN READING IT** —
 * `repository-session-colors.ts` is the read. That split is what lets the uniqueness
 * rule be unit-tested (and MUTATION-VERIFIED) without a database, while the index
 * stays the thing that is actually true.
 */

/** Every colour held in one channel by a session that is NOT one of the rows this
 *  push is replacing — keyed by channel id. ⚠ EXCLUDES THE CALLER'S OWN ROWS ON
 *  PURPOSE: those are about to be rewritten, so counting them would make a session's
 *  own colour look taken and move it on every push. */
export type ForeignColorsByChannel = ReadonlyMap<string, ReadonlySet<string>>;

/**
 * Rule 1's input: what each `session_key` held BEFORE this push.
 * ⚠ Read out of the reconcile's own SELECT, so it costs no extra query.
 */
export type StoredColorsByKey = ReadonlyMap<string, string | null>;

export function resolveReportedColors({
  reported,
  storedColors,
  foreignColors,
}: {
  reported: readonly SessionStateUpsert[];
  storedColors: StoredColorsByKey;
  foreignColors: ForeignColorsByChannel;
}): SessionStateUpsert[] {
  /** Per channel: every key that is spoken for, growing as this walk assigns. */
  const claimed = new Map<string, Set<string>>();
  const claimsFor = (channelId: string): Set<string> => {
    const existing = claimed.get(channelId);
    if (existing) return existing;
    const fresh = new Set<string>(foreignColors.get(channelId) ?? []);
    claimed.set(channelId, fresh);
    return fresh;
  };

  // ⚠ **TWO PASSES, AND THE ORDER IS RULE 1's ENFORCEMENT.** A single pass would let
  // a LATER row's request take the key an EARLIER-listed session already holds,
  // because the holder had not been walked yet — which is rule 1 losing to rule 2 on
  // array order alone. So every incumbent claim is registered first, and only then is
  // anything granted or picked.
  const keptByIndex = new Map<number, AgentColorKey>();
  reported.forEach((row, index) => {
    const held = agentColorOrNull(storedColors.get(row.session_key));
    if (!held) return;
    const claims = claimsFor(row.channel_id);
    // ⚠ A FOREIGN CLAIM BEATS AN INCUMBENT, AND IT HAS TO: the index is already
    // satisfied by the other member's row, so insisting here would 23505 the push.
    // This is the one case where a live agent's colour moves, and it is unreachable
    // unless two machines raced past each other's taken set.
    if (claims.has(held)) return;
    claims.add(held);
    keptByIndex.set(index, held);
  });

  return reported.map((row, index) => {
    const kept = keptByIndex.get(index);
    if (kept) return { ...row, color: kept };
    const claims = claimsFor(row.channel_id);
    const wanted = agentColorOrNull(row.color);
    const color =
      wanted && !claims.has(wanted) ? wanted : firstFreeAgentColor(claims);
    if (color) claims.add(color);
    return { ...row, color };
  });
}

/**
 * THE TAKEN SET A SURFACE OR A LAUNCH IS ANSWERED WITH — every colour held by a LIVE
 * session in one channel, whoever is running it.
 *
 * ⚠ Exported from the policy file rather than the repository because it is the same
 * rule stated once: "live" is `state !== 'ended'` and nothing else, which is exactly
 * the index's predicate. A second spelling in the repository is how a read starts
 * disagreeing with the constraint it exists to predict.
 */
export function takenColorsFromRows(
  rows: ReadonlyArray<{ color: string | null; state: string }>
): Set<string> {
  const taken = new Set<string>();
  for (const row of rows) {
    if (row.state === "ended") continue;
    const key = agentColorOrNull(row.color);
    if (key) taken.add(key);
  }
  return taken;
}

/** ⚠ Re-exported so a caller needing "all sixteen" imports ONE module rather than
 *  reaching past this file into `lib/` for half the vocabulary. */
export { AGENT_COLOR_KEYS };
