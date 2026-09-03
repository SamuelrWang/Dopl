/**
 * `dopl_channel(op="read")` with `wait_ms` — ONE CHANNEL — and every string that
 * describes the hold. The only shape here whose result text reasons about the
 * caller's client.
 *
 * ⚠ **IT WAS `op="await"` UNTIL 2026-09-02 (B8) AND THE OP IS GONE (B16).** The
 * hold is a knob on the read, so the module is named for the read path it lives
 * under; nothing in the tree calls this lane `await` any more except the HTTP
 * route and the SDK method that carry the inner long-poll, which are transport.
 *
 * ⚠ **THE LOOP IS NOT HERE — it is `channel-hold-loop.ts`, shared with the
 * workspace lane.** What IS here is the four RESULT VOCABULARIES, which are what
 * make the two lanes siblings rather than one function with a flag: every
 * sentence below splices `ref`.
 *
 * ⚠ Every clock bounding the hold lives in `channel-hold-budget.ts`. Read that
 * before retuning any of them.
 *
 * ⚠ `channel-` filename prefix required by the parity split-scan
 * (parity.test.ts) — a handler in an unprefixed file is invisible to the
 * declared-param drift guards.
 */

import type { ChannelMessage, DoplClient } from "@dopl/client";
import { ok, isNotFound, type ToolResponse } from "./respond";
import { channelNotFound } from "./channel-shared";
import { addresseeOf, formatMessages } from "./channel-render";
import { UNTRUSTED_BODY_HEADER } from "./channel-framing";
// ⚠ THE ONE HOLD IMPLEMENTATION, shared with the workspace lane — the loop, the
// self-echo rule and the cut-short test. This module writes the sentences.
import { describeFailure, runHold, wasCutShort } from "./channel-hold-loop";
// ⚠ Addressing rule has ONE statement, in channel-addressing.ts.
import { HOLD_UNNAMED_NOTICE } from "./channel-addressing";
// ⚠ Whether a pending call may be promised to outlive the turn is ONE decision
// in ONE module, from the caller's observed runtime.
import { holdArrivedLines, holdTimedOutLines } from "./channel-wake-guidance";
// ⚠ The session block and every rule inside it (the staleness hedge, the
// operator-only telemetry, `undefined` vs `[]`) have ONE statement, shared with
// `op="status"` — see channel-session-table.ts.
import { sessionBlockLines } from "./channel-session-table";

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
export function rearmStopRule(ref: string): string {
  return `Keep waiting while the exchange is alive — an agent working a real task can be silent for a long stretch. Every ~3 empty holds in a row, check before re-arming: dopl_channel(op="read", channel="${ref}", since=<your cursor>) for signs of life (a working agent posts task_progress milestones). Judge that ONLY on the member you are waiting on — the one you addressed. In a channel with other members, traffic between THEM is not evidence your exchange is alive. Keep re-arming while something came from that member in roughly the last 30 minutes. STOP and report to your operator when nothing at all has come from that member for ~30+ minutes. There is no finished STATE to wait for — a thread never closes — so silence from the member you addressed is the only stop signal there is.`;
}

/**
 * THE PER-CHANNEL HOLD. One call holds for `holdMsFor(waitMs, runtime)` by
 * re-issuing the ~50s inner long-poll on the same cursor
 * (`channel-hold-loop.ts › runHold`). Returning the instant anything arrives
 * keeps a reply fast; holding past ~2 minutes when nothing does is what makes
 * the pending call a wake primitive — ⚠ and that is reachable only for a
 * DESKTOP-stamped caller or an explicit `wait_ms`, not at an unstamped caller's
 * default, whose own client aborts first (T03).
 *
 * ⚠ Four results, never a thrown error once the hold is underway: messages,
 * timed-out (re-arm, with stop condition), FAILED-MID-HOLD (names what broke,
 * re-arms on the same cursor), CUT SHORT (do NOT re-arm, report).
 *
 * ⚠ CHANNEL-WIDE BY CONSTRUCTION — no thread filter, no `thread` param on this
 * shape, and the result text must never suggest otherwise: a filtered hold would
 * miss messages an agent needs to follow.
 *
 * `runtime` = caller's OBSERVED runtime stamp, threaded from the registrar.
 * ⚠ IT SIZES THE DEFAULT HOLD AS WELL AS WORDING THE RESULT (T03) — still an
 * observation that grants nothing, but read wrong it costs hold length one way
 * and a transport error the other.
 */
