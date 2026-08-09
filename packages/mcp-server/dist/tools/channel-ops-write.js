"use strict";
/**
 * `dopl_channel` op="post" — send a message or a structured activity event.
 *
 * THIS FILE IS NOW ONE OP, and that is the end of a three-step split rather
 * than an accident. It began as "the write ops"; the first-class thread ops
 * left for `channel-ops-threads.ts`, the post's result LINES left for
 * `channel-post-linkage.ts` / `channel-addressing.ts` / `channel-wake-guidance.ts`
 * / `channel-post-notes.ts`, and the room-lifecycle ops (open / invite) left
 * for `channel-ops-open.ts`. What is left is the one op every behaviour round
 * actually lands on: resolve the addressing, make the call, map the 4xx, hand
 * the outcome to the modules that narrate it.
 *
 * BOUNDARY: the wire/storage name `task` == the domain name `thread`. The
 * `thread` op param folds into `metadata.taskId` and the `task_*` message
 * kinds keep their stored names; only the agent-facing surface says `thread`.
 *
 * PEER-CONTROLLED TEXT (Q1, write side). Every string below is server NARRATION
 * — no untrusted-content framing, read by the model as the tool speaking — and
 * two peer-authored values are spliced into it.
 *
 *   - `ch.name`. `resolveChannelOr` lists channels including PUBLIC ones the
 *     caller was never invited to, so the name can come from someone the agent
 *     has had no contact with; the reach is lower than `op="list"`'s (the agent
 *     must name the channel) but it is not zero. `features/channels/schema.ts`
 *     bounded it at 120 characters with NO charset rule, so it could carry the
 *     newlines that forge a line — that gap is closed there too now.
 *   - `toLabel` — `profiles.display_name`. Render-safe by the time it arrives:
 *     `resolveMemberOr` neutralizes at the source, so the label is spliced
 *     directly here and must NOT be neutralized twice.
 *
 * Peer TITLES (thread names) render in `channel-post-linkage.ts`; the
 * untrusted-content headers they carry live in `channel-render.ts` with the
 * read side's, one definition each.
 *
 * NAMED-AGENT ADDRESSING IS GONE (channels rollback §1). `to_agent` /
 * `to_agents` / `as_agent` were resolved here through `channel-agent-refs.ts`
 * before the call; a post addresses a PERSON or nobody, and `intent` decides
 * whether even that reaches their machine.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.opPost = opPost;
const respond_1 = require("./respond");
// A post's result lines each live in their own module — this one answers "did
// it thread?", which is the question a sender cannot otherwise settle.
const channel_post_linkage_1 = require("./channel-post-linkage");
// …and this one answers "what did the ADDRESSING do?" — the conflict note, the
// multi-address note, and the addressed/chat/unaddressed line. Split out at the
// §2 cap (SHOULD-FIX-6) beside its two existing siblings.
const channel_post_notes_1 = require("./channel-post-notes");
const channel_shared_1 = require("./channel-shared");
// Whether a pending `await` can outlive the turn is a CLIENT property this
// server cannot see. One module decides what may be claimed about it.
const channel_wake_guidance_1 = require("./channel-wake-guidance");
// Q9 — a 400's MEANING is read off its code, not guessed from its status. See
// channel-errors.ts for why the old status-only branch answered every failure
// with "invite them first".
const channel_errors_1 = require("./channel-errors");
/** Fallback for peer text that neutralized to nothing — never an empty span. */
const NO_NAME = "(unnamed)";
/**
 * P0-3 / DECISION 1 (2026-08-04) — THE THREE KINDS AN AGENT MAY NOT POST, and
 * the fast half of a refusal the server also makes
 * (`service-writes.assertLifecycleKindIsServerOwned`).
 *
 * WHY IT IS REFUSED HERE TOO, when the server already refuses it: this is the
 * layer that can say WHAT TO DO INSTEAD in the caller's own vocabulary, before
 * anything is sent, and "nothing was sent" is then trivially true. The server's
 * copy is the one that holds for anything that skips this tool.
 *
 * `task_progress` is absent deliberately — it is the milestone lane and stays
 * writable, though `op="milestone"` is the spelling that needs no `kind` at all.
 */
