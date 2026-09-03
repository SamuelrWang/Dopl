/**
 * **THE HOLD ITSELF — ONE IMPLEMENTATION, TWO LANES** (slice B16, 2026-09-02).
 *
 * `dopl_channel(op="read")` with `wait_ms` holds by re-issuing the ~50s inner
 * long-poll on the same cursor until something arrives or the budget is spent.
 * Two handlers do it — one channel (`channel-ops-hold.ts`) and one workspace
 * (`channel-ops-hold-workspace.ts`) — and until this module they did it TWICE,
 * in fifty near-identical lines each, plus a verbatim copy of
 * {@link describeFailure}.
 *
 * ⚠ **WHAT IS SHARED IS THE LOOP; WHAT IS NOT IS THE RESULT TEXT, AND THAT SPLIT
 * IS DELIBERATE.** The two handlers stay siblings because their whole result
 * vocabulary differs — the per-channel one splices `ref` into every sentence it
 * writes, its not-found, and its stop rule, and threading an absent ref through
 * that produces guidance with a hole in it at exactly the moment an agent is
 * deciding what to do next. **What they never disagreed about is HOW TO WAIT**,
 * which is what lives here: a duplicated hold is a hold that gets retuned once.
 *
 * ⚠ **EVERY CLOCK IS IN `channel-hold-budget.ts`.** Read that before retuning
 * any of them; this module spends the budget, it does not choose it.
 *
 * ⚠ `channel-` filename prefix required by the parity split-scan
 * (`parity.test.ts`) and the removed-vocabulary source scan (`law-scan.test.ts`).
 */

import type { AwaitResult, ChannelMessage } from "@dopl/client";
import { neutralizeInline } from "./channel-shared";
// ⚠ WHICH SESSION wrote a line — the only field on the wire that names the
// process rather than the account. F-405's self-echo filter keys on it.
import { sessionIdOf } from "./channel-render";
import {
  HOLD_MAX_POLLS,
  HOLD_MIN_POLL_MS,
  HOLD_POLL_MS,
  holdMsFor,
  HOLD_SHORT_MS,
} from "./channel-hold-budget";

/**
 * A thrown inner-poll failure reduced to one short line — this rides inside a
 * result the caller reads as our narration.
 *
 * ⚠ NEUTRALIZED, not just shortened: "our own server's error" says nothing about
 * its CONTENT — a 400 echoing a rejected field, a proxy page, or a not-found
 * naming a counterparty ref all carry influenced text, read as server narration
 * in an unframed line.
 */
export function describeFailure(e: unknown): string {
  let raw: string;
  if (e instanceof Error) raw = e.message;
  else if (typeof e === "string") raw = e;
  else {
    try {
      raw = JSON.stringify(e) ?? String(e);
    } catch {
      raw = String(e);
    }
  }
  return neutralizeInline(raw) ?? "`no detail reported`";
}

/** One inner long-poll, as its two lanes' routes answer it. ⚠ Both shapes
 *  extend `AwaitResult`, so the session snapshot is one type in both. */
export type HoldPoll<M> = (args: {
  since: number;
  timeoutMs: number;
}) => Promise<{
  messages: M[];
  sessions?: AwaitResult["sessions"];
  operatorOnline?: AwaitResult["operatorOnline"];
}>;

/** What ended the hold, and everything a result line needs to say so. */
export interface HoldOutcome<M> {
  /** Non-empty only when a COUNTERPARTY message ended the hold. */
  messages: M[];
  /** The cursor to resume from — `since`, advanced only past our own echoes. */
  cursor: number;
  /** Wall clock actually spent. ⚠ Not the budget: a hold cut short must not
   *  misreport how long anyone waited. */
  elapsedMs: number;
  /** What was asked for, after the runtime rule and the incident lever. */
  budgetMs: number;
  /** ⚠ `undefined` until a poll actually answered, and it stays `undefined` if
   *  the server never sent the key. **`undefined` and `[]` are different
   *  answers** and the renderers treat them as such; never normalize one. */
  sessions: AwaitResult["sessions"];
  /** ⚠ MOVES WITH `sessions` AND ONLY WITH IT (F-294): the route emits both keys
   *  or neither, and pairing a fresh row set with a liveness answer carried over
   *  from an earlier poll is the one way to make it lie. */
  operatorOnline: AwaitResult["operatorOnline"];
  /** The inner failure that ended the hold, or null. Named in the result: "the
   *  wait timed out" after a socket reset is not actionable. */
  pollError: unknown;
}