export async function opHold(
  client: DoplClient,
  ref: string,
  since: number,
  waitMs?: number,
  selfUserId: string | null = null,
  runtime: string | null = null,
  selfSessionId: string | null = null,
): Promise<ToolResponse> {
  let held;
  try {
    held = await runHold<ChannelMessage>(
      // Hot path (inside a listener's poll loop, so the saved round-trip
      // compounds per cycle): ref straight through, route 404 → clean not-found.
      (args) => client.awaitChannelMessages(ref, args),
      since,
      waitMs,
      runtime,
      selfSessionId,
    );
  } catch (e) {
    // ⚠ POLL 0 IS THE ONLY THROW (`runHold`), so this is the one place a
    // not-found can be told apart from a mid-hold blip.
    if (isNotFound(e)) return channelNotFound(ref);
    throw e;
  }
  const { messages, cursor, elapsedMs, budgetMs, sessions, operatorOnline } = held;
  const seconds = Math.round(elapsedMs / 1000);

  if (messages.length === 0) {
    // ⚠ Elapsed, not the requested budget — a spin-brake exit would otherwise
    // misreport how long anyone actually waited.
    const timedOut = `No new messages in **${ref}** since seq ${cursor} — the wait timed out after about ${seconds}s with nothing arriving.`;
    // ⚠ Inner poll FAILED mid-hold — say what broke BEFORE the CUT SHORT check,
    // or a transient blip is misdiagnosed as a platform clamp and the agent is
    // told to stop waiting on a live exchange.
    if (held.pollError !== null) {
      return ok(
        [
          `The wait on **${ref}** ended early, after about ${seconds}s: an inner poll failed — ${describeFailure(held.pollError)}.`,
          `Nothing was missed, so re-arm NOW, before you end your turn — dopl_channel(op="read", channel="${ref}", since=${cursor}, wait_ms=<ms>).`,
          `If the very next hold fails the same way, stop re-arming and report it to your operator; read the channel with dopl_channel(op="read", channel="${ref}", since=${cursor}) instead.`,
          rearmStopRule(ref),
        ].join("\n"),
      );
    }
    if (wasCutShort(elapsedMs, budgetMs)) {
      return ok(
        [
          timedOut,
          `That hold was CUT SHORT — it asked for about ${Math.round(budgetMs / 1000)}s and returned in ${seconds}s, which usually means the platform is clamping the call (or the server is erroring instantly). A hold this short can never stay pending long enough to wake you.`,
          `Do NOT immediately re-arm — you would loop on short calls that never wake anything. Report this to your operator: the wait is not holding, so replies on this channel have to be checked with dopl_channel(op="read") instead.`,
        ].join("\n"),
      );
    }
    return ok(
      [
        timedOut,
        ...holdTimedOutLines(ref, cursor, runtime),
        // ⚠ RENDERED ON A TIMEOUT TOO, and that is the case it earns most: a
        // hold that came back empty is exactly when an orchestrator has to
        // decide whether the agent it is waiting on is still alive. Answering
        // that used to cost a second call.
        ...sessionBlockLines(sessions, undefined, operatorOnline),
      ].join("\n"),
    );
  }
  // ⚠ Banner moved to CHANNEL_DESCRIPTION's SECURITY paragraph (T11) — a hold
  // renders the same counterparty bodies a page does and is the call an
  // orchestrator makes most, so it drops the repeat for the same reason.
  const lines = [
    `## ${ref} — ${messages.length} new message${messages.length === 1 ? "" : "s"} since seq ${cursor}\n`,
    // ⚠ Framing FIRST — counterparty-written bodies, so the caveat must be read
    // BEFORE them, not as a footnote underneath. ⚠ IT IS NOT DUPLICATED BY THE
    // TOOL DESCRIPTION, and removing it on that belief is exactly how it was
    // lost once (2026-09-02): a description is read at connect time, a body is
    // read now, and only the second one can carry an injected line.
    `${UNTRUSTED_BODY_HEADER}\n`,
  ];
  lines.push(...formatMessages(messages, ref, selfUserId));
  const lastSeq = messages[messages.length - 1].seq;
  // ⚠ A hold is CHANNEL-WIDE and unfiltered: every message wakes every armed
  // listener, including ones addressed elsewhere or to nobody — so a wake is
  // not by itself a reason to act. Stated only when `selfUserId` is known;
  // otherwise the claim would be a guess.
  //
  // ⚠ Predicate runs over messages SOMEONE ELSE wrote. Its premise is "other
  // people wrote things and none names you" — a page of the caller's OWN posts
  // satisfies a naive version and makes the notice absurd. ⚠ AND OWN-ACCOUNT
  // ROWS NOW REACH THIS LINE ON PURPOSE (F-405): a sibling session of the same
  // operator is a counterparty, so nothing upstream keeps them out any more.
  // Filtering on `authorUserId` here is therefore the only thing holding the
  // premise up, and it errs toward SILENCE — a page written entirely by the
  // caller's own account renders no notice rather than a false one.
  if (selfUserId !== null) {
    const namesMe = (m: ChannelMessage) => addresseeOf(m) === selfUserId;
    const foreign = messages.filter((m) => m.authorUserId !== selfUserId);
    if (foreign.length > 0 && !foreign.some(namesMe)) {
      lines.push(`\n${HOLD_UNNAMED_NOTICE}`);
    }
  }
  lines.push(...holdArrivedLines(ref, lastSeq, runtime, rearmStopRule(ref)));
  // ⚠ AFTER the messages and after the re-arm guidance — a block of server
  // narration spliced between counterparty bodies would let a body's last line
  // read as the start of this section.
  lines.push(...sessionBlockLines(sessions, undefined, operatorOnline));
  return ok(lines.join("\n"));
}
