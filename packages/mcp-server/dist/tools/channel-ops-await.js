"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.rearmStopRule = rearmStopRule;
exports.opAwait = opAwait;
const respond_1 = require("./respond");
const channel_shared_1 = require("./channel-shared");
const channel_render_1 = require("./channel-render");
const channel_await_budget_1 = require("./channel-await-budget");
// The addressing rule has ONE statement, in one module — see
// channel-addressing.ts for what each half of it is verified against.
const channel_addressing_1 = require("./channel-addressing");
// Whether this tool may promise that a pending call outlives the turn is ONE
// decision, made in ONE module, from the caller's observed runtime.
const channel_wake_guidance_1 = require("./channel-wake-guidance");
/** Read once at module load — one value per server process, no per-call env read. */
const AWAIT_HOLD_MS = (0, channel_await_budget_1.resolveAwaitHoldMs)(process.env.DOPL_AWAIT_HOLD_MS);
const AWAIT_HOLD_CEILING_MS = (0, channel_await_budget_1.resolveAwaitHoldCeilingMs)(process.env.DOPL_AWAIT_HOLD_MS);
/** Don't re-issue an inner poll for a sliver of the remaining budget. */
const AWAIT_MIN_POLL_MS = 1_000;
/**
 * Spin brake, NOT the bound. Elapsed wall-clock is what ends the hold; this
 * only bites if the server starts answering instantly (a route error path, a
 * clamped timeout), where the elapsed check alone would let the loop hammer it
 * for the rest of the hold. Tripping it returns the ordinary timed-out result,
 * which tells the caller to re-arm.
 */
const AWAIT_MAX_POLLS = Math.ceil(AWAIT_HOLD_CEILING_MS / channel_await_budget_1.AWAIT_POLL_MS) + 2;
/**
 * A hold that ends this far under what was ASKED for did not hold — something
 * cut it short (a platform function clamp, a route answering instantly, an
 * inner failure). Re-arming into that is a spin: each attempt returns in
 * seconds, so the call never stays pending past the ~2 minute backgrounding
 * mark and never becomes a wake. The timed-out text says so and tells the agent
 * to report instead of re-arming. Half the ask (capped at 60s) so a caller who
 * deliberately asked for a SHORT hold isn't warned about getting one.
 */
const AWAIT_SHORT_HOLD_MS = 60_000;
/**
 * When to keep waiting and when to STOP. "Re-arm on timeout" with no exit is an
 * unbounded loop over an abandoned exchange — but a plain timeout COUNTER is
 * the wrong exit: a peer agent doing real work is legitimately silent for 20+
 * minutes, and three empty holds is only ~12. So the condition is the THREAD's
 * state (open? any peer activity lately?), checked periodically, not a tally of
 * how many times we waited.
 */
/**
 * A thrown inner-poll failure, reduced to one short line. Collapsed to a single
 * line and truncated because this rides inside a result a model reads: the
 * useful part is WHICH failure, and a full API body (or a stack) buries the
 * re-arm instruction that follows it.
 *
 * FIX L5 — NEUTRALIZED, NOT JUST SHORTENED. This result splices upstream text
 * OUTSIDE {@link UNTRUSTED_BODY_HEADER}'s framing, and "it is our own server's
 * error" is not a guarantee about its CONTENT: a 400 echoing a rejected field, a
 * proxy page, or a not-found naming a counterparty-supplied ref can all carry
 * text an attacker influenced. Inside an unframed line that text is read as
 * narration by the server. {@link neutralizeInline} is what makes it read as a
 * value instead — everything below it is only turning a thrown `unknown` into
 * the string that helper takes.
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
 * N-PARTY — "the peer" was undefined and unevaluable in a channel with more
 * than two members, and evaluating it loosely is worse than not stating it: a
 * five-member channel always has SOMEONE posting, so "any activity in the last
 * 30 minutes" keeps an agent re-arming forever over an exchange its own
 * counterparty abandoned. The condition is therefore scoped to the member the
 * caller is waiting on — the one it addressed, which it knows and this module
 * does not.
 */
