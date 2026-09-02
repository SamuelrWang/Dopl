"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.opPing = opPing;
exports.opReadPings = opReadPings;
const respond_1 = require("./respond");
const respond_2 = require("./respond");
const channel_shared_1 = require("./channel-shared");
const narration_1 = require("./narration");
// ⚠ THE SHARED STRIPPER — it moved to its own leaf module on 2026-09-01 when a
// fourth op needed it. ONE definition: a copy drifts, and the lane that drifts
// sends `@agent-` to a column CHECK that refuses it.
const channel_agent_id_1 = require("./channel-agent-id");
const channel_errors_1 = require("./channel-errors");
const channel_framing_1 = require("./channel-framing");
/**
 * ⚠ **UNREFERENCED SINCE 2026-09-02 (slice B8, Samuel's ruling B8).** Pings fold
 * into a directed `send`: a directed send IS the delivery record, and its
 * `delivery=` is the ack this mailbox row used to be. Both op names now answer a
 * one-line redirect (`channel-retired-ops.ts`), so nothing routes here — and the
 * table these handlers read (`20260907130000_channel_pings.sql`) was DELETED
 * UNAPPLIED, so nothing ever could. ⚠ **THE MODULE AND ITS SUITE ARE SLICE
 * B16'S TO DELETE**, with `channel-ops-await*.ts`, one release after the desktop
 * version floor stops calling either name; deleting them here would take a
 * retirement out of the slice that owns it.
 *
 * THE "NEEDS YOU" SIGNAL — `op="ping"` and `op="pings"` (2026-09-01,
 * `docs/specs/needs-you-ping.md`).
 *
 * ⚠ **A PING IS NOT A POST AND MUST NEVER BECOME ONE.** It reaches ONE recipient,
 * it does not fan out to the room, it cannot end an `await`, and its `seq` is its
 * own cursor space. That is why it exists: an agent that FINISHED had no
 * instrument at all — an unaddressed post starts nobody (the loop brake), and an
 * addressed one shouts at a whole channel and triggers a machine.
 *
 * 🔒 **THERE IS NO ARGUMENT FOR WHOSE MACHINE.** The two self-scoped destinations
 * resolve to the authenticated caller's own operator, server-side, and that
 * absence is the whole loop brake on this lane: you cannot ping another member's
 * agent because there is nothing to say it with. Asserted in `channel-ping.test.ts`.
 *
 * ⚠ **ONE `recipient` PARAM SINCE 2026-09-02 (C5/F-429).** It was three mutually
 * exclusive ones — `to`, `to_desktop`, `agent_id` — which this module had to
 * COUNT at runtime and refuse on zero or two, with a sentence naming the count
 * it saw. A field that can carry one destination cannot be sent two, so both
 * refusals are gone rather than reworded, and `missingParams` at the seam covers
 * the zero case with every other required argument. What replaces them is
 * {@link classifyRecipient}, which is a total function over one string.
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
/** The literal that means "my own operator's external session" — the one
 *  destination that is a WORD rather than an identifier, because there is no id
 *  for it: the server resolves it to the authenticated caller. */
const DESKTOP = "desktop";
/**
 * ONE STRING → THE WIRE'S OWN THREE KEYS. ⚠ **TOTAL, AND UNAMBIGUOUS BY
 * CONSTRUCTION** — the three forms cannot overlap, so this needs no precedence
 * rule and has no refusal arm:
 *   - the exact word `desktop`;
 *   - `@agent-<id>`, or the bare id `bareAgentId` leaves behind;
 *   - anything else, which is a member ref — an email or a user id — and is
 *     resolved by the SERVER against the channel roster, so a value that names
 *     nobody comes back as `addressee_not_member` rather than as a guess.
 *
 * ⚠ THE HANDLE IS STRIPPED BEFORE IT IS TESTED, because `read_sessions` prints
 * `@agent-<id>` and that is what a model copies — `channel-agent-id.ts` owns
 * both halves, and its header carries why the three forms cannot collide.
 */
function classifyRecipient(raw) {
    const value = raw.trim();
    if (value.toLowerCase() === DESKTOP)
        return { toDesktop: true };
    const bare = (0, channel_agent_id_1.bareAgentId)(value);
    if ((0, channel_agent_id_1.isAgentId)(bare))
        return { agentId: bare };
    return { to: value };
}
/**
 * SEND ONE PING.
 *
 * The canonical write-op order — pre-call refusals, resolve, call, classify 4xx,
 * render — and the body cap is checked BEFORE any round-trip so "nothing was
 * sent" is trivially true rather than confusable with a delivery failure.
 */
async function opPing(client, channelRef, kind, body, 
/** WHO has to act — `"desktop"`, `@agent-<id>`, or a member ref. */
recipientRef, thread) {
    if (body.length > MAX_PING_BODY) {
        return (0, respond_1.err)(`A ping body is capped at ${MAX_PING_BODY} characters and yours is ${body.length}. That bound is the point of the op: a ping is a SIGNAL, and the thread you point at is where the report goes. Post the detail with op="send" (thread=<id>), then ping one line pointing at it.`);
    }
    const recipient = classifyRecipient(recipientRef);
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
            ...(thread === undefined ? {} : { threadId: thread }),
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
                return (0, respond_1.err)(`Nobody by that reference is on ${label}. A ping's to= names a MEMBER of the channel — check dopl_channel(op="rooms", action="members", channel="${channelRef}") — or, if you meant your own operator's side, send recipient="desktop" instead.`);
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
        `⚠ ping seq ${ping.seq} is a PING cursor and is not a message seq. Never pass it to op="read" or op="read" with wait_ms.`,
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
    // ⚠ **NO CURSOR, AND THAT IS C13's FIX RATHER THAN A MISSING FEATURE**
    // (2026-09-02). A ping seq was a SECOND space behind the one `since` param
    // that also carries the message cursor, and crossing them read a plausible
    // WRONG page instead of erroring. An inbox is a bounded list of signals, not a
    // transcript to replay, so the newest page answers it — and one cursor space
    // on the tool means there is nothing left to cross into.
    const pings = await client.listPings({
        ...(opts.limit === undefined ? {} : { limit: opts.limit }),
    });
    return (0, respond_1.ok)([
        `## Your pings — ${pings.length} ${pings.length === 1 ? "signal" : "signals"}\n`,
        // ⚠ FRAMING FIRST, never as a footnote: the bodies below are written by
        // other members' agents and must be read as data before they are read.
        `${channel_framing_1.UNTRUSTED_BODY_HEADER}\n`,
        ...(pings.length === 0 ? [] : pings.map(formatPing)),
        "",
        '⚠ A ping is in NO transcript: op="read" and op="read" with wait_ms will never show you one, and this op is the only place they exist. It hands back the newest page every time and takes no cursor, so a signal you have already acted on can appear again — the seq is how you tell.',
    ].join("\n"));
}
