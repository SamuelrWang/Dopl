"use strict";
/**
 * `dopl_channel` op="post" — send a message or a structured activity event.
 * Resolve the addressing, make the call, map the 4xx, hand the outcome to the
 * modules that narrate it.
 *
 * ⚠ BOUNDARY: wire/storage name `task` == domain name `thread`. The `thread` op
 * param folds into `metadata.taskId` and `task_*` kinds keep their stored
 * names; only the agent-facing surface says `thread`.
 *
 * ⚠ PEER-CONTROLLED TEXT. Every string below is server NARRATION with no
 * untrusted framing, and one peer-authored value splices into it: `ch.name` —
 * `resolveChannelOr` lists PUBLIC channels the caller was never invited to, so
 * the name can come from someone the agent never contacted. ⚠ A SECOND ONE LEFT
 * WITH THE CLIENT-SIDE MEMBER LOOKUP (B8): the addressee's display name was
 * spliced into two refusals, and the server now owns that resolution — so the
 * name never reaches this module and `serverDetail` carries the one place it
 * still appears, neutralized there.
 *
 * ⚠ A send addresses ONE party or nobody, and `to` is the whole of it: with one
 * the message reaches that member's machine — or, for an agent handle, that
 * agent — and without one it is chat and reaches nobody. ⚠ **THE REF GOES OUT
 * AS GIVEN AND THE SERVER RESOLVES IT** (2026-09-02, B8): `to` is a union over
 * two namespaces, so resolving the member half here would mean two resolvers
 * disagreeing about one field, and a `@handle` this side cannot see would come
 * back as "not a member" instead of the 400 that lists the live handles.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.DECISION_CONTEXT_MAX_CHARS = exports.MILESTONE_MAX_CHARS = void 0;
exports.milestoneRefusal = milestoneRefusal;
exports.decisionRefusal = decisionRefusal;
exports.opPost = opPost;
const respond_1 = require("./respond");
// ⚠ THE RESULT IS ONE LINE OF FACTS (T10/T12). Each import below contributes
// FIELDS, not prose; the standing rules they used to restate live once in
// `channel-doctrine.ts`, behind `op="help"`.
const channel_facts_1 = require("./channel-facts");
// "Did it thread?" — the question a sender cannot otherwise settle.
const channel_post_linkage_1 = require("./channel-post-linkage");
// "What became of the `@…` tokens?" — the server's own resolution, read back.
const channel_post_guidance_1 = require("./channel-post-guidance");
const channel_shared_1 = require("./channel-shared");
// ⚠ Whether a pending `await` outlives the turn is a CLIENT property this
// server cannot see — one module decides what may be claimed about it.
const channel_wake_guidance_1 = require("./channel-wake-guidance");
// ⚠ A 400's MEANING is read off its CODE, never guessed from its status.
const channel_errors_1 = require("./channel-errors");
/** Fallback for peer text that neutralized to nothing — never an empty span. */
const NO_NAME = "(unnamed)";
/**
 * G14 — **A MILESTONE IS ONE LINE, AND THAT IS NOW A BOUND RATHER THAN A WORD.**
 *
 * ⚠ The op shared `post`'s 16,000-character cap while three surfaces asked, in
 * prose, for "ONE LINE naming the step that just landed" — and a rule stated
 * only in prose is the rule a model spends a paragraph on. 240 characters is
 * about two lines of terminal width; the NEWLINE check is the sharper half,
 * because a multi-line milestone is a report wearing a marker's op, and the
 * card that renders it shows one line whatever it was sent.
 *
 * ⚠ **THE REFUSAL NAMES THE OTHER LANE**, since the caller has real content in
 * hand: refusing without saying where it goes is how a deliverable ends up
 * squeezed into a marker.
 */
exports.MILESTONE_MAX_CHARS = 240;
function milestoneRefusal(body) {
    const over = body.length > exports.MILESTONE_MAX_CHARS;
    const multiline = /[\r\n]/.test(body);
    if (!over && !multiline)
        return null;
    return (0, respond_1.err)(`Nothing was posted: a milestone is ONE LINE marking a step that just landed, and yours ${over ? `is ${body.length} characters (the cap is ${exports.MILESTONE_MAX_CHARS})` : "spans more than one line"}. The bound is the point of the op — a milestone carries no content, so a requester watching several agents can read a page of them at a glance. Send the substance with dopl_channel(op="send", thread="<the same id>", body=…), then mark it with one short line here.`);
}
/**
 * **THE `kind="decision"` BODY CAP, AND IT IS THE ROUTE'S** (2026-09-02, B8).
 * A decision's CONTEXT is the send's `body`, which folds two params into one —
 * and the two had different bounds: a message may be 16,000 characters, an
 * escalation's context 2,000 (`src/features/channels/escalation.ts ›
 * ESCALATION_CONTEXT_MAX`). Publishing the looser cap and letting the route
 * refuse would send back an opaque VALIDATION_FAILED about a field the caller
 * never named, so the tighter bound is checked here, before the wire, and the
 * refusal says which lane the extra prose belongs in.
 */
