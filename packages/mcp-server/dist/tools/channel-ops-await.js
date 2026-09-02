"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.rearmStopRule = rearmStopRule;
exports.opAwait = opAwait;
const respond_1 = require("./respond");
const channel_shared_1 = require("./channel-shared");
const channel_render_1 = require("./channel-render");
const channel_await_budget_1 = require("./channel-await-budget");
// ⚠ Addressing rule has ONE statement, in channel-addressing.ts.
const channel_addressing_1 = require("./channel-addressing");
// ⚠ Whether a pending call may be promised to outlive the turn is ONE decision
// in ONE module, from the caller's observed runtime.
const channel_wake_guidance_1 = require("./channel-wake-guidance");
// ⚠ The session block and every rule inside it (the staleness hedge, the
// operator-only telemetry, `undefined` vs `[]`) have ONE statement, shared with
// `read_sessions` — see channel-session-render.ts.
const channel_session_render_1 = require("./channel-session-render");
/** Read once at module load — one value per server process, no per-call env read. */
const AWAIT_HOLD_MS = (0, channel_await_budget_1.resolveAwaitHoldMs)(process.env.DOPL_AWAIT_HOLD_MS);
const AWAIT_HOLD_CEILING_MS = (0, channel_await_budget_1.resolveAwaitHoldCeilingMs)(process.env.DOPL_AWAIT_HOLD_MS);
/** Don't re-issue an inner poll for a sliver of the remaining budget. */
const AWAIT_MIN_POLL_MS = 1_000;
/**
 * ⚠ Spin brake, NOT the bound — elapsed wall-clock ends the hold. Bites only
 * when the server answers instantly (route error path, clamped timeout), where
 * the elapsed check alone lets the loop hammer it. Tripping returns the
 * ordinary timed-out result.
 */
const AWAIT_MAX_POLLS = Math.ceil(AWAIT_HOLD_CEILING_MS / channel_await_budget_1.AWAIT_POLL_MS) + 2;
/**
 * A hold ending this far under the ASK did not hold — something cut it short
 * (platform function clamp, route answering instantly, inner failure). ⚠
 * Re-arming into that is a spin: each attempt returns in seconds, so the call
 * never stays pending past the ~2 min backgrounding mark and never becomes a
 * wake. Half the ask, capped at 60s, so a deliberately SHORT hold is not warned
 * about getting one.
 */
const AWAIT_SHORT_HOLD_MS = 60_000;
/**
 * A thrown inner-poll failure reduced to one short line — this rides inside a
 * result a model reads, and a full API body buries the re-arm instruction.
 *
 * ⚠ NEUTRALIZED, not just shortened: this result splices upstream text OUTSIDE
 * {@link UNTRUSTED_BODY_HEADER}'s framing, and "our own server's error" says
 * nothing about its CONTENT — a 400 echoing a rejected field, a proxy page, or
 * a not-found naming a counterparty ref all carry influenced text, read as
 * server narration in an unframed line.
 */
