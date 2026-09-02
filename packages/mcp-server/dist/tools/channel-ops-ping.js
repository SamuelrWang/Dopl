"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.opPing = opPing;
exports.opReadPings = opReadPings;
const respond_1 = require("./respond");
const respond_2 = require("./respond");
const channel_shared_1 = require("./channel-shared");
const narration_1 = require("./narration");
const channel_ops_direct_1 = require("./channel-ops-direct");
const channel_errors_1 = require("./channel-errors");
const channel_render_1 = require("./channel-render");
/**
 * THE "NEEDS YOU" SIGNAL — `op="ping"` and `op="pings"` (2026-09-01,
 * `docs/specs/needs-you-ping.md`).
 *
 * ⚠ **A PING IS NOT A POST AND MUST NEVER BECOME ONE.** It reaches ONE recipient,
 * it does not fan out to the room, it cannot end an `await`, and its `seq` is its
 * own cursor space. That is why it exists: an agent that FINISHED had no
 * instrument at all — an unaddressed post starts nobody (the loop brake), and an
 * addressed one shouts at a whole channel and triggers a machine.
 *
 * 🔒 **THERE IS NO ARGUMENT FOR WHOSE MACHINE.** The two self-scoped recipient
 * forms resolve to the authenticated caller's own operator, server-side, and that
 * absence is the whole loop brake on this lane: you cannot ping another member's
 * agent because there is nothing to say it with. Asserted in `channel-ping.test.ts`.
 */
/** ⚠ MIRRORS `MAX_PING_BODY` in `src/features/channels/constants.ts` and the
 *  column CHECK. Restated rather than imported for `channel-ops-escalate.ts`'s
 *  reason: the schema's copy is what an MCP client validates against, and THIS
 *  copy is what the refusal SENTENCE is built from. `channel-schema-caps.test.ts`
 *  is where the two are held equal. */
const MAX_PING_BODY = 600;
const NO_NAME = "(unnamed)";
/** What a ping row's recipient means, as one phrase a reader can act on. ⚠ The
 *  KEY crosses the wire, the SENTENCE is written here — `channel-ops-direct.ts ›
 *  REFUSAL_SENTENCES`' split, for the same reason. */
const NEXT_STEP = {
    desktop: "It is now in your operator's own external session's inbox — the one holding a ping wait open — so it arrives there without them asking for it.",
    agent: "If that agent is live on this channel, this WOKE it. If it is not, nothing was woken and the ping stands in the inbox — which is the honest outcome, not a failure.",
    member: 'It is in that person\'s "Needs you" inbox. ⚠ Unlike an addressed post it did NOT trigger their machine and started no agent — it waits to be read, which is the point of sending one.',
};
/** ⚠ THE ONE PLACE THE THREE RECIPIENT FORMS ARE COUNTED. Zero is a signal with
 *  nowhere to go and two would make the server pick — and a silently-dropped
 *  address is the invisible-delivery failure this surface refuses everywhere.
 *  The count is IN the sentence: a caller that sent two cannot otherwise tell
 *  which one would have been honoured. */
function recipientOr(opts) {
    const given = [
        opts.to !== undefined && opts.to !== "",
        opts.toDesktop === true,
        opts.agentId !== undefined && opts.agentId !== "",
    ].filter(Boolean).length;
    if (given === 0) {
        return (0, respond_1.err)('op="ping" needs exactly one recipient and got none. Pick the one that matches who has to act: to_desktop=true reaches YOUR OWN operator\'s external session, agent_id="<handle>" reaches one of your own operator\'s running agents, to="<member>" reaches another person on this channel.');
    }
    if (given > 1) {
        return (0, respond_1.err)(`op="ping" takes exactly one recipient and got ${given}. Send to_desktop, agent_id or to — never more than one, because there is no rule for which of them would win.`);
    }
    if (opts.toDesktop === true)
        return { toDesktop: true };
    if (opts.agentId !== undefined && opts.agentId !== "") {
        return { agentId: (0, channel_ops_direct_1.bareAgentId)(opts.agentId) };
    }
    return { to: opts.to };
}
/**
 * SEND ONE PING.
 *
 * The canonical write-op order — pre-call refusals, resolve, call, classify 4xx,
 * render — and the body cap is checked BEFORE any round-trip so "nothing was
 * sent" is trivially true rather than confusable with a delivery failure.
 */
