"use strict";
/**
 * `dopl_channel` READ op handlers: list (channels), read (messages), await
 * (long-poll for new messages), list_threads / get_thread. All non-mutating.
 * Routed from the registrar in channel.ts.
 *
 * BOUNDARY: the wire/storage name `task` == the domain name `thread` — the
 * `thread` op param still resolves against `channel_tasks` rows and the
 * `/tasks` routes underneath `@dopl/client`.
 *
 * Every clock that bounds the `await` hold — the poll size, the assembled
 * hold, the env lever, and the deadlines they must fit under — lives in
 * `channel-await-budget.ts`. Read that file before retuning any of them.
 *
 * Every STRING these ops emit — the author labels, the thread renders, the
 * channel lines, and the untrusted-content headers that frame them — lives in
 * `channel-render.ts`. That split is where the peer-authored-text discipline is
 * documented and enforced (Q1); this file is control flow.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.opList = opList;
exports.opRead = opRead;
exports.opAwait = opAwait;
exports.opListThreads = opListThreads;
exports.opGetThread = opGetThread;
const respond_1 = require("./respond");
const channel_shared_1 = require("./channel-shared");
const channel_render_1 = require("./channel-render");
const channel_await_budget_1 = require("./channel-await-budget");
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
function rearmStopRule(ref) {
    return `Keep waiting while the exchange is alive — a peer agent working a real task can be silent for a long stretch. Every ~3 empty holds in a row, check before re-arming: dopl_channel(op="get_thread", channel="${ref}", thread=<id>) for its status, and dopl_channel(op="read", channel="${ref}", since=<your cursor>) for signs of life (peers post task_progress milestones while they work). Keep re-arming while the thread is OPEN and something came from the peer in roughly the last 30 minutes. STOP and report to your operator when the thread is closed or failed, or when the peer has shown nothing at all for ~30+ minutes.`;
}
async function opList(client) {
    const channels = await client.listChannels();
    if (channels.length === 0) {
        return (0, respond_1.ok)('No channels yet. Create one with dopl_channel(op="open", name="...").');
    }
    const lines = [
        `## Channels — ${channels.length}\n`,
        // Q1-A: framing FIRST. This listing renders member-typed names and topics,
        // and a PUBLIC channel puts a stranger's text in front of an agent that
        // never opted into contact with them — in the op the tool description tells
        // it to start with.
        `${channel_render_1.UNTRUSTED_LISTING_HEADER}\n`,
    ];
    for (const c of channels)
        lines.push((0, channel_render_1.formatChannelLine)(c));
    lines.push('\nRead a channel with dopl_channel(op="read", channel=<slug|id>); post with op="post"; watch for new messages with op="await".');
    return (0, respond_1.ok)(lines.join("\n"));
}
async function opRead(client, ref, since, limit) {
    // Hot path — no pre-resolve. The route accepts slug-or-id in the
    // [channelId] segment and enforces visibility itself, so we hand it the
    // caller's ref directly and skip a per-call listChannels() round-trip. A
    // route 404 (unknown ref, or one the caller can't see) maps to a clean
    // not-found; the ref stands in for the channel name in the output.
    let messages;
    try {
        messages = await client.readChannelMessages(ref, { since, limit });
    }
    catch (e) {
        if ((0, respond_1.isNotFound)(e))
            return (0, channel_shared_1.channelNotFound)(ref);
        throw e;
    }
    if (messages.length === 0) {
        const sinceNote = since !== undefined ? ` after seq ${since}` : "";
        return (0, respond_1.ok)(`No messages in **${ref}**${sinceNote}. Watch for new ones with dopl_channel(op="await", channel="${ref}", since=${since ?? 0}).`);
    }
    const lines = [
        `## ${ref} — ${messages.length} message${messages.length === 1 ? "" : "s"}\n`,
        // Framing FIRST — this listing renders counterparty-authored bodies, and a
        // caveat placed under them is read after the injected line it warns about.
        `${channel_render_1.UNTRUSTED_BODY_HEADER}\n`,
    ];
    lines.push(...(0, channel_render_1.formatMessages)(messages, ref));
    const lastSeq = messages[messages.length - 1].seq;
    lines.push(`\nHighest seq shown: ${lastSeq}. Watch for newer messages with dopl_channel(op="await", channel="${ref}", since=${lastSeq}).`);
    return (0, respond_1.ok)(lines.join("\n"));
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
 */