function describeFailure(e) {
    let raw;
    if (e instanceof Error)
        raw = e.message;
    else if (typeof e === "string")
        raw = e;
    else {
        try {
            raw = JSON.stringify(e) ?? String(e);
        }
        catch {
            raw = String(e);
        }
    }
    return (0, channel_shared_1.neutralizeInline)(raw) ?? "`no detail reported`";
}
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
function rearmStopRule(ref) {
    return `Keep waiting while the exchange is alive — an agent working a real task can be silent for a long stretch. Every ~3 empty holds in a row, check before re-arming: dopl_channel(op="read", channel="${ref}", since=<your cursor>) for signs of life (a working agent posts task_progress milestones). Judge that ONLY on the member you are waiting on — the one you addressed. In a channel with other members, traffic between THEM is not evidence your exchange is alive. Keep re-arming while something came from that member in roughly the last 30 minutes. STOP and report to your operator when nothing at all has come from that member for ~30+ minutes. There is no finished STATE to wait for — a thread never closes — so silence from the member you addressed is the only stop signal there is.`;
}
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
async function opAwait(client, ref, since, timeoutMs, selfUserId = null, runtime = null, selfSessionId = null) {
    // Default = AWAIT_HOLD_MS; an EXPLICIT ask may reach the ceiling.
    const holdMs = Math.min(timeoutMs ?? AWAIT_HOLD_MS, AWAIT_HOLD_CEILING_MS);
    // ⚠ Loop bound is ELAPSED time, never a call count — an inner poll returning
    // early (or clamped by the route) shortens that iteration, not the hold.
    const startedAt = Date.now();
    const deadline = startedAt + holdMs;
    let messages = [];
    // ⚠ THE OWN-SESSION SNAPSHOT the route attaches AT RETURN TIME (2026-08-22).
    // `undefined` until a hold actually answers, and it stays `undefined` if the
    // server never sent the key — an older deployment, or a session read that
    // failed behind an otherwise-good hold. **`undefined` and `[]` are different
    // answers** and the renderer treats them as such; never normalize one to the
    // other here.
    // ⚠ LAST WRITER WINS, deliberately: the inner poll loop re-issues, and the
    // freshest snapshot is the one from the call that ended the hold.
    let sessions;
    // ⚠ THE CALLER'S OWN MACHINE, FROM THE SAME SNAPSHOT (2026-08-23, F-294) — so
    // a quiet row under a live heartbeat renders "quiet Xm" instead of accusing
    // the desktop of being offline. It MOVES WITH `sessions` and only with it: the
    // route emits both keys or neither, and carrying one forward from an older
    // poll would pair a fresh row set with a stale liveness answer.
    let operatorOnline;
    // What ended the hold when it was an inner failure rather than the clock, so
    // the result can NAME it: "the wait timed out" after a socket reset is not
    // actionable.
    let pollError = null;
    // ⚠ THE CURSOR THE CALLER SHOULD RESUME FROM, which is `since` for the whole
    // hold EXCEPT when own-session rows were dropped — see `dropOwnSession`.
    let cursor = since;
    for (let poll = 0; poll < AWAIT_MAX_POLLS; poll++) {
        const remaining = deadline - Date.now();
        // ⚠ Always make the first call — a `timeout_ms=0` caller wants one
        // immediate check. Stop re-issuing once the leftover budget is a sliver.
        if (poll > 0 && remaining < AWAIT_MIN_POLL_MS)
            break;
        // Hot path (inside a listener's poll loop, so the saved round-trip compounds
        // per cycle): ref straight through, route 404 → clean not-found.
        let result;
        try {
            result = await client.awaitChannelMessages(ref, {
                since: cursor,
                // ⚠ Floored at 1ms, not 0 — the route's query schema requires a POSITIVE
                // timeout, so a `timeout_ms=0` caller would 400 instead of getting its check.
                timeoutMs: Math.max(1, Math.min(channel_await_budget_1.AWAIT_POLL_MS, remaining)),
                // 🔒 **THE SELF-ECHO FILTER IS SESSION-SCOPED NOW, NOT ACCOUNT-SCOPED**
                // (F-341). An await waits for a COUNTERPARTY: posting a `task_progress`
                // milestone after arming must not pop the agent's own hold on its own
                // echo. `excludeAuthor` did that by ACCOUNT — and every post, human or
                // agent, is authored by the account (`service-writes.ts:448`), while one
                // operator runs many concurrent sessions. So an orchestrator and its
                // worker, both agents of the same person, could never see each other
                // here: the row was filtered out of BOTH the page and the existence
                // probe (`repository-messages.ts:98,143`), so the hold did not even
                // spin — it held silently to the deadline while the answer sat in the
                // table. `op="read"` never applied the filter, which is why a read
                // showed exactly what the await swore was not there.
                //
                // When this session can NAME ITSELF we send no author filter at all and
                // drop only our own lines below, keyed on `metadata.session_id`. That is
                // strictly narrower: a sibling session, and the operator's own typing,
                // both become visible again.
                //
                // ⚠ THE OLD BEHAVIOUR IS THE FALLBACK, on purpose. With no session
                // stamp (every external client, and an older desktop build) there is
                // nothing finer than the account to key on, so excluding it is still the
                // best available answer and this population sees no change.
                ...(selfSessionId === null && selfUserId !== null
                    ? { excludeAuthor: selfUserId }
                    : {}),
            });
        }
        catch (e) {
            if ((0, respond_1.isNotFound)(e))
                return (0, channel_shared_1.channelNotFound)(ref);
            // ⚠ A transient failure MID-HOLD must not destroy the hold: propagating
            // it gives the agent a transport error instead of the timed-out result,
            // losing all the re-arm teaching. Poll 0 still throws — nothing is
            // established yet, so the error IS the honest answer.
            if (poll === 0)
                throw e;
            pollError = e;
            break;
        }
        if (result.sessions !== undefined) {
            sessions = result.sessions;
            operatorOnline = result.operatorOnline;
        }
        if (result.messages.length > 0) {
            // ⚠ OUR OWN LINES, DROPPED HERE RATHER THAN IN SQL — the page is already
            // in hand and `session_id` is on it, so this needs no new query param and
            // no new predicate interpolated into PostgREST's `or` grammar (a session
            // id is not a uuid; it may carry `.` and `:`, which are that grammar's
            // separators). With no session stamp nothing is dropped, because the
            // account filter above already did it server-side.
            const fresh = selfSessionId === null
                ? result.messages
                : result.messages.filter((m) => (0, channel_render_1.sessionIdOf)(m) !== selfSessionId);
            if (fresh.length > 0) {
                messages = fresh;
                break;
            }
            // ⚠ EVERY ROW WAS OUR OWN ECHO, so keep holding — but ADVANCE PAST THEM
            // first. Re-issuing on the same cursor would re-fetch the same rows on
            // every tick and burn the whole budget in milliseconds (the spin
            // `repository-messages.ts:140-142` warns about), which then trips the CUT
            // SHORT branch and tells the agent the platform is broken.
            //
            // ⚠ SAFE BECAUSE OF WHAT IT SKIPS: only rows THIS SESSION WROTE, which
            // the caller already knows about by definition. Every counterparty row is
            // returned above before the cursor ever moves, so nothing anyone else said
            // can be stepped over. This is the ONE thing that may advance a cursor
            // mid-hold, and it is why `cursor` exists separately from `since`.
            cursor = result.messages[result.messages.length - 1].seq;
        }
    }
    if (messages.length === 0) {
        const elapsedMs = Date.now() - startedAt;
        // ⚠ Elapsed, not the requested budget — a spin-brake exit would otherwise
        // misreport how long anyone actually waited.
        const timedOut = `No new messages in **${ref}** since seq ${cursor} — the wait timed out after about ${Math.round(elapsedMs / 1000)}s with nothing arriving.`;
        // ⚠ Inner poll FAILED mid-hold — say what broke BEFORE the CUT SHORT check,
        // or a transient blip is misdiagnosed as a platform clamp and the agent is
        // told to stop waiting on a live exchange.
        if (pollError !== null) {
            return (0, respond_1.ok)([
                `The wait on **${ref}** ended early, after about ${Math.round(elapsedMs / 1000)}s: an inner poll failed — ${describeFailure(pollError)}.`,
                `Nothing was missed, so re-arm NOW, before you end your turn — dopl_channel(op="await", channel="${ref}", since=${cursor}).`,
                `If the very next hold fails the same way, stop re-arming and report it to your operator; read the channel with dopl_channel(op="read", channel="${ref}", since=${cursor}) instead.`,
                rearmStopRule(ref),
            ].join("\n"));
        }
        // Hold came back far under the ask, so re-arming would spin — see
        // AWAIT_SHORT_HOLD_MS. Half the ask, capped at 60s.
        if (elapsedMs < Math.min(AWAIT_SHORT_HOLD_MS, holdMs / 2)) {
            return (0, respond_1.ok)([
                timedOut,
                `That hold was CUT SHORT — it asked for about ${Math.round(holdMs / 1000)}s and returned in ${Math.round(elapsedMs / 1000)}s, which usually means the platform is clamping the call (or the server is erroring instantly). A hold this short can never stay pending long enough to wake you.`,
                `Do NOT immediately re-arm — you would loop on short calls that never wake anything. Report this to your operator: the wait is not holding, so replies on this channel have to be checked with dopl_channel(op="read") instead.`,
            ].join("\n"));
        }
        return (0, respond_1.ok)([
            timedOut,
            ...(0, channel_wake_guidance_1.awaitTimedOutLines)(ref, cursor, runtime, rearmStopRule(ref)),
            // ⚠ RENDERED ON A TIMEOUT TOO, and that is the case it earns most: a
            // hold that came back empty is exactly when an orchestrator has to
            // decide whether the agent it is waiting on is still alive. Answering
            // that used to cost a second call.
            ...(0, channel_session_render_1.sessionBlockLines)(sessions, undefined, operatorOnline),
        ].join("\n"));
    }
    const lines = [
        `## ${ref} — ${messages.length} new message${messages.length === 1 ? "" : "s"} since seq ${cursor}\n`,
        // ⚠ Framing FIRST — counterparty-written bodies, so the caveat must be read
        // BEFORE them, not as a footnote underneath. ⚠ IT IS NOT DUPLICATED BY THE
        // TOOL DESCRIPTION, and removing it on that belief is exactly how it was
        // lost once (2026-09-02): a description is read at connect time, a body is
        // read now, and only the second one can carry an injected line.
        `${channel_render_1.UNTRUSTED_BODY_HEADER}\n`,
    ];
    lines.push(...(0, channel_render_1.formatMessages)(messages, ref, selfUserId));
    const lastSeq = messages[messages.length - 1].seq;
    // ⚠ `await` is CHANNEL-WIDE and unfiltered: every message wakes every armed
    // listener, including ones addressed elsewhere or to nobody — so a wake is
    // not by itself a reason to act. Stated only when `selfUserId` is known;
    // otherwise the claim would be a guess.
    //
    // ⚠ Predicate runs over messages SOMEONE ELSE wrote. Its premise is "other
    // people wrote things and none names you" — a page of the caller's OWN posts
    // satisfies a naive version and makes the notice absurd. Defense in depth
    // (`excludeAuthor` should keep own posts out), but the notice must be
    // false-free on whatever it is handed.
    if (selfUserId !== null) {
        const namesMe = (m) => (0, channel_render_1.addresseeOf)(m) === selfUserId;
        const foreign = messages.filter((m) => m.authorUserId !== selfUserId);
        if (foreign.length > 0 && !foreign.some(namesMe)) {
            lines.push(`\n${channel_addressing_1.AWAIT_UNNAMED_NOTICE}`);
        }
    }
    lines.push(...(0, channel_wake_guidance_1.awaitArrivedLines)(ref, lastSeq, runtime, rearmStopRule(ref)));
    // ⚠ AFTER the messages and after the re-arm guidance — a block of server
    // narration spliced between counterparty bodies would let a body's last line
    // read as the start of this section.
    lines.push(...(0, channel_session_render_1.sessionBlockLines)(sessions, undefined, operatorOnline));
    return (0, respond_1.ok)(lines.join("\n"));
}
