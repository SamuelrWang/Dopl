/**
 * `dopl_channel` op="await" — the assembled LONG-HOLD, and every string that
 * describes it. Split out of `channel-ops-read.ts` at the §2 500-line cap, on
 * the seam that file had already drawn twice: `channel-await-budget.ts` took
 * the clocks ("the op itself lives there") and `channel-wake-guidance.ts` took
 * the wake claims. This takes the op. What is left in `channel-ops-read.ts` is
 * the five ops that do one round-trip and render it.
 *
 * The seam is real, not arithmetic: `await` is the only op here that LOOPS, the
 * only one with a budget, and the only one whose result text has to reason
 * about the caller's client. Nothing in it is shared with `read` beyond the
 * renderers both import.
 *
 * The `channel-` filename prefix is required by the parity split-scan
 * (parity.test.ts) — a handler in an unprefixed file is invisible to the
 * declared-param drift guards.
 *
 * Every clock that bounds the hold — the poll size, the assembled hold, the env
 * lever, and the deadlines they must fit under — lives in
 * `channel-await-budget.ts`. Read that file before retuning any of them.
 */
import type { DoplClient } from "@dopl/client";
import { type ToolResponse } from "./respond";
/**
 * N-PARTY — "the peer" was undefined and unevaluable in a channel with more
 * than two members, and evaluating it loosely is worse than not stating it: a
 * five-member channel always has SOMEONE posting, so "any activity in the last
 * 30 minutes" keeps an agent re-arming forever over an exchange its own
 * counterparty abandoned. The condition is therefore scoped to the member the
 * caller is waiting on — the one it addressed, which it knows and this module
 * does not.
 */
export declare function rearmStopRule(ref: string): string;
/**
 * LONG-HOLD await. One call holds up to `timeoutMs` (capped at
 * {@link AWAIT_HOLD_MS}) by re-issuing the ~50s inner long-poll with the same
 * `since` cursor until messages land or the budget runs out. Returning the
 * moment anything arrives is what keeps a reply fast; holding past ~2 minutes
 * when nothing does is what makes the pending call a wake primitive.
 *
 * Four results, never a thrown error once the hold is underway: new messages, a
 * timed-out note that tells the caller to re-arm (with a stop condition), a
 * FAILED-MID-HOLD note that names what broke and re-arms on the same cursor,
 * or — when the hold ended far under what was asked for with no error at all —
 * a CUT SHORT note that tells the caller NOT to re-arm and to report it.
 *
 * CHANNEL-WIDE BY CONSTRUCTION: there is no thread filter here and there is no
 * `thread` parameter to pass. `op="read"` has one; this does not, and the
 * result text must never suggest otherwise — a filtered hold would miss the
 * messages an agent needs to follow.
 *
 * `runtime` is the caller's OBSERVED runtime stamp (`CallerIdentity.runtime`,
 * threaded from the registrar). It changes nothing this op DOES — only what it
 * is willing to claim about the hold. See `channel-wake-guidance.ts`.
 */
export declare function opAwait(client: DoplClient, ref: string, since: number, timeoutMs?: number, selfUserId?: string | null, runtime?: string | null): Promise<ToolResponse>;