exports.DECISION_CONTEXT_MAX_CHARS = 2000;
function decisionRefusal(body) {
    if (body.length <= exports.DECISION_CONTEXT_MAX_CHARS)
        return null;
    return (0, respond_1.err)(`Nothing was posted: on kind="decision" the \`body\` is the CONTEXT on the card, and a card is read at a glance — yours is ${body.length} characters against a cap of ${exports.DECISION_CONTEXT_MAX_CHARS}. Say what a person needs to know to CHOOSE and nothing else; the options carry their own consequences. Send the working detail as an ordinary message on the same thread first, then ask.`);
}
async function opPost(client, channelRef, body, opts = {}) {
    const ch = await (0, channel_shared_1.resolveChannelOr)(client, channelRef);
    if ((0, channel_shared_1.isErr)(ch))
        return ch;
    const chName = (0, channel_shared_1.inlineOr)(ch.name, NO_NAME);
    // Fold `thread` into the STORAGE key `metadata.taskId`; explicit param wins
    // over any metadata copy. Route validates it resolves in this channel.
    const metadata = opts.thread
        ? { ...(opts.metadata ?? {}), taskId: opts.thread }
        : opts.metadata;
    let message;
    try {
        message = await client.postChannelMessage(ch.id, {
            body,
            kind: opts.kind,
            metadata,
            clientMsgId: opts.clientMsgId,
            // ⚠ THE UNION FIELD, NOT `toUserId`. One recipient, one resolver, one
            // refusal — see this module's header.
            to: opts.to,
            summary: opts.summary,
            // ⚠ Omitted on every ordinary post, so no existing wire shape moved.
            escalation: opts.escalation,
        });
    }
    catch (e) {
        // ⚠ Map 400s off the CODE, never off which params happened to be set —
        // param-guessing misreads a rejected BODY (>16000-char body, >200-char
        // summary) as a membership problem and sends the agent to invite someone.
        if ((0, channel_errors_1.isBadRequest)(e)) {
            switch ((0, channel_errors_1.classifyBadRequest)(e)) {
                case "addressee_not_member":
                    return (0, respond_1.err)(`Couldn't address the message — that member isn't in **${chName}**. Add them with dopl_channel(op="rooms", action="invite"), or send without \`to\`.`);
                // ⚠ NOTHING WAS WRITTEN, and the server's own message lists the live
                // handles and the roster — which is the whole remedy, so this arm adds
                // the one fact that message cannot carry: no row exists to retract.
                case "recipient_unresolved":
                    return (0, respond_1.err)(`Nothing was sent to **${chName}**: \`to\` named nobody this workspace can see.${(0, channel_errors_1.serverDetail)(e)} Fix the name and send again — a send is never delivered to a recipient that does not resolve.`);
                case "thread_not_in_channel":
                    return (0, respond_1.err)(`That thread is not in this channel — check the thread id, or send without \`thread\`.`);
                case "invalid_request":
                    return (0, respond_1.err)(`That message was rejected as INVALID before it reached **${chName}** — nothing was sent, and this is NOT a membership or thread problem, so do not invite anyone or change \`thread\` over it.${(0, channel_errors_1.serverDetail)(e)} ${channel_errors_1.FIELD_CAPS_NOTE} Shorten the field that is over and post again.`);
                case "workspace":
                    return (0, respond_1.err)(`The post was rejected because the call carried no usable workspace.${(0, channel_errors_1.serverDetail)(e)} This is a connection-level problem, not a channel one — report it to your operator.`);
                // `self_target` is create_thread-only (`post to=self` is deliberately
                // NOT guarded server-side), so this arm is unreachable and exists only
                // to keep the switch exhaustive.
                case "self_target":
                case "unknown":
                    return (0, respond_1.err)(`The post to **${chName}** was rejected (HTTP 400) and the server did not name a cause this tool recognizes.${(0, channel_errors_1.serverDetail)(e)} Nothing was sent.`);
            }
        }
        // ⚠ 403s told apart by CODE, not by which params happened to be set.
        if ((0, channel_errors_1.isForbidden)(e)) {
            const kind = (0, channel_errors_1.classifyForbidden)(e);
            // ⚠ THE BELT FOR A BYPASSED BUILD. No caller can name a lifecycle kind
            // any more — `kind` left the published shape (C12) and only op="milestone"
            // sets one, to the single value the lane allows — so this is unreachable
            // through the tool. It is answered with the RULE rather than dropped into
            // a membership arm, because the one thing it must never read as is "you
            // left the channel".
            if (kind === "lifecycle_kind") {
                return (0, respond_1.err)('Nothing was sent: that message carried a LIFECYCLE kind ("task_started" / "task_finished" / "task_failed"), which the runtime that starts and stops a session writes and an agent credential may not. Send the same text as an ordinary message — everything substantive you send, your FINAL ANSWER included, is one — and mark a step that LANDED with kind="milestone".');
            }
            if (opts.thread && kind !== "not_a_member") {
                // A thread belongs to its CREATOR and its addressee; that pair is the
                // whole write gate.
                //
                // ⚠ The thread id is NOT echoed here. It round-trips (an agent copies
                // it from a `read` legend = `metadata.taskId`, peer-set verbatim for
                // non-UUID values), and "the id you just passed" needs no escaping.
                return (0, respond_1.err)(`You can't post into that thread — nothing was posted. A thread is between the member who OPENED it and the member it is addressed TO, and you are neither: check it with dopl_channel(op="read", channel="${ch.id}", thread=<the id you just passed>). Send into the channel instead, or ask one of those two to open a thread with you. Do NOT open your own thread for the same work; that is a duplicate room, not a way in.`);
            }
            if (kind === "not_a_member") {
                return (0, respond_1.err)(`You can't post to **${chName}** — you are not a member of that channel. Nothing was posted.`);
            }
        }
        throw e;
    }
    // ── THE RESULT: ONE LINE OF FACTS (T10/T12, 2026-09-02) ──────────────────
    //
    // ⚠ WHAT THIS REPLACED, AND THE RULE THAT DECIDED IT. A successful post used
    // to return ~2.5–3.5k characters: the addressing paragraph, the thread-linkage
    // paragraph, the per-mention breakdown, the five causes a tag resolves to
    // nobody, the main-room sparseness bar, the await lecture and its stop rule.
    // Every one of those was true BEFORE this call and is true AFTER it — standing
    // doctrine, re-transmitted on every write, ~25 times in one measured
    // orchestration run. It is stated once now, in `channel-doctrine.ts`.
    //
    // ⚠ EVERY FIELD BELOW IS SOMETHING ONLY THIS CALL KNOWS, and each replaces a
    // paragraph rather than deleting one:
    //   seq/msg   — the cursor and the id a follow-up call needs.
    //   thread    — read off the STORED message, so `landed=dropped` still catches
    //               the silent tag-drop the long note existed for.
    //   addressed — T12: the whole of the "NOT ADDRESSED" paragraph. `no` means no
    //               agent was put in front of this post; the doctrine says why.
    //   ⚠ `intent` WAS A FIELD HERE and is not one now (C12): it could only
    //               ever restate `addressed`, since chat is exactly "no `to`",
    //               and two fields for one fact is what let them disagree.
    //   tags      — the server's own mention resolution. THE ONE THING IN THE
    //               PRODUCT THAT CATCHES A MISSPELLED HANDLE (INVARIANTS §10):
    //               `0/1` is the verdict, and it may never be dropped for brevity.
    //   wake      — the `@agent-…` handles the body named. NOT counted in `tags`:
    //               they resolve on the operator's machine, never on the server.
    //   await     — the one runtime-derived branch: arm from this seq, or skip.
    const landing = (0, channel_post_linkage_1.threadFacts)(message, 
    // ⚠ The caller named a thread if EITHER argument carried one. `metadata` is
    // a caller-settable passthrough whose schema description tells agents to
    // put `taskId` in it, and it is forwarded untouched when `thread` is
    // absent — reading `opts.thread` alone makes such a post look unthreaded
    // and produces a false `landed=dropped`.
    opts.thread ??
        (typeof opts.metadata?.taskId === "string" && opts.metadata.taskId.trim()
            ? opts.metadata.taskId
            : undefined));
    const mentions = (0, channel_post_guidance_1.postMentionFacts)(body, message);
    return (0, respond_1.ok)((0, channel_facts_1.factsLine)(opts.resultHead ?? "posted", {
        seq: message.seq,
        msg: message.id,
        thread: landing.thread,
        landed: landing.landed,
        // ⚠ **READ OFF THE STORED ROW, NOT OFF THE ARGUMENT** (2026-09-02, B8).
        // `to` is now resolved server-side over two namespaces, so the only honest
        // answer to "was an agent put in front of this" is the recipient set the
        // server wrote. ⚠ `null`/absent is NOT "nobody": it is a server that
        // computed no recipients, and `[]` is the resolved-to-nobody case.
        addressed: (message.recipientUserIds?.length ?? 0) > 0 ||
            (message.recipientAgentIds?.length ?? 0) > 0,
        tags: mentions.tags,
        wake: mentions.wake,
        // ⚠ WHAT BECAME OF IT — A9's keystone contract, rendered where the caller
        // already reads the rest of the write's outcome. `woken?` is the server's
        // write-time prediction (no `deliveryAt` yet); `woken` is the operator's
        // machine reporting what it did. Absent = this server computes no verdict,
        // which is NOT `none`. See `channel-facts.ts › deliveryFact`.
        delivery: (0, channel_facts_1.deliveryFact)(message.delivery, message.deliveryAt),
        await: (0, channel_wake_guidance_1.awaitFact)(opts.runtime ?? null, message.seq),
        ...(opts.resultFacts ?? {}),
    }));
}
