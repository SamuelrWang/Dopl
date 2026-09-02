"use strict";
/**
 * THE HEALTH CLAUSES OF A SESSION LINE — "is this agent GETTING ANYWHERE",
 * rendered from the seven fields `dopl-desktop-app/main/session-health.js`
 * derives (2026-09-01, server migration `20260909120000`).
 *
 * ⚠ **SPLIT OUT OF `channel-session-render.ts` AT THE 500-LINE CAP** (§2; that
 * file measured 484 before this wave), and the seam is a real one:
 * `channel-session-render.ts` answers "what is this session and may I still call
 * it live" — identity, the staleness hedge, the presence witness — while this
 * answers "is it making progress, and what has been refused to it". They move on
 * different clocks, exactly as `session-metrics.js` and `session-health.js` do on
 * the desktop side. ⚠ `channel-` filename prefix required by the parity
 * split-scan.
 *
 * ── 🔒 THE ONE THING A READER OF THIS FILE MUST NOT CONFLATE ────────────────
 *
 * **THERE ARE TWO FACTS CALLED `stale` IN THIS FEATURE AND THEY ARE NOT THE SAME
 * FACT.**
 *
 *   `channel-session-render.ts › sessionIsStale` — derived HERE on the server
 *     from `updatedAt` against a 90s window. It is about the **REPORT**: nobody
 *     has said anything. The push is change-driven, so this fires on a live
 *     agent that is merely quiet, AND on a desktop that died mid-run. That is
 *     why its treatment is a hedge ("last reported working") and never a claim.
 *
 *   `ChannelSessionHealth.stale` — derived on the MACHINE, and it is about the
 *     **SESSION**: it is `working`, it has said nothing for ten minutes, and it
 *     is STILL SPENDING TOKENS. A live process getting nowhere.
 *
 * A live-but-quiet agent is the first without the second. A crashed machine is
 * the first without the second too — and a WEDGED one is the second WITHOUT the
 * first, because a wedged agent that is still dispatching tools keeps its row
 * perfectly fresh. **Merge them and the surface reports a live-but-quiet agent
 * as dead, or a hung agent as fine.**
 *
 * ⚠ **THE WIRE NAME IS THE DESKTOP'S AND IS NOT RENAMED ON OUR SIDE.** Renaming a
 * reported field is how two trees stop agreeing about what was reported. The
 * separation is carried by the RENDER instead: {@link sessionHealthClauses}
 * never uses the word "stale" — it says **WEDGED**, which is the desktop's own
 * noun for the thing (`session-health.js › isStale`'s docblock asks "IS THIS
 * SESSION WEDGED?") — and the freshness hedge keeps "stale" to itself.
 *
 * ── THE RULES, INHERITED VERBATIM FROM `channel-session-render.ts` ──────────
 *
 * ⚠ **`null` IS UNKNOWN, NEVER ZERO. THERE IS NO `?? 0` IN THIS FILE AND THERE
 * MUST NOT BE.** An absent field renders NOTHING. Printing "0 denied" for a
 * desktop that reported no number states that nothing has been refused to an
 * agent whose every shell call may be being refused silently — which is the
 * precise defect these columns were added to make visible.
 * ⚠ EVERY CLAUSE IS CONDITIONAL, so an older desktop's line is exactly the line
 * it rendered before this wave. No "unknown · unknown · unknown" filler.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.sessionProgressClauses = sessionProgressClauses;
exports.sessionHealthClauses = sessionHealthClauses;
const channel_shared_1 = require("./channel-shared");
const channel_session_units_1 = require("./channel-session-units");
/**
 * THE PROGRESS COUNTERS — turns taken, and spend since this agent last SPOKE.
 *
 * ⚠ **RENDERED BESIDE `tokensSpent`, NOT WITH THE REST OF THE HEALTH SET, AND
 * THE POSITION IS THE POINT.** These two are counters of the same kind as the
 * lifetime spend: a reader comparing "41k tokens" with "+8.7k since it last
 * posted" is doing one piece of arithmetic, and splitting them across the line
 * makes it two. {@link sessionHealthClauses} carries the other five, at the END
 * of the line, for the opposite reason.
 *
 * ⚠ **`tokensDelta` IS "SINCE IT LAST POSTED", NOT "PER TURN", AND THE COPY SAYS
 * SO IN THOSE WORDS.** The baseline is the session's last own-channel post
 * (`main/session-health.js › tokensSinceLastPost`), which is the last thing an
 * orchestrator actually SAW from it — deliberately NOT the row push, which is
 * churn and would answer "tokens spent in the last few seconds". A clause
 * reading "per turn" would be a different number, and an orchestrator dividing
 * by `turns` to get one would be inventing it.
 *
 * ⚠ A MEASURED `0` IS RENDERED. `+0 since it last posted` means "measured, and it
 * has bought nothing since it spoke" — a real answer, and the one case where the
 * delta and the lifetime total visibly disagree. Only `null`/absent print
 * nothing.
 */
