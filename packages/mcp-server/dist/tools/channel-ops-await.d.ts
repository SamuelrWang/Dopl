/**
 * `dopl_channel` op="await" — the assembled LONG-HOLD, and every string that
 * describes it. The only op here that LOOPS, the only one with a budget, and
 * the only one whose result text reasons about the caller's client.
 *
 * ⚠ `channel-` filename prefix required by the parity split-scan
 * (parity.test.ts) — a handler in an unprefixed file is invisible to the
 * declared-param drift guards.
 *
 * ⚠ Every clock bounding the hold (poll size, assembled hold, env lever, and
 * the deadlines they fit under) lives in `channel-await-budget.ts`. Read that
 * before retuning any of them.
 */
import type { DoplClient } from "@dopl/client";
import { type ToolResponse } from "./respond";
/**
 * ⚠ Stop condition is scoped to the MEMBER the caller addressed, not to channel
 * activity: a five-member channel always has someone posting, so "any activity
 * in the last 30 minutes" keeps an agent re-arming forever over an exchange its
 * own counterparty abandoned.
 *
 * ⚠ AND IT IS NOW THE ONLY STOP CONDITION. It used to have a second half —
 * "stop when the thread is closed or failed" — which was the CHEAP exit, a state
 * the server would eventually show. Thread closing was removed (wiring plan
 * Phase 4, 2026-08-18), `get_thread` no longer reports a status, and a stop rule
 * naming a state that can never arrive is a rule to re-arm forever. Say the
 * absence out loud rather than dropping the clause: an agent that has been
 * taught to wait for a close will otherwise keep waiting for one.
 */
export declare function rearmStopRule(ref: string): string;
/**
 * LONG-HOLD await. One call holds up to `timeoutMs` (capped at
 * {@link AWAIT_HOLD_MS}) by re-issuing the ~50s inner long-poll on the same
 * `since` cursor. Returning the instant anything arrives keeps a reply fast;
 * holding past ~2 minutes when nothing does is what makes the pending call a
 * wake primitive.
 *
 * ⚠ Four results, never a thrown error once the hold is underway: messages,
 * timed-out (re-arm, with stop condition), FAILED-MID-HOLD (names what broke,
 * re-arms on the same cursor), CUT SHORT (do NOT re-arm, report).
 *
 * ⚠ CHANNEL-WIDE BY CONSTRUCTION — no thread filter, no `thread` param, and the
 * result text must never suggest otherwise: a filtered hold would miss messages
 * an agent needs to follow.
 *
 * `runtime` = caller's OBSERVED runtime stamp, threaded from the registrar.
 * Changes nothing this op DOES — only what it may claim about the hold.
 */
export declare function opAwait(client: DoplClient, ref: string, since: number, timeoutMs?: number, selfUserId?: string | null, runtime?: string | null): Promise<ToolResponse>;
