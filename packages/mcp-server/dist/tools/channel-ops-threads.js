"use strict";
/**
 * `dopl_channel` THREAD op handlers: create_thread / set_thread_mode.
 * ⚠ `channel-` filename prefix required by the parity split-scan
 * (parity.test.ts).
 *
 * ⚠ BOUNDARY: wire/storage name `task` == domain name `thread`.
 *
 * ⚠ Every string below is server NARRATION, outside untrusted framing. What is
 * peer-controlled:
 *   - `ch.name` — creator-typed, and `resolveChannelOr` resolves PUBLIC channels
 *     the caller was never invited to. 120 chars, NO charset rule, so newlines
 *     are possible. Neutralized at every site.
 *   - `thread.title` — typed by whoever OPENED the thread (200 chars, interior
 *     newlines allowed), and NOT necessarily the caller on every path. Hence
 *     header AND code span wherever it is rendered.
 *   - `member.label` — already render-safe: `resolveMemberOr` neutralizes at the
 *     source (`memberLabel` in channel-shared.ts). Do not re-wrap.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.opCreateThread = opCreateThread;
exports.opSetThreadMode = opSetThreadMode;
const respond_1 = require("./respond");
const channel_shared_1 = require("./channel-shared");
// ⚠ Whether a pending HOLD outlives the turn is a CLIENT property this
// server cannot see — one module decides what may be claimed about it.
const channel_wake_guidance_1 = require("./channel-wake-guidance");
// ⚠ ONE write-result renderer, shared with `post`/`launch_agent`/`direct_agent`.
const channel_facts_1 = require("./channel-facts");
const channel_errors_1 = require("./channel-errors");
/** Fallbacks for peer text that neutralized to nothing — never an empty span. */
const NO_NAME = "(unnamed)";
const NO_TITLE = "(untitled)";
const NO_ID = "(unreadable id)";
async function opCreateThread(client, channelRef, title, body, to, mode, clientMsgId, 
// Caller's OBSERVED runtime stamp. Changes nothing this op does — only what
// the result claims about waiting.
runtime = null, 
// SPAWN-WITH-HANDOFF: declares the driving session should open on the
// OPERATOR'S machine rather than being kept by this external session. Rides
// the opening message's reserved `metadata.handoff` stamp; ⚠ the desktop
// honors it only for a thread the operator created as themselves.
handoff) {
    const ch = await (0, channel_shared_1.resolveChannelOr)(client, channelRef);
    if ((0, channel_shared_1.isErr)(ch))
        return ch;
    const chName = (0, channel_shared_1.inlineOr)(ch.name, NO_NAME);
    const member = await (0, channel_shared_1.resolveMemberOr)(client, to);
    if ((0, channel_shared_1.isErr)(member))
        return member;
    // Idempotency key goes out AS GIVEN — it carries no meaning beyond dedupe.
    let created;
    try {
        created = await client.createChannelThread(ch.id, {
            title,
            body,
            toUserId: member.userId,
            mode,
            clientMsgId,
            handoff,
        });
    }
    catch (e) {
        // ⚠ Read the CODE. `to` is required here, so a bare `isBadRequest` branch
        // answers every 400 with the addressee message — an over-length title then
        // reads as "invite them first" and op="rooms" action="invite" answers "already a member".
        if ((0, channel_errors_1.isBadRequest)(e)) {
            switch ((0, channel_errors_1.classifyBadRequest)(e)) {
                case "addressee_not_member":
                    return (0, respond_1.err)(`Couldn't address the thread to ${member.label} — they aren't a member of **${chName}**. Invite them first (op="rooms" action="invite"), then open the thread.`);
                // A thread is postable only by its creator and target, so a
                // self-addressed thread has nobody who can answer it and sits live and
                // unanswerable. ⚠ Name the roster op — the failure mode is not knowing
                // who else is in the channel.
                case "self_target":
                    return (0, respond_1.err)(`A thread can't be addressed to yourself — you and the member you address it to are the only two who may post into it, so a self-addressed thread has nobody who can answer it. No thread was opened. List the channel's other members (op="rooms", action="members", channel="${ch.id}"), then open the thread addressed to one of them.`);
                case "invalid_request":
                    return (0, respond_1.err)(`That create_thread was rejected as INVALID before it reached **${chName}** — no thread was opened, and this is NOT a membership problem, so do NOT invite ${member.label}.${(0, channel_errors_1.serverDetail)(e)} ${channel_errors_1.FIELD_CAPS_NOTE} Shorten the field that is over and open the thread again.`);
                case "workspace":
                    return (0, respond_1.err)(`The thread was not opened because the call carried no usable workspace.${(0, channel_errors_1.serverDetail)(e)} This is a connection-level problem, not a channel one — report it to your operator.`);
                case "thread_not_in_channel":
                case "unknown":
                    return (0, respond_1.err)(`Opening the thread in **${chName}** was rejected (HTTP 400) and the server did not name a cause this tool recognizes.${(0, channel_errors_1.serverDetail)(e)} No thread was opened.`);
            }
        }
        throw e;
    }
    const thread = created.thread;
    // ⚠ THE TITLE IS NOT ECHOED, and that is a saving rather than a loss: the
    // caller typed it one argument ago, so repeating it back (neutralized, under a
    // header, because it is a member-typed string on every OTHER path) buys
    // nothing this call did not already know. `op="get_thread"` renders it.
    // ⚠ Cursor is STATED from the route's returned opening seq, never "find the
    // newest message with read limit=1" — that costs a round-trip and races the
    // peer, whose reply becomes "the newest message" and is then awaited past.
    //
    // ⚠ HANDOFF IS A REQUEST, NOT AN OUTCOME. It is a metadata STAMP a desktop
    // listener may later act on; `session-dispatch.maybeOpenRequesterSession`
    // silently answers false when window mode is off, when `requesterTaskOpen`
    // refuses, when the concurrency ceiling is spent, and (commonly) when the
    // operator's desktop is not running.
    //
    // ⚠ **AND SINCE F-228 THE ANSWER IS ALWAYS "NOTHING OPENED" (F-274,
    // 2026-08-22).** `main/targeting.js › requesterTaskOpen` — the predicate that
    // consumed the stamp — has NO CALLER; its listener path died with the session
    // window. The server half still works perfectly and the last layer is missing,
    // which is the shape that produces the most confident wrong copy.
    //
    // ── THE RESULT: ONE LINE OF FACTS (T10, 2026-09-02) ──────────────────────
    //
    // ⚠ WHAT LEFT. This op closed with four paragraphs: what a thread is for, the
    // hold mechanics, the ~30-minute stop rule, and — on the handoff branch — a
    // three-paragraph account of a flag that does nothing. Every one of them is
    // standing doctrine and is stated once in `channel-doctrine.ts`, behind
    // `op="rooms" action="help"`. What survives is what only this call knows.
    //
    // ⚠ `handoff=ignored` IS THE WHOLE OF THE HANDOFF WARNING, AND IT IS ENOUGH.
    // The lane opens nothing today (F-274): the flag is still accepted and still
    // stamped, but no current Dopl app reads the stamp, so the thread behaves
    // exactly as one created without it. The DEFECT the old copy fixed was an
    // external session reading "a session took over" and NOT arming a wait, so
    // nobody watched the thread. `hold=since:<seq>` on the same line is that fix,
    // stated for every branch rather than only the handoff one — a cursor is a
    // stronger instruction than a paragraph telling the reader to go find one.
    return (0, respond_1.ok)((0, channel_facts_1.factsLine)("opened", {
        thread: thread.id,
        // ⚠ The OPENING message's seq, so the reply is the very next message an
        // hold returns. `null` when the server did not report one — then the
        // caller reads it, and a fabricated cursor would silently skip messages.
        seq: created.openingSeq ?? undefined,
        mode: thread.mode,
        addressed: true,
        handoff: handoff ? "ignored" : undefined,
        hold: (0, channel_wake_guidance_1.holdFact)(runtime, created.openingSeq),
    }));
}
/**
 * ⚠ TWO OPS ENDED HERE with thread closing (wiring plan Phase 4, 2026-08-18):
 *
 *  - `closeThreadIsHumansToMake()` — the teaching refusal for `close_thread`.
 *    It was ANSWERED rather than removed from the enum, so an agent trained on
 *    the old surface got a sentence telling it what to do instead of a zod
 *    "invalid enum value". That trade only pays while there IS something to do
 *    instead; there is not, and the words themselves now teach a feature that
 *    does not exist, so the op left the enum too.
 *  - `opProposeClose()` — the agent's terminal act, a marked non-terminal
 *    `task_progress` its operator confirmed. Nothing to confirm.
 *
 * The rendering rules they demonstrated are still the file's: a peer-typed TITLE
 * goes in one inline code span with `channel-render.ts`'s
 * `UNTRUSTED_THREAD_HEADER` FIRST, and a returned cursor is STATED from the
 * server's own seq, never guessed. ⚠ Nothing left here renders a title the
 * caller did not just type, so the header has no site in this file today.
 */