function rearmStopRule(ref) {
    return `Keep waiting while the exchange is alive — an agent working a real task can be silent for a long stretch. Every ~3 empty holds in a row, check before re-arming: dopl_channel(op="get_thread", channel="${ref}", thread=<id>) for its status, and dopl_channel(op="read", channel="${ref}", since=<your cursor>) for signs of life (a working agent posts task_progress milestones). Judge that ONLY on the member you are waiting on — the one you addressed. In a channel with other members, traffic between THEM is not evidence your exchange is alive. Keep re-arming while the thread is OPEN and something came from that member in roughly the last 30 minutes. STOP and report to your operator when the thread is closed or failed, or when that member has shown nothing at all for ~30+ minutes.`;
}
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
async function opAwait(client, ref, since, timeoutMs, selfUserId = null, runtime = null) {
    // Default = AWAIT_HOLD_MS; an EXPLICIT ask may go up to the ceiling (the cap,
    // or the env lever's value when the lever is set — see resolveAwaitHoldCeilingMs).
    const holdMs = Math.min(timeoutMs ?? AWAIT_HOLD_MS, AWAIT_HOLD_CEILING_MS);
    // Wall-clock deadline read once. The loop bound is ELAPSED time, never a
    // call count — an inner poll that returns early (or is clamped short by the
    // route) shortens that iteration, not the hold.
    const startedAt = Date.now();
    const deadline = startedAt + holdMs;
    let messages = [];
    // Q9: what ended the hold, when it was an inner failure rather than the
    // clock. Kept so the result can NAME it — "something failed, here is how to
    // continue" is actionable, "the wait timed out" after a socket reset is not.
    let pollError = null;
    for (let poll = 0; poll < AWAIT_MAX_POLLS; poll++) {
        const remaining = deadline - Date.now();
        // Always make the first call (a `timeout_ms=0` caller wants one immediate
        // check); stop re-issuing once the leftover budget is a sliver.
        if (poll > 0 && remaining < AWAIT_MIN_POLL_MS)
            break;
        // Hot path — same rationale as opRead, and this one runs inside a
        // listener's poll loop, so the saved round-trip compounds per cycle. Pass
        // the ref straight through; map a route 404 to a clean not-found.
        let result;
        try {
            result = await client.awaitChannelMessages(ref, {
                since,
                // Floored at 1ms, not 0: the route's query schema requires a POSITIVE
                // timeout, so a `timeout_ms=0` caller (one immediate check) would
                // otherwise 400 instead of getting their check.
                timeoutMs: Math.max(1, Math.min(channel_await_budget_1.AWAIT_POLL_MS, remaining)),
                // An MCP await waits for a COUNTERPARTY by definition, so the caller's
                // own account is always excluded: without this, posting a
                // `task_progress` milestone after arming pops the agent's own hold on
                // its own echo. It also drops a SIBLING session on this account —
                // intended, that traffic is "own" from the channel's point of view.
                // Null id (the boot handshake could not name the caller) => no filter,
                // i.e. the pre-fix behavior rather than a guessed one.
                ...(selfUserId !== null ? { excludeAuthor: selfUserId } : {}),
            });
        }
        catch (e) {
            if ((0, respond_1.isNotFound)(e))
                return (0, channel_shared_1.channelNotFound)(ref);
            // FIX M4 — a transient failure MID-HOLD must not destroy the hold. The
            // first poll still throws (nothing has been established yet, and the
            // error is the honest answer to "can I watch this channel?"), but once
            // the hold is underway a blip on poll 3 of 5 used to propagate as an MCP
            // error: the agent got a transport failure instead of the timed-out
            // result, and with it none of the re-arm teaching — the exchange simply
            // stopped. Break to the timed-out branch instead: the elapsed number
            // stays honest and the caller is told how to continue.
            if (poll === 0)
                throw e;
            pollError = e;
            break;
        }
        if (result.messages.length > 0) {
            messages = result.messages;
            break;
        }
    }
    if (messages.length === 0) {
        const elapsedMs = Date.now() - startedAt;
        // Elapsed, not the requested budget: if the spin brake ended the hold
        // early, saying "215s" would misreport how long anyone actually waited.
        const timedOut = `No new messages in **${ref}** since seq ${since} — the wait timed out after about ${Math.round(elapsedMs / 1000)}s with nothing arriving.`;
        // Q9 — an inner poll FAILED mid-hold. Say what broke: the old text called
        // this a timeout, and (when it happened early) routed it into the CUT
        // SHORT branch, which misdiagnoses a transient blip as a platform clamp
        // and tells the agent to stop waiting on a live exchange.
        if (pollError !== null) {
            return (0, respond_1.ok)([
                `The wait on **${ref}** ended early, after about ${Math.round(elapsedMs / 1000)}s: an inner poll failed — ${describeFailure(pollError)}.`,
                `Nothing was missed: the cursor never advanced, so re-arm NOW, before you end your turn, with the SAME since — dopl_channel(op="await", channel="${ref}", since=${since}).`,
                `If the very next hold fails the same way, stop re-arming and report it to your operator; read the channel with dopl_channel(op="read", channel="${ref}", since=${since}) instead.`,
                rearmStopRule(ref),
            ].join("\n"));
        }
        // FIX M5 — the hold came back far under what was asked for, so re-arming
        // would spin (see AWAIT_SHORT_HOLD_MS). Half the ask, capped at 60s.
        if (elapsedMs < Math.min(AWAIT_SHORT_HOLD_MS, holdMs / 2)) {
            return (0, respond_1.ok)([
                timedOut,
                `That hold was CUT SHORT — it asked for about ${Math.round(holdMs / 1000)}s and returned in ${Math.round(elapsedMs / 1000)}s, which usually means the platform is clamping the call (or the server is erroring instantly). A hold this short can never stay pending long enough to wake you.`,
                `Do NOT immediately re-arm — you would loop on short calls that never wake anything. Report this to your operator: the wait is not holding, so replies on this channel have to be checked with dopl_channel(op="read") instead.`,
            ].join("\n"));
        }
        return (0, respond_1.ok)([
            timedOut,
            ...(0, channel_wake_guidance_1.awaitTimedOutLines)(ref, since, runtime, rearmStopRule(ref)),
        ].join("\n"));
    }
    const lines = [
        `## ${ref} — ${messages.length} new message${messages.length === 1 ? "" : "s"} since seq ${since}\n`,
        // Framing FIRST: the bodies below are counterparty-written, so the caveat
        // has to be read BEFORE them, not as a footnote underneath.
        `${channel_render_1.UNTRUSTED_BODY_HEADER}\n`,
    ];
    // A page that named an agent used to cost a conditional roster read here,
    // serving both the handles the lines rendered and the ownership the
    // unnamed-notice predicate needed. Both are gone (channels rollback §1).
    lines.push(...(0, channel_render_1.formatMessages)(messages, ref, selfUserId));
    const lastSeq = messages[messages.length - 1].seq;
    // N-PARTY — `await` is CHANNEL-WIDE and unfiltered: every message wakes every
    // armed listener, including one addressed to a different member or to nobody.
    // That is correct (a filtered await would miss the messages an agent needs to
    // follow), but it means a wake is not by itself a reason to act. Said only
    // when we can actually tell — with no `selfUserId` the claim would be a guess.
    //
    // The CONDITION is "nothing here names me", which is all this op can decide
    // without a round-trip; what the notice SAYS no longer treats that as "none of
    // this is yours", because the canonical reply in this product is unaddressed.
    // See AWAIT_UNNAMED_NOTICE.
    //
    // ...over the messages SOMEONE ELSE wrote. The notice's premise is "other
    // people wrote things, and none of them names you" — a page of the caller's
    // OWN posts satisfies the old predicate while making the notice absurd, and
    // that is what shipped: it fired on a page holding one message, the caller's
    // own, addressed to the peer, and told the agent "NONE of the messages above
    // NAMES you" about its own request. Defense in depth — `opAwait` already
    // passes `excludeAuthor`, so own posts should not reach here at all — but the
    // notice must be false-free on whatever it is handed.
    //
    // AN AGENT ADDRESS USED TO COUNT AS A NAMING TOO. The server stamped
    // `to_user_id` from the FIRST addressed agent's owner, so "@quartz @onyx work
    // on X" named onyx's owner nowhere in that field, and this predicate had to
    // read `to_agent_ids` and the caller's own agent ids beside it. Named-agent
    // addressing is gone (channels rollback §1), so `to_user_id` is the whole
    // address again and the roster read that fed the second half is gone with it.
    if (selfUserId !== null) {
        const namesMe = (m) => (0, channel_render_1.addresseeOf)(m) === selfUserId;
        const foreign = messages.filter((m) => m.authorUserId !== selfUserId);
        if (foreign.length > 0 && !foreign.some(namesMe)) {
            lines.push(`\n${channel_addressing_1.AWAIT_UNNAMED_NOTICE}`);
        }
    }
    lines.push(...(0, channel_wake_guidance_1.awaitArrivedLines)(ref, lastSeq, runtime, rearmStopRule(ref)));
    return (0, respond_1.ok)(lines.join("\n"));
}