async function opAwait(client, ref, since, timeoutMs) {
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
            `If you are still expecting a reply, re-arm the wait NOW, before you end your turn: dopl_channel(op="await", channel="${ref}", since=${since}) with the SAME since. That call can keep running after your turn ends, and its result will wake you when the reply lands.`,
            rearmStopRule(ref),
        ].join("\n"));
    }
    const lines = [
        `## ${ref} — ${messages.length} new message${messages.length === 1 ? "" : "s"} since seq ${since}\n`,
        // Framing FIRST: the bodies below are counterparty-written, so the caveat
        // has to be read BEFORE them, not as a footnote underneath.
        `${channel_render_1.UNTRUSTED_BODY_HEADER}\n`,
    ];
    lines.push(...(0, channel_render_1.formatMessages)(messages, ref));
    const lastSeq = messages[messages.length - 1].seq;
    lines.push(`\nAdvance your cursor to seq ${lastSeq}. If the exchange is still open, re-arm before you end your turn: dopl_channel(op="await", channel="${ref}", since=${lastSeq}) — that pending call is what wakes you with the next message.`, rearmStopRule(ref));
    return (0, respond_1.ok)(lines.join("\n"));
}
async function opListThreads(client, ref) {
    // Hot-path parity with read/await: hand the ref straight to the route
    // (slug-or-id + visibility enforced there) and map a 404 to a clean
    // not-found, rather than pre-resolving via listChannels.
    let threads;
    try {
        threads = await client.listChannelThreads(ref);
    }
    catch (e) {
        if ((0, respond_1.isNotFound)(e))
            return (0, channel_shared_1.channelNotFound)(ref);
        throw e;
    }
    if (threads.length === 0) {
        return (0, respond_1.ok)(`No threads in **${ref}**. Open one with dopl_channel(op="create_thread", channel="${ref}", title="...", body="...", to="...").`);
    }
    const lines = [
        `## ${ref} — ${threads.length} thread${threads.length === 1 ? "" : "s"}\n`,
        // Q1-B: framing FIRST. Titles and outcome summaries below are peer-typed,
        // and `listChannelTasks` is channel-transparent — every member of the
        // channel receives every thread's text, not just their own.
        `${channel_render_1.UNTRUSTED_THREAD_HEADER}\n`,
    ];
    for (const t of threads)
        lines.push((0, channel_render_1.formatThreadLine)(t));
    lines.push(`\nInspect one with dopl_channel(op="get_thread", channel="${ref}", thread=<id>); read its messages with op="read".`);
    return (0, respond_1.ok)(lines.join("\n"));
}
async function opGetThread(client, ref, threadId) {
    let thread;
    try {
        thread = await client.getChannelThread(ref, threadId);
    }
    catch (e) {
        // The route 404s both an unknown channel ref and a thread not in this
        // channel; surface a thread-oriented not-found either way.
        if ((0, respond_1.isNotFound)(e)) {
            return (0, respond_1.err)(`No thread \`${threadId}\` in **${ref}**. List a channel's threads with dopl_channel(op="list_threads", channel="${ref}").`);
        }
        throw e;
    }
    // Q1-C: framing FIRST, above the `## Thread <title>` heading rather than
    // under it. The product tells a waiting agent to call this op every ~3 empty
    // holds, so it is a peer-typed title an agent re-reads on a timer.
    return (0, respond_1.ok)(`${channel_render_1.UNTRUSTED_THREAD_HEADER}\n\n${(0, channel_render_1.formatThreadDetail)(thread)}`);
}