const LIFECYCLE_KINDS = new Set([
    "task_started",
    "task_finished",
    "task_failed",
]);
/**
 * The refusal itself. It leads with the CONSEQUENCE rather than the rule,
 * because an agent that reached for `task_finished` did so believing it was
 * delivering: the sentence that changes its behaviour is "the body is not
 * rendered", not "that kind is reserved".
 */
function lifecycleKindRefusal(kind) {
    return (0, respond_1.err)(`Nothing was sent: \`kind="${kind}"\` is a LIFECYCLE MARKER, not a way to say something, and it is not yours to post. Those three kinds ("task_started" / "task_finished" / "task_failed") are written by the runtime that starts and stops a session and by a thread close, and the other member's thread card renders a terminal marker as a STATUS CHIP — its body is not shown at all, so an answer sent this way is delivered nowhere. Re-send it as an ordinary message: drop \`kind\` entirely and post the same text. Everything substantive you send, your FINAL ANSWER included, is a plain message. To mark that a step LANDED, that is dopl_channel(op="milestone", thread="<id>", body="<one line>") — a marker, not a delivery.`);
}
async function opPost(client, channelRef, body, opts = {}) {
    // FIRST, and before any round-trip: a contradictory post has nothing to
    // resolve. Refusing here rather than letting the route do it means "nothing
    // was sent" is trivially true and the caller is told which two params fight.
    if (opts.intent === "chat" && opts.to) {
        return (0, respond_1.err)(channel_post_notes_1.CHAT_ADDRESSED_REFUSAL);
    }
    // P0-2 — and on the same terms: a post this tool will not make needs nothing
    // resolved. Ahead of the channel lookup so a refused post costs no round-trip
    // and cannot be confused with a delivery failure.
    if (opts.kind && LIFECYCLE_KINDS.has(opts.kind)) {
        return lifecycleKindRefusal(opts.kind);
    }
    const ch = await (0, channel_shared_1.resolveChannelOr)(client, channelRef);
    if ((0, channel_shared_1.isErr)(ch))
        return ch;
    const chName = (0, channel_shared_1.inlineOr)(ch.name, NO_NAME);
    // Resolve the addressee reference (email or user id) like invite does —
    // to a workspace member. The route then enforces channel membership.
    let toUserId;
    let toLabel;
    if (opts.to) {
        const member = await (0, channel_shared_1.resolveMemberOr)(client, opts.to);
        if ((0, channel_shared_1.isErr)(member))
            return member;
        toUserId = member.userId;
        toLabel = member.label;
    }
    // Thread the post under a thread when `thread` is passed: fold the id into
    // the STORAGE key `metadata.taskId` (the explicit param wins over any
    // metadata copy). The route then server-validates it resolves to a thread
    // in this channel.
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
            toUserId,
            summary: opts.summary,
            // Absent unless the caller said so: an omitted `intent` means `request`
            // and stamps no metadata key at all (service-writes-metadata.ts).
            intent: opts.intent,
        });
    }
    catch (e) {
        // Q9 — map the route's 400s off the CODE, not off which params happened to
        // be set. The old branch guessed: `to` set → blame the addressee, else
        // `thread` set → blame the thread, else fall through and rethrow a raw 400.
        // That is wrong whenever the route rejected the BODY (a >16000-char body, a
        // >200-char summary) — the commonest 400 of the three, and the one where
        // "invite them first" sends the agent to a contradictory second error.
        if ((0, channel_errors_1.isBadRequest)(e)) {
            switch ((0, channel_errors_1.classifyBadRequest)(e)) {
                case "addressee_not_member":
                    return (0, respond_1.err)(`Couldn't address the message to ${toLabel ?? "that member"} — they aren't a member of **${chName}**. Invite them first (op="invite"), or post without \`to\`.`);
                case "thread_not_in_channel":
                    return (0, respond_1.err)(`That thread is not in this channel — check the thread id, or post without \`thread\`.`);
                case "invalid_request":
                    return (0, respond_1.err)(`That post was rejected as INVALID before it reached **${chName}** — nothing was sent, and this is NOT a membership or thread problem, so do not invite anyone or change \`thread\` over it.${(0, channel_errors_1.serverDetail)(e)} ${channel_errors_1.FIELD_CAPS_NOTE} Shorten the field that is over and post again.`);
                case "workspace":
                    return (0, respond_1.err)(`The post was rejected because the call carried no usable workspace.${(0, channel_errors_1.serverDetail)(e)} This is a connection-level problem, not a channel one — report it to your operator.`);
                // The local guard at the top of this op already refuses this pair, so
                // reaching here means the two disagree — answer with the RULE, not with
                // "the server named a cause this tool does not recognize".
                case "chat_addressed":
                    return (0, respond_1.err)(channel_post_notes_1.CHAT_ADDRESSED_REFUSAL);
                // `self_target` is a create_thread-only rejection — `post to=self` is
                // deliberately NOT guarded server-side (the receiving desktop already
                // classifies a self-addressed post as noise, and a post is not a
                // thread), so this arm is unreachable and exists to keep the switch
                // exhaustive rather than to invent a cause the post never has.
                // The REMOVED params (`to_agent` / `as_agent`, rollback §1) come back
                // as `invalid_request` above, since the route refuses them in its zod
                // schema. This tool cannot send one — they are not in `CHANNEL_INPUT_SHAPE`
                // — so that arm is only ever reached by a caller bypassing the tool.
                case "self_target":
                case "unknown":
                    return (0, respond_1.err)(`The post to **${chName}** was rejected (HTTP 400) and the server did not name a cause this tool recognizes.${(0, channel_errors_1.serverDetail)(e)} Nothing was sent.`);
            }
        }
        // THE 403s A POST CAN GET, TOLD APART BY THEIR CODE rather than by which
        // params happened to be set. There used to be a third — `agent_owner`, an
        // `as_agent` naming somebody else's agent — and it went with the param.
        if ((0, channel_errors_1.isForbidden)(e)) {
            const kind = (0, channel_errors_1.classifyForbidden)(e);
            // P0-2 — the SERVER refused the kind. Unreachable while the guard at the
            // top of this op is in place, and answered anyway with the same sentence
            // rather than falling into an arm that talks about channel membership.
            if (kind === "lifecycle_kind") {
                return lifecycleKindRefusal(opts.kind ?? "task_finished");
            }
            if (opts.thread && kind !== "not_a_member") {
                // A thread belongs to its CREATOR and the member it is addressed to,
                // and that pair is the whole write gate again: the participant-set
                // regime that briefly widened it — where the fix was to name your own
                // agent with `as_agent` — is gone (rollback §1).
                //
                // The thread id is NOT echoed into this line. It is the caller's own
                // argument, but it round-trips: an agent copies an id out of a `read`
                // legend, and a legend id is `metadata.taskId`, which a peer sets
                // verbatim for any non-UUID value (Q1-E, the same reason close_thread
                // neutralizes it). "the id you just passed" needs no escaping and the
                // caller has the value in hand.
                return (0, respond_1.err)(`You can't post into that thread — nothing was posted. A thread is between the member who OPENED it and the member it is addressed TO, and you are neither: check it with dopl_channel(op="get_thread", channel="${ch.id}", thread=<the id you just passed>). Post into the channel instead, or ask one of those two to open a thread with you. Do NOT open your own thread for the same work; that is a duplicate room, not a way in.`);
            }
            if (kind === "not_a_member") {
                return (0, respond_1.err)(`You can't post to **${chName}** — you are not a member of that channel. Nothing was posted.`);
            }
        }
        throw e;
    }
    const kindNote = message.kind !== "message" ? `, kind ${message.kind}` : "";
    // `toLabel` is a member label, already render-safe from its resolver. The two
    // agent clauses are assembled next door, where the rest of the addressing
    // narration lives.
    const toNote = toLabel ? `, addressed to ${toLabel}` : "";
    // THE ADDRESSING LINE — the addressed/chat/unaddressed verdict, in
    // `channel-post-notes.ts` (SHOULD-FIX-6) beside the two result-line modules
    // this op already delegated to. `landedThread` is read back off the STORED
    // message for the same reason the linkage note is: what actually landed, not
    // what was asked for.
    const addressLines = (0, channel_post_notes_1.postAddressLines)({
        channelId: ch.id,
        safeChannelName: chName,
        isDirect: ch.isDirect,
        intent: opts.intent,
        toLabel,
        landedThread: (0, channel_shared_1.metaString)(message, "taskId"),
    });
    // Q7: second line, right under the confirmation — a sender cannot otherwise
    // tell continuation from new request, and the tag drop it catches is silent.
    const linkage = await (0, channel_post_linkage_1.threadLinkageNote)(client, ch.id, chName, message, 
    // THE CALLER NAMED A THREAD IF EITHER ARGUMENT CARRIED ONE (2026-08-07). `thread` is the
    // documented way, but `metadata` is a caller-settable passthrough whose own schema
    // description tells agents to put `taskId` in it ("{taskId, status, durationMs, refs}"),
    // and `opPost` forwards it untouched when `thread` is absent — so a post tagged that way
    // reached the note looking unthreaded. It then asserted "You named no thread — the server
    // attached this to your one open exchange" and warned that a second open thread would
    // break the linkage: both halves false, and the warning tells an agent its working code
    // is about to stop working, which is the exact "reads as a regression" harm the note was
    // added to prevent.
    opts.thread ??
        (typeof opts.metadata?.taskId === "string" && opts.metadata.taskId.trim()
            ? opts.metadata.taskId
            : undefined));
    return (0, respond_1.ok)([
        `Posted to **${chName}** (message \`${message.id}\`, seq ${message.seq}${kindNote}${toNote}). Readers watching with op="await" will pick it up.`,
        ...addressLines,
        ...(linkage ? [linkage] : []),
        // F6 — read off the SERVER's answer, not off anything this tool guessed.
        // A closed thread still accepts the post (decided: warn, never refuse —
        // a 403 would break the legitimate final-word-after-the-close-echo
        // pattern), so this is the only thing that tells the sender the exchange
        // it just posted into has stopped routing.
        ...(message.threadClosed ? [(0, channel_post_linkage_1.closedThreadNote)(ch.id)] : []),
        // WAKE-V1 teaching: a posted request that no one is waiting on is where
        // the exchange dies. WHETHER the await outlives this turn is not ours to
        // assert — `channel-wake-guidance.ts` owns that, off the caller's observed
        // runtime, and it used to be promised unconditionally and falsely.
        //
        // The stop rule (M3) rides with it: "re-arm on timeout" with no exit loops
        // forever over an abandoned exchange — but a plain timeout COUNTER would
        // abandon a peer that is legitimately heads-down for 20+ minutes. The exit
        // is the THREAD's state, checked periodically.
        ...(0, channel_wake_guidance_1.postReplyLines)(ch.id, message.seq, opts.runtime ?? null, `Keep re-arming while the exchange is alive; an agent working a real task can be quiet for a long stretch. Every ~3 empty holds, check first (op="read" for new activity — a working agent posts task_progress as it goes; op="get_thread" for status). Judge that on the member you addressed alone: in a channel with others, their traffic is not evidence YOUR exchange is alive. STOP and report to your operator when the thread is closed or failed, or when nothing has come from that member for ~30+ minutes.`),
    ].join("\n"));
}