/**
 * Set a thread's mode. Title neutralized as everywhere else, but ⚠ NO untrusted
 * header on purpose: the route allows `set_mode` to the thread's CREATOR only,
 * so a success means the caller typed the title — the header would frame a
 * string against its own author. The span stays anyway: a tool must not depend
 * on a remote authorization check for a LOCAL rendering property.
 */
async function opSetThreadMode(client, channelRef, threadId, mode) {
    const ch = await (0, channel_shared_1.resolveChannelOr)(client, channelRef);
    if ((0, channel_shared_1.isErr)(ch))
        return ch;
    const chName = (0, channel_shared_1.inlineOr)(ch.name, NO_NAME);
    let thread;
    try {
        thread = await client.setChannelThreadMode(ch.id, threadId, { mode });
    }
    catch (e) {
        const safeId = (0, channel_shared_1.inlineOr)(threadId, NO_ID);
        if ((0, respond_1.isNotFound)(e)) {
            return (0, respond_1.err)(`No thread ${safeId} in **${chName}**.`);
        }
        if ((0, channel_errors_1.isForbidden)(e)) {
            return (0, respond_1.err)(`You can't change the mode of thread ${safeId} — only its creator can.`);
        }
        throw e;
    }
    return (0, respond_1.ok)(`Set thread **${(0, channel_shared_1.inlineOr)(thread.title, NO_TITLE)}** in **${chName}** to ${thread.mode} mode.`);
}
