import "server-only";
import type { SessionStateEntryInput } from "../schema-sessions";
import type { ChannelContext } from "./service-shared";
import {
  listTokenSpend,
  recordTokenSpend,
  type TokenSpendMark,
} from "./repository-token-spend";

/**
 * TOKEN SPEND — the durable half of the number the Agents surface already
 * shows (Samuel, #1326: track it over time, persistently, on Overview).
 *
 * ⚠ **THIS FEATURE ADDS NO MEASUREMENT AND NO WRITE OF ITS OWN.** The figure is
 * `s.tokensSpent`, accumulated on the desktop at `session-io.js`'s `result`
 * handler; it already crosses the wire on every session push. What was missing
 * was DURABILITY: `channel_sessions` is a live projection written by a
 * whole-set REPLACE, so the row carrying the lifetime figure is deleted when
 * the pill leaves. This module copies each run's figure into a ledger that
 * outlives the pill, on the push that was already happening.
 * ⚠ **DO NOT GIVE IT A TIMER, A POLL OR A PER-TURN WRITE.** The push's own
 * cadence (state change, floored — `session-telemetry.js`) is the write rate,
 * and it is bounded there. A ledger that writes more often than the number is
 * reported cannot be more accurate than the number is.
 */

/**
 * ONE PUSH'S REPORT → THE MARKS WORTH STORING.
 *
 * ⚠ THREE FIELDS ARE REQUIRED AND A ROW MISSING ANY OF THEM IS DROPPED, NOT
 * DEFAULTED:
 *   `sessionKey`   — nothing to key the run on.
 *   `startedAt`    — ⚠ THE RUN'S IDENTITY. `sessionKey` is REUSED by the next
 *                    session on the same thread, whose count starts again at
 *                    zero; without this the two runs share a row and the second
 *                    one looks like a counter going backwards. An older desktop
 *                    that omits it contributes nothing to the ledger, which is
 *                    the honest outcome — its runs cannot be told apart.
 *   `tokensSpent`  — ⚠ `null` IS "NOTHING HAS MEASURED THIS", the discipline
 *                    `metricOrNull` keeps all the way from the session object to
 *                    the wire. A `?? 0` here would manufacture a measurement
 *                    nobody took and record it as a spend of zero forever.
 *
 * ⚠ `0` IS KEPT, AND IT IS NOT THE SAME AS ABSENT: a measured run that has spent
 * less than one 10 000-token bucket reports 0 (`session-telemetry.js` states
 * this in its own words). Its row is worth storing — it is a run that happened.
 *
 * ⚠ THE LABEL PREFERS THE OPERATOR'S NAME AND FALLS BACK TO THE AGENT ID, the
 * same order every other surface renders an agent in. Both arrive already
 * bounded and charset-checked (`schema-sessions.ts`), so nothing here
 * re-sanitizes: a second neutralizer is the one that drifts.
 */
export function marksFrom(sessions: SessionStateEntryInput[]): TokenSpendMark[] {
  const marks: TokenSpendMark[] = [];
  for (const entry of sessions) {
    const startedAt = entry.startedAt ?? null;
    const tokens = entry.tokensSpent ?? null;
    if (!entry.sessionKey || !startedAt || tokens === null) continue;
    marks.push({
      session_key: entry.sessionKey,
      started_at: startedAt,
      tokens,
      agent_name: entry.displayName ?? entry.name ?? null,
      channel_id: entry.channelId ?? null,
    });
  }
  return marks;
}

/**
 * RECORD this push's spend. Returns what actually landed, and `null` when there
 * is no ledger in this environment yet.
 *
 * ⚠ **SEQUENCED AFTER THE PROJECTION AND IT MUST STAY THERE** — the same order,
 * and the same reason, as the wake acks beside it: the session set is what a
 * whole MCP op reads, and this is a durable copy of one number on it. If this
 * throws, the projection has already landed and the desktop retries the push,
 * which re-sends the same cumulative figures — and the merge is
 * `GREATEST(stored, reported)`, so a retry stores the same thing rather than
 * adding it twice. ⚠ THAT IDEMPOTENCE IS WHY THIS ORDER IS SAFE. Reverse it and
 * a failure in the lesser half costs the projection.
 *
 * ⚠ **THE CALLER REPORTS ONLY WHAT LANDED.** `null` is not folded into 0 here
 * and must not be folded into 0 above: 0 means "the ledger took nothing new",
 * `null` means "there is no ledger", and a response claiming a store that did
 * not happen is the failure `replaceSessionStates`'s own docblock refuses to
 * allow anywhere on this path.
 *
 * ⚠ SCOPED TO THE CALLER, exactly as the projection write is: `ctx.userId` and
 * `ctx.workspaceId` are the only identity the repository sees, and the payload
 * carries neither.
 */
