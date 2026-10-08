import "server-only";
import { agentColorOrNull } from "../lib/agent-colors";
import { pickAgentColor } from "../lib/agent-color-pick";
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
 *  3. **MOST DISTINCT FREE** otherwise — the key the caller asked for is taken, or they
 *     asked for none. `lib/agent-color-pick.ts › pickAgentColor` decides, against the
 *     claims accumulated so far (so a batch spreads too).
 *  4. **SHARE** when every key is held (Samuel, 2026-10-08, "it can circle back"): the
 *     picker hands back the best key to reuse and the row is stamped `color_shared`, which
 *     takes it out of the unique index. A shared incumbent keeps its key on every later push.
 *     ⚠ The index still guards every FREE assignment, so two concurrent launches into a room
 *     with keys left can never both get one key; only reuse is exempt.
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

/** What is live in one channel, from sessions NOT among the rows this push replaces: holders per
 *  key, and which keys an EXCLUSIVE (non-shared) holder has — the ones the unique index guards.
 *  ⚠ EXCLUDES THE CALLER'S OWN ROWS ON PURPOSE: those are about to be rewritten, so counting them
 *  would make a session's own colour look taken and move it on every push. */
export interface ChannelColorClaims {
  holders: Map<string, number>;
  exclusive: Set<string>;
}
export type ForeignColorsByChannel = ReadonlyMap<string, ChannelColorClaims>;

/** Rule 1's input: what each `session_key` held BEFORE this push, and whether as a shared key. */
type StoredColorsByKey = ReadonlyMap<string, { color: string | null; shared: boolean }>;

function claim(claims: ChannelColorClaims, key: string, shared: boolean): void {
  claims.holders.set(key, (claims.holders.get(key) ?? 0) + 1);
  if (!shared) claims.exclusive.add(key);
}

export function resolveReportedColors({
  reported,
  storedColors,
  foreignColors,
}: {
  reported: readonly SessionStateUpsert[];
  storedColors: StoredColorsByKey;
  foreignColors: ForeignColorsByChannel;
}): SessionStateUpsert[] {
  /** Per channel: every claim, growing as this walk assigns. */
  const claimed = new Map<string, ChannelColorClaims>();
  const claimsFor = (channelId: string): ChannelColorClaims => {
    const existing = claimed.get(channelId);
    if (existing) return existing;
    const foreign = foreignColors.get(channelId);
    const fresh: ChannelColorClaims = {
      holders: new Map(foreign?.holders ?? []),
      exclusive: new Set(foreign?.exclusive ?? []),
    };
    claimed.set(channelId, fresh);
    return fresh;
  };

  // ⚠ **TWO PASSES, AND THE ORDER IS RULE 1's ENFORCEMENT.** Every incumbent claim is registered
  // before anything is granted or picked, so a later row's request cannot take a key an
  // earlier-listed session already holds.
  const keptByIndex = new Map<number, { color: AgentColorKey; shared: boolean }>();
  reported.forEach((row, index) => {
    const stored = storedColors.get(row.session_key);
    const held = agentColorOrNull(stored?.color);
    if (!held) return;
    const shared = stored?.shared === true;
    const claims = claimsFor(row.channel_id);
    // ⚠ AN EXCLUSIVE FOREIGN CLAIM BEATS AN EXCLUSIVE INCUMBENT, AND IT HAS TO: the index is
    // already satisfied by the other row, so insisting here would 23505 the push. A SHARED
    // incumbent is outside the index and keeps its key — a colour must not move under a
    // running agent just because the room is full.
    if (!shared && claims.exclusive.has(held)) return;
    claim(claims, held, shared);
    keptByIndex.set(index, { color: held, shared });
  });

  return reported.map((row, index) => {
    const kept = keptByIndex.get(index);
    if (kept) return { ...row, color: kept.color, color_shared: kept.shared };
    const claims = claimsFor(row.channel_id);
    const wanted = agentColorOrNull(row.color);
    // 2. GRANT the request when nobody holds it. 3. Otherwise PICK (`pickAgentColor`): a free key
    //    while one exists, else the best key to share. Shared ⇔ somebody already holds it.
    const color =
      wanted && !claims.holders.has(wanted) ? wanted : pickAgentColor(claims.holders);
    if (!color) return { ...row, color: null, color_shared: false };
    const shared = (claims.holders.get(color) ?? 0) > 0;
    claim(claims, color, shared);
    return { ...row, color, color_shared: shared };
  });
}

/** One live row's claim on the channel's colours, or `null` (ended, uncoloured, junk key). */
export function liveColorClaim(row: {
  color: string | null;
  state: string;
  color_shared?: boolean | null;
}): { key: AgentColorKey; shared: boolean } | null {
  if (row.state === "ended") return null;
  const key = agentColorOrNull(row.color);
  return key ? { key, shared: row.color_shared === true } : null;
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

// ⚠ **THE `AGENT_COLOR_KEYS` RE-EXPORT IS DELETED (2026-09-14).** It stood here so "a caller
// needing all sixteen imports ONE module rather than reaching past this file into `lib/`" — and
// **no caller ever did**: every consumer in this tree (`schema-sessions.ts`, `schema-launch.ts`,
// `agent-color-circles.tsx`, both suites) imports the bank from `lib/agent-colors.ts`, which is
// where it is declared. A second import path for one array is how two modules come to look like
// two vocabularies.