/**
 * HOLD until a counterparty message arrives or the budget is spent.
 *
 * ⚠ **IT NEVER THROWS ONCE THE HOLD IS UNDERWAY.** Poll 0 rethrows — nothing is
 * established yet, so the error IS the honest answer, and it is where each lane
 * maps its own not-found. After that a transient failure is CARRIED in
 * `pollError` rather than propagated: propagating it would hand the agent a
 * transport error instead of the timed-out result, losing all the re-arm
 * teaching, which lives in that result text and nowhere else.
 *
 * ⚠ **THE LOOP BOUND IS ELAPSED TIME, NEVER A CALL COUNT** — an inner poll
 * returning early (or clamped by the route) shortens that iteration, not the
 * hold. `HOLD_MAX_POLLS` is a spin brake for a server answering instantly, not
 * the bound.
 *
 * 🔒 **NO AUTHOR FILTER, EVER — THE SELF-ECHO FILTER IS SESSION-SCOPED AND
 * NOTHING ELSE (F-405).** A hold waits for a COUNTERPARTY, and posting a
 * milestone after arming must not pop the agent's own hold on its own echo —
 * that much is real. What it may never do is decide by ACCOUNT: every post is
 * stamped `author_user_id = ctx.userId` while one operator runs many concurrent
 * sessions, so an orchestrator and its worker are the SAME author id. Filtering
 * on it removed the row from the page AND from the existence probe, so the hold
 * did not even spin — it held silently to its deadline while the answer sat in
 * the table, and `op="read"` showed exactly what the hold swore was not there.
 * ⚠ **WITH NO SESSION STAMP NOTHING IS DROPPED AT ALL**, and that is the whole
 * of the unstamped contract: an external client is BLOCKED inside this call and
 * cannot post during it, so at worst an older desktop build wakes on its own
 * milestone. A noisy wake is recoverable; a silent hold is not.
 */
// ⚠ **BOTH LANES\' MESSAGE TYPES, AS ONE BOUND.** The workspace shape EXTENDS
// `ChannelMessage`, so one constraint covers the pair — and it has to be the
// real type rather than a structural `{ seq }` because the self-echo filter
// reads `sessionIdOf`, which is a rule about a MESSAGE and not about any row
// that happens to carry a cursor.
export async function runHold<M extends ChannelMessage>(
  poll: HoldPoll<M>,
  since: number,
  timeoutMs: number | undefined,
  runtime: string | null,
  selfSessionId: string | null,
): Promise<HoldOutcome<M>> {
  // ⚠ AN EXPLICIT ASK IS HONOURED EXACTLY; the DEFAULT depends on the caller's
  // runtime — `channel-hold-budget.ts › holdMsFor` carries both rules and why
  // one default could not serve both populations (T03).
  const budgetMs = holdMsFor(timeoutMs, runtime);
  const startedAt = Date.now();
  const deadline = startedAt + budgetMs;
  const out: HoldOutcome<M> = {
    messages: [],
    cursor: since,
    elapsedMs: 0,
    budgetMs,
    sessions: undefined,
    operatorOnline: undefined,
    pollError: null,
  };

  for (let attempt = 0; attempt < HOLD_MAX_POLLS; attempt++) {
    const remaining = deadline - Date.now();
    // ⚠ Always make the first call — a `wait_ms=0` caller wants one immediate
    // check. Stop re-issuing once the leftover budget is a sliver.
    if (attempt > 0 && remaining < HOLD_MIN_POLL_MS) break;

    let result: Awaited<ReturnType<HoldPoll<M>>>;
    try {
      result = await poll({
        since: out.cursor,
        // ⚠ Floored at 1ms, not 0 — the routes' query schemas require a POSITIVE
        // timeout, so a `wait_ms=0` caller would 400 instead of getting its check.
        timeoutMs: Math.max(1, Math.min(HOLD_POLL_MS, remaining)),
      });
    } catch (e) {
      if (attempt === 0) throw e;
      out.pollError = e;
      break;
    }
    // ⚠ LAST WRITER WINS, deliberately: the freshest snapshot is the one from
    // the poll that ended the hold.
    if (result.sessions !== undefined) {
      out.sessions = result.sessions;
      out.operatorOnline = result.operatorOnline;
    }
    if (result.messages.length === 0) continue;

    // ⚠ OUR OWN LINES, DROPPED HERE RATHER THAN IN SQL — the page is already in
    // hand and `session_id` is on it, so this needs no new query param and no new
    // predicate interpolated into PostgREST's `or` grammar (a session id is not a
    // uuid; it may carry `.` and `:`, which are that grammar's separators).
    const fresh =
      selfSessionId === null
        ? result.messages
        : result.messages.filter((m) => sessionIdOf(m) !== selfSessionId);
    if (fresh.length > 0) {
      out.messages = fresh;
      break;
    }
    // ⚠ EVERY ROW WAS OUR OWN ECHO, so keep holding — but ADVANCE PAST THEM
    // first. Re-issuing on the same cursor would re-fetch the same rows every
    // tick and burn the whole budget in milliseconds, which then trips the CUT
    // SHORT branch and tells the agent the platform is broken.
    //
    // ⚠ SAFE BECAUSE OF WHAT IT SKIPS: only rows THIS SESSION WROTE, which the
    // caller already knows about by definition. Every counterparty row is
    // returned above before the cursor ever moves, so nothing anyone else said
    // can be stepped over. This is the ONE thing that may advance a cursor
    // mid-hold.
    out.cursor = result.messages[result.messages.length - 1].seq;
  }

  out.elapsedMs = Date.now() - startedAt;
  return out;
}

/**
 * TRUE when the hold came back so far under the ask that re-arming would spin.
 *
 * ⚠ Half the ask, capped at {@link HOLD_SHORT_MS}, so a deliberately SHORT hold
 * is not warned about getting one. Something cut it short — a platform function
 * clamp, a route answering instantly, an inner failure — and each attempt would
 * return in seconds, so the call never stays pending past the ~2 min
 * backgrounding mark and never becomes a wake.
 */
export function wasCutShort(elapsedMs: number, budgetMs: number): boolean {
  return elapsedMs < Math.min(HOLD_SHORT_MS, budgetMs / 2);
}