export async function recordSessionTokenSpend(
  ctx: ChannelContext,
  sessions: SessionStateEntryInput[]
): Promise<number | null> {
  return recordTokenSpend(ctx.userId, ctx.workspaceId, marksFrom(sessions));
}

/**
 * ONE RUN'S SPEND, at the instant it started. ⚠ **AN INSTANT, NOT A DAY** — see
 * `readTokenSpend`; naming a day is the renderer's job now.
 */
export type TokenSpendMarkPoint = { at: string; tokens: number };

export type TokenSpendReport = {
  /** The window's runs, newest first, as instants. */
  marks: TokenSpendMarkPoint[];
  /** ⚠ The read hit its row bound, so the window is INCOMPLETE and the surface
   *  must say so rather than draw a short month as a quiet one. */
  truncated: boolean;
};

/**
 * THE CALLER'S OWN RUNS AND WHAT EACH SPENT.
 *
 * 🔒 **THIS SERVER NAMES NO DAYS (Samuel's ruling, 2026-09-06: the strip buckets
 * by LOCAL day).** It used to answer UTC buckets, with its own docblock saying a
 * reader wanting local days should "re-bucket from the raw rows — never by
 * shifting these labels". That is exactly what happened: the rows now travel and
 * the RENDERER, which is the only party that knows the operator's zone, decides
 * where a day starts. Handing the client UTC buckets to shift would have been
 * the half-conversion that block refuses. ⚠ **NO MIGRATION WAS NEEDED** — the
 * ledger keeps each run's full `started_at` for precisely this.
 * ⚠ **A UTC OFFSET ON THE REQUEST WAS THE OTHER CANDIDATE AND IS WORSE**: one
 * offset is wrong for part of any window that spans a DST change, whereas the
 * client re-buckets each instant in its own zone and gets every boundary right.
 *
 * ⚠ **TOTALS AND RUN COUNTS ARE NOT HERE EITHER, AND THAT IS THE SAME RULING.**
 * They can only be summed over a window whose EDGES are days, so a total counted
 * here would include runs the local-day axis does not draw — one card showing two
 * numbers, which is the defect the credits bar was just fixed for. The renderer
 * sums what it draws.
 *
 * ⚠ **EVERY ROW IN THE WINDOW, NOT ONE PER DAY.** The row bound is the read's
 * (`repository-token-spend.ts › SPEND_ROWS_LIMIT`, 2000 runs) and `truncated`
 * still reports it; a session RUN is a coarse row, so this is a month of an
 * operator's own agents, not a message log.
 */
/**
 * ⚠ **IT TAKES A `userId`, NOT A `ChannelContext`, AND THE DIFFERENCE IS THE
 * FENCE RATHER THAN THE ERGONOMICS.** The write is per-workspace and belongs to
 * a channel push; this read is ACCOUNT-WIDE across containers, which is what
 * Overview is. Handing it a workspace-bearing context would invite a future
 * caller to narrow it to `ctx.workspaceId` and silently answer for one
 * container on a page whose whole contract is that it spans them.
 */
export async function readTokenSpend(
  userId: string,
  sinceIso: string
): Promise<TokenSpendReport> {
  const { rows, truncated } = await listTokenSpend(userId, sinceIso);
  // ⚠ `Number(...) || 0` STAYS: `tokens` is a `bigint`-backed column and
  // PostgREST hands large values over as strings. A row that cannot be read as a
  // number contributes nothing rather than an `NaN` that would poison the
  // renderer's whole sum.
  const marks = rows.map((row) => ({
    at: row.started_at,
    tokens: Number(row.tokens) || 0,
  }));
  return { marks, truncated };
}