function sessionProgressClauses(s) {
    const out = [];
    const turns = s.turns;
    if (turns !== null && turns !== undefined) {
        out.push(`${turns} turn${turns === 1 ? "" : "s"}`);
    }
    const delta = s.tokensDelta;
    if (delta !== null && delta !== undefined) {
        out.push(`+${(0, channel_session_units_1.compactCount)(delta)} since it last posted`);
    }
    return out;
}
/**
 * THE WAKE ACK — what the MACHINE says it did with the last redirect.
 *
 * ⚠ **A REPORT, NEVER A DELIVERY GUARANTEE, AND THE CLAUSE SAYS BOTH HALVES OUT
 * LOUD.** The stamp is taken in `main/session-gate.js › enqueue`, at the moment a
 * wake is QUEUED. It does not say the agent read it, acted on it, or is still
 * running — and an orchestrator that read this as "my redirect landed" would
 * stop waiting on the one case where waiting was the right move. So the words
 * are `QUEUED` and `(reported, not confirmed)`, and neither may be trimmed for
 * length.
 *
 * ⚠ EITHER HALF ALONE STILL RENDERS. A seq with no stamp is still "which
 * redirect", a stamp with no seq is still "there was one"; only both absent is
 * silence.
 */
function wakeClause(s, now) {
    const seq = s.lastWakeSeq;
    const age = (0, channel_session_units_1.ageMs)(s.lastWakeAt, now);
    const hasSeq = seq !== null && seq !== undefined;
    if (!hasSeq && age === null)
        return null;
    // ⚠ THE SEQ IS AN IDENTIFIER, NOT A MAGNITUDE — printed exactly, never through
    // `compactCount`. "wake seq 41.2k" names no message anybody can look up.
    const what = hasSeq ? `wake seq ${seq}` : "a wake";
    const when = age === null ? "" : ` ${(0, channel_session_units_1.coarseAge)(age)} ago`;
    return `${what} QUEUED${when} (reported, not confirmed)`;
}
/**
 * THE DENIAL PAIR — the T25 signal, and the one clause on this line an
 * orchestrator most needs not to skim past.
 *
 * ⚠ **THE DEFECT IT EXISTS FOR:** a windowless session at the `auto` tool floor
 * has every shell call refused SILENTLY. It goes on reporting `working`, goes on
 * spending, and nothing else on the row can say that it is achieving nothing. So
 * the clause is SHOUTED — a `⚠` and an upper-case verb — because it competes for
 * attention with a dozen quiet facts in the same `·`-joined line, and
 * {@link sessionHealthClauses} puts it at the END, where a scan that stops early
 * has not yet had a chance to drop it.
 *
 * ⚠ **THE COUNT AND THE TOOL ARE ONE CLAUSE, NOT TWO.** "4 calls denied" without
 * the tool sends a reader looking; the tool without a count reads as a single
 * hiccup. Either alone still renders — an absent half is dropped from the
 * sentence rather than replaced with filler.
 *
 * ⚠ **A MEASURED `0` RENDERS NOTHING, AND THIS IS NOT THE `null`-is-zero
 * MISTAKE.** Nothing is printed AS a zero and no absence is turned into a
 * measurement; what is declined is an ALARM about a non-event. A `⚠` on every
 * healthy session is the flag everybody learns to ignore — which is strictly
 * worse than no flag, because it hides the real ones (`session-health.js` makes
 * the same argument for its own third condition).
 */
function deniedClause(s) {
    const n = s.deniedCalls;
    const counted = n !== null && n !== undefined;
    const tool = s.lastDeniedTool;
    if (counted && n === 0 && !tool)
        return null;
    if (!counted && !tool)
        return null;
    const head = counted
        ? `⚠ ${n} TOOL CALL${n === 1 ? "" : "S"} DENIED`
        : "⚠ TOOL CALLS DENIED";
    // ⚠ NEUTRALIZED: a tool name can come from the operator's OWN MCP servers, so
    // the charset is not ours to assume, and this is a value spliced into a line WE
    // wrote. A forged line in your own result is still a forged line.
    const last = tool ? ` (last: ${(0, channel_shared_1.inlineOr)(tool, "(unnamed tool)")})` : "";
    return `${head}${last}`;
}
/**
 * THE MACHINE'S OWN WEDGED VERDICT.
 *
 * ⚠ **NEVER THE WORD "STALE".** See this module's header: the freshness hedge
 * owns that word for a fact about the REPORT, and this is a fact about the
 * SESSION. The three conditions are spelled out in the clause itself rather than
 * left to a legend, because the verdict is the machine's and a reader who cannot
 * see what was tested cannot judge it.
 *
 * ⚠ `false` RENDERS NOTHING, and so does absent — but they are different
 * statements ("this machine checked and says no" vs "nothing checked"), and the
 * reason both are silent is that neither is worth a clause: the line already
 * carries the state, and "not wedged" on every healthy session is the filler
 * this file's header refuses.
 */
function wedgedClause(s) {
    if (s.stale !== true)
        return null;
    return "⚠ WEDGED per its own machine — working, silent and still spending";
}
/**
 * THE HEALTH SIGNALS, as clauses — empty array when the row carries none.
 *
 * ⚠ **ORDER IS DELIBERATE AND ENDS ON THE ALARMS.** The wake ack is a neutral
 * fact and goes first; the two things an orchestrator must ACT on close the
 * line, because the end of a `·`-joined line is the position a partial scan
 * still reaches. ⚠ Reached only from an own-scoped render — a peer row is a
 * `ChannelSessionState`, which has none of these fields, so a peer surface that
 * tried to call this would not compile.
 */
function sessionHealthClauses(s, now) {
    return [wakeClause(s, now), deniedClause(s), wedgedClause(s)].filter((c) => c !== null);
}
