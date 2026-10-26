"use strict";
/**
 * `op="send"` routed to its lane: a display, a thread open, a milestone, a decision card, a record
 * or a plain post. `channel.ts` registers the tool; this file owns which handler a send reaches.
 *
 * ⚠ THREE LANES, ONE OP, AND THE `kind` IS FIXED AT THIS SEAM rather
 * than left to the caller's spelling. `milestone` stores
 * `thread_progress`; `decision` MUST stay `kind='message'` or
 * `dopl-desktop-app/main/targeting.js › classify` drops the card and the
 * human it asks is never notified. Both delegate to `opPost` rather than
 * growing a second delivery path.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.routeSend = routeSend;
const respond_1 = require("./respond");
const channel_ops_write_1 = require("./channel-ops-write");
const channel_ops_threads_1 = require("./channel-ops-threads");
const channel_ops_escalate_1 = require("./channel-ops-escalate");
const channel_ops_show_1 = require("./channel-ops-show");
async function routeSend(client, args, runtime) {
    // ⚠ A DISPLAY IS `dopl_show` (granular), routed BEFORE the channel-required check: its
    // channel is optional (the session's), and a legacy call carries no blocks to show.
    if (args.kind === "display")
        return (0, channel_ops_show_1.opShow)(client, args);
    const miss = (0, respond_1.missingParams)("send", args, ["channel", "body"]);
    if (miss)
        return miss;
    const channel = args.channel;
    const body = args.body;
    // ⚠ `thread="new"` OPENS THE EXCHANGE, and it is checked FIRST because
    // it decides which ROUTE the send goes to. `summary` is the title —
    // one field, one meaning, and the create route's own `.min(1)` is what
    // refuses a whitespace-only one after trimming.
    // ⚠ `to` names the other party; kind="record" takes none and opens a
    // thread for nobody (the only way to open one in a one-member room).
    // Any other kind without `to` is the address-or-record refusal.
    if (args.thread === "new") {
        const missNew = (0, respond_1.missingParams)('send thread="new"', args, ["summary"]);
        if (missNew)
            return missNew;
        const record = args.kind === "record";
        const refused = record
            ? (0, channel_ops_write_1.recordAddressedRefusal)(Boolean(args.to))
            : (0, channel_ops_write_1.unaddressedRefusal)(Boolean(args.to), false);
        if (refused)
            return refused;
        return (0, channel_ops_threads_1.opCreateThread)(client, channel, args.summary, body, args.to, undefined, args.client_msg_id, runtime, undefined, record);
    }
    // ⚠ `thread` is REQUIRED here where a plain send leaves it optional —
    // an untagged milestone groups into nothing, the one shape of this
    // call that is always a mistake. ⚠ `to` is NOT routed through: a
    // milestone marks the thread and addresses nobody.
    if (args.kind === "milestone") {
        const missM = (0, respond_1.missingParams)('send kind="milestone"', args, [
            "thread",
        ]);
        if (missM)
            return missM;
        const oversize = (0, channel_ops_write_1.milestoneRefusal)(body);
        if (oversize)
            return oversize;
        return (0, channel_ops_write_1.opPost)(client, channel, body, {
            kind: "thread_progress",
            thread: args.thread,
            summary: args.summary,
            runtime,
            // ⚠ ITS OWN VERB. A milestone result opening `posted` would report
            // the wrong act on the one lane whose whole point is that it is
            // NOT a delivery — see `PostOptions.resultHead`.
            resultHead: "milestone",
        });
    }
    // ⚠ `summary` IS THE ISSUE AND `body` IS THE CONTEXT (B8). The card
    // used to take four dedicated params; two of them were the two fields
    // every send already has, under other names. ⚠ `to` is deliberately
    // NOT routed through: addressing a member starts THEIR agent
    // (INVARIANTS §5), and a decision exists precisely because a PERSON
    // has to decide — the @-tag in the body is the inbox mechanism and it
    // starts nobody.
    if (args.kind === "decision") {
        const missD = (0, respond_1.missingParams)('send kind="decision"', args, [
            "summary",
            "options",
        ]);
        if (missD)
            return missD;
        const oversize = (0, channel_ops_write_1.decisionRefusal)(body);
        if (oversize)
            return oversize;
        return (0, channel_ops_escalate_1.opEscalate)(client, channel, {
            issue: args.summary,
            context: body,
            options: args.options,
            recommendation: args.recommendation ?? null,
        }, {
            thread: args.thread,
            clientMsgId: args.client_msg_id,
            runtime,
        });
    }
    // ⚠ **THE RECORD LANE, AND IT IS THE SECOND HALF OF THE ADDRESSING
    // STRUCTURE** (2026-09-18, Samuel's ruling). It stores `intent:"chat"`
    // on an ordinary `message` row — an existing concept given a name
    // rather than a new stored shape — and the server then refuses to
    // repair its address, so it wakes and feeds nobody. ⚠ `to` is REFUSED
    // here rather than ignored: the two say opposite things, and the
    // server's own 400 for the same contradiction narrates as a
    // membership problem.
    if (args.kind === "record") {
        const addressed = (0, channel_ops_write_1.recordAddressedRefusal)(Boolean(args.to));
        if (addressed)
            return addressed;
        return (0, channel_ops_write_1.opPost)(client, channel, body, {
            clientMsgId: args.client_msg_id,
            intent: "chat",
            summary: args.summary,
            thread: args.thread,
            runtime,
            // ⚠ ITS OWN VERB, on `milestone`'s precedent: a result opening
            // `posted` would report a delivery on the one lane whose contract
            // is that there was none.
            resultHead: "recorded",
        });
    }
    // ⚠ **A PLAIN SEND ADDRESSES SOMEBODY OR IT IS REFUSED** — the other
    // half of the same ruling. Checked AFTER the three kinds above, each
    // of which is already an address or already a post for nobody, and
    // carved out for a THREAD send, where the thread's two parties are the
    // address (INVARIANTS §5, RR1).
    const bare = (0, channel_ops_write_1.unaddressedRefusal)(Boolean(args.to), Boolean(args.thread));
    if (bare)
        return bare;
    const crowded = (0, channel_ops_write_1.tooManyRecipientsRefusal)(args.to);
    if (crowded)
        return crowded;
    return (0, channel_ops_write_1.opPost)(client, channel, body, {
        clientMsgId: args.client_msg_id,
        to: args.to,
        summary: args.summary,
        thread: args.thread,
        runtime,
    });
}