async function opPing(client, channelRef, kind, body, opts) {
    if (body.length > MAX_PING_BODY) {
        return (0, respond_1.err)(`A ping body is capped at ${MAX_PING_BODY} characters and yours is ${body.length}. That bound is the point of the op: a ping is a SIGNAL, and the thread you point at is where the report goes. Post the detail with op="post" (thread=<id>), then ping one line pointing at it.`);
    }
    const recipient = recipientOr(opts);
    if ("content" in recipient)
        return recipient;
    // ⚠ PRE-RESOLVED, like the direct and launch ops and unlike the hot read
    // paths: this op is cold — one call, no hold — and the result names the
    // channel back to the caller.
    const channel = await (0, channel_shared_1.resolveChannelOr)(client, channelRef);
    if ((0, channel_shared_1.isErr)(channel))
        return channel;
    const label = (0, channel_shared_1.inlineOr)(channel.name, NO_NAME);
    let ping;
    try {
        ping = await client.createPing({
            channel: channel.id,
            kind,
            body,
            ...(opts.thread === undefined ? {} : { threadId: opts.thread }),
            ...recipient,
        });
    }
    catch (e) {
        if ((0, respond_2.isNotFound)(e))
            return (0, channel_shared_1.channelNotFound)(channelRef);
        if ((0, channel_errors_1.isBadRequest)(e)) {
            // ⚠ READ OFF THE ERROR CODE, never guessed from the status — the doctrine
            // `channel-errors.ts` states. An unrecognized 400 falls through to the
            // server's own neutralized detail rather than to a confident wrong reason.
            if ((0, channel_errors_1.classifyBadRequest)(e) === "addressee_not_member") {
                return (0, respond_1.err)(`Nobody by that reference is on ${label}. A ping's to= names a MEMBER of the channel — check dopl_channel(op="members", channel="${channelRef}") — or, if you meant your own operator's side, send to_desktop=true instead.`);
            }
            return (0, respond_1.err)(`That ping was refused${(0, channel_errors_1.serverDetail)(e)}`);
        }
        throw e;
    }
    const next = NEXT_STEP[ping.recipientKind] ??
        "It is filed and waiting to be read.";
    return (0, respond_1.ok)([
        `Pinged ${label} — ${ping.kind}, ping seq ${ping.seq}.`,
        "",
        next,
        "",
        // ⚠ SAY WHAT A PING IS NOT, here rather than only in the description: a
        // tool RESULT is read at the moment the model picks its next action, so it
        // outvotes the description (INVARIANTS §10). The failure this prevents is
        // an agent pinging repeatedly because it expected a reply to arrive.
        "⚠ A ping is not a message: it is in NO transcript, it will never come back on an op=\"await\", and nothing replies to it. If you need an answer, the answer comes as a normal message on the channel — keep awaiting there.",
        `⚠ ping seq ${ping.seq} is a PING cursor and is not a message seq. Never pass it to op="read" or op="await".`,
    ].join("\n"));
}
/** One inbox row. ⚠ Bodies are counterparty-written, so every one is
 *  neutralized — a body that spanned lines could otherwise fake a row. */
function formatPing(p) {
    const where = (0, channel_shared_1.inlineOr)(p.channelSlug, p.channelId);
    const from = p.senderAgentId === null ? "a member" : `@agent-${p.senderAgentId}`;
    const thread = p.threadId === null ? "" : ` · thread ${p.threadId}`;
    return `- [${p.kind}] seq ${p.seq} · #${where} · from ${from} · ${p.createdAt}${thread}\n    ${(0, narration_1.neutralizeInline)(p.body)}`;
}
/**
 * READ THE INBOX — what was sent TO ME.
 *
 * 🔒 RECIPIENT-SCOPED AT THE SERVER, and there is deliberately no argument for
 * whose inbox: a ping targets one person, and a read that could answer for
 * somebody else would make the whole surface a worse transcript.
 */
async function opReadPings(client, opts = {}) {
    const pings = await client.listPings({
        ...(opts.since === undefined ? {} : { since: opts.since }),
        ...(opts.limit === undefined ? {} : { limit: opts.limit }),
    });
    const cursorNote = pings.length === 0
        ? // ⚠ AN EMPTY PAGE MUST NOT MOVE THE CURSOR. Re-arming on a fabricated
            // seq is how a reader silently skips the next arrival.
            `Nothing new${opts.since === undefined ? "" : ` after ping seq ${opts.since}`}. Re-read with the SAME since.`
        : `Next: read again with since=${pings[pings.length - 1].seq}.`;
    return (0, respond_1.ok)([
        `## Your pings — ${pings.length} ${pings.length === 1 ? "signal" : "signals"}\n`,
        // ⚠ FRAMING FIRST, never as a footnote: the bodies below are written by
        // other members' agents and must be read as data before they are read.
        `${channel_render_1.UNTRUSTED_BODY_HEADER}\n`,
        ...(pings.length === 0 ? [] : pings.map(formatPing)),
        "",
        cursorNote,
        '⚠ These seqs are a PING cursor, separate from message seqs. A ping is in no transcript, so op="read" and op="await" will never show you one — this op is the only place they exist.',
    ].join("\n"));
}
