"use strict";
/**
 * `dopl_channel` WRITE op handlers: open (create a channel or direct message),
 * invite (add a workspace member), post (send a message or activity event). The
 * first-class thread ops moved to `channel-ops-threads.ts` at the §2 500-line
 * cap. Maps @dopl/client 4xx collisions to actionable messages. Routed from the
 * registrar in channel.ts.
 *
 * BOUNDARY: the wire/storage name `task` == the domain name `thread`. The
 * `thread` op param folds into `metadata.taskId` and the `task_*` message
 * kinds keep their stored names; only the agent-facing surface says `thread`.
 *
 * PEER-CONTROLLED TEXT (Q1, write side). The read ops were swept first and the
 * write ops were never enumerated, so the same defect survived here: every
 * string below is server NARRATION — no untrusted-content framing, read by the
 * model as the tool speaking — and two peer-authored values are spliced into it.
 *
 *   - `ch.name`, at nearly every site in this file. `resolveChannelOr` lists
 *     channels including PUBLIC ones the caller was never invited to, so the
 *     name can come from someone the agent has had no contact with; the reach is
 *     lower than `op="list"`'s (the agent must name the channel) but it is not
 *     zero. `features/channels/schema.ts` bounded it at 120 characters with NO
 *     charset rule, so it could carry the newlines that forge a line — that gap
 *     is closed there too now, in the same change.
 *   - `member.label` / `toLabel` — `profiles.display_name`. Render-safe by the
 *     time it arrives: `resolveMemberOr` neutralizes at the source, so the label
 *     is spliced directly here and must NOT be neutralized twice.
 *
 * Peer TITLES (thread names) render in `channel-post-linkage.ts` — the post's
 * did-it-thread line, split out of this file at the §2 cap — and across
 * `channel-ops-threads.ts`; the untrusted-content headers they carry live in
 * `channel-render.ts` with the read side's, one definition each.
 *
 * MULTIPLAYER: `to_agent` / `as_agent` are resolved through
 * `channel-agent-refs.ts`, which also owns how an agent handle is rendered (as a
 * value, and never without the immutable agent id beside it).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.opOpen = opOpen;
exports.opInvite = opInvite;
exports.opPost = opPost;
const respond_1 = require("./respond");
// Agent identity (handle→row resolution, and how a handle is rendered) is one
// module for the whole tool — post, create_thread and get_thread share it.
const channel_agent_refs_1 = require("./channel-agent-refs");
// A post's result lines each live in their own module — this one answers "did
// it thread?", which is the question a sender cannot otherwise settle.
const channel_post_linkage_1 = require("./channel-post-linkage");
const channel_shared_1 = require("./channel-shared");
// The addressing rule has ONE statement, in one module, because stating it per
// site is how three files came to agree with each other and disagree with
// `classify`. See channel-addressing.ts for what each fact is verified against.
const channel_addressing_1 = require("./channel-addressing");
// Whether a pending `await` can outlive the turn is a CLIENT property this
// server cannot see. One module decides what may be claimed about it.
const channel_wake_guidance_1 = require("./channel-wake-guidance");
// Q9 — a 400's MEANING is read off its code, not guessed from its status. See
// channel-errors.ts for why the old status-only branch answered every failure
// with "invite them first".
const channel_errors_1 = require("./channel-errors");
/** Fallback for peer text that neutralized to nothing — never an empty span. */
const NO_NAME = "(unnamed)";
async function opOpen(client, opts) {
    // Direct branch: open (or dedup-return) a 1:1 channel with `member`. The
    // server dedups a repeat DM to the same peer, so this is idempotent.
    if (opts.direct) {
        const member = await (0, channel_shared_1.resolveMemberOr)(client, opts.member);
        if ((0, channel_shared_1.isErr)(member))
            return member;
        const channel = await client.createChannel({
            direct: true,
            memberUserId: member.userId,
        });
        return (0, respond_1.ok)([
            `Opened a direct message with ${member.label} (id: \`${channel.id}\` · slug: \`${channel.slug}\`).`,
            `Post with dopl_channel(op="post", channel="${channel.id}", body="...").`,
        ].join("\n"));
    }
    const name = opts.name;
    let channel;
    try {
        channel = await client.createChannel({
            name,
            topic: opts.topic,
            visibility: opts.visibility,
        });
    }
    catch (e) {
        if ((0, respond_1.isAlreadyExists)(e)) {
            // NOT a duplicate-name collision: duplicate names auto-dedupe via slug
            // suffixing. A 409 here is a transient same-derived-slug insert race
            // between two concurrent opens — nothing was created, and a retry
            // (which derives the next free slug) succeeds.
            return (0, respond_1.err)(`Hit a transient naming conflict creating "${name}" (a rare concurrent-open race on the derived slug). Nothing was created — just retry the same open and it should succeed.`);
        }
        throw e;
    }
    const visNote = channel.visibility === "private"
        ? "Private — only invited members can see it."
        : "Public — visible to the whole workspace.";
    return (0, respond_1.ok)([
        // The caller's own name, one argument old — neutralized on the same flat
        // rule as everything else rather than on a per-site judgement about who
        // could have authored it. Judging per site is what left close_thread raw.
        `Created channel **${(0, channel_shared_1.inlineOr)(channel.name, NO_NAME)}** (slug: \`${channel.slug}\` · id: \`${channel.id}\`). ${visNote}`,
        `Post with dopl_channel(op="post", channel="${channel.slug}", body="..."); add members with op="invite".`,
    ].join("\n"));
}
async function opInvite(client, channelRef, memberRef) {
    const ch = await (0, channel_shared_1.resolveChannelOr)(client, channelRef);
    if ((0, channel_shared_1.isErr)(ch))
        return ch;
    const chName = (0, channel_shared_1.inlineOr)(ch.name, NO_NAME);
    const member = await (0, channel_shared_1.resolveMemberOr)(client, memberRef);
    if ((0, channel_shared_1.isErr)(member))
        return member;
    let added;
    try {
        added = await client.inviteToChannel(ch.id, member.userId);
    }
    catch (e) {
        if ((0, respond_1.isAlreadyExists)(e)) {
            return (0, respond_1.err)(`${member.label} is already a member of **${chName}**.`);
        }
        throw e;
    }
    return (0, respond_1.ok)(`Added ${member.label} to **${chName}** as ${added.role}.`);
}
async function opPost(client, channelRef, body, opts = {}) {
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
    // MULTIPLAYER: resolve the agent identities this post names — who it is FOR
    // (`to_agent`) and who it is FROM (`as_agent`) — against this channel's
    // roster, in one round-trip, and none at all when neither is set. Resolving
    // by HANDLE is the point: an agent knows the name the room addresses it by,
    // not a uuid. Ownership is still the server's check, not ours.
    const agentAddr = await (0, channel_agent_refs_1.resolvePostAgentsOr)(client, ch.id, opts.toAgent, opts.asAgent);
    if ((0, channel_shared_1.isErr)(agentAddr))
        return agentAddr;
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
            // Ids, not the caller's strings: the handle was already resolved to a row
            // of THIS channel above, and the route stamps what it is given.
            toAgent: agentAddr.to?.id,
            authorAgentId: agentAddr.as?.id,
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
                // `to_agent` / `as_agent` are resolved against THIS channel's roster
                // before the call, so the route agreeing that an agent is foreign means
                // the two reads disagree — say what the server said and re-read the
                // roster, rather than repeating a claim it just refused.
                case "agent_not_in_channel":
                    return (0, respond_1.err)(`The agent you named is not an agent of **${chName}**, so nothing was sent.${(0, channel_errors_1.serverDetail)(e)} Re-read the room's agents with dopl_channel(op="agents", channel="${ch.id}") and address one of those — a handle only ever names an agent inside ONE channel.`);
                // `self_target` is a create_thread-only rejection — `post to=self` is
                // deliberately NOT guarded server-side (the receiving desktop already
                // classifies a self-addressed post as noise, and a post is not a
                // thread), so this arm is unreachable and exists to keep the switch
                // exhaustive rather than to invent a cause the post never has.
                // `participant_not_member` is the same: only a thread CREATE (or a
                // join) seeds a participant set, so a post never raises it.
                case "self_target":
                case "participant_not_member":
                case "unknown":
                    return (0, respond_1.err)(`The post to **${chName}** was rejected (HTTP 400) and the server did not name a cause this tool recognizes.${(0, channel_errors_1.serverDetail)(e)} Nothing was sent.`);
            }
        }
        // THE TWO 403s A POST CAN GET, TOLD APART BY THEIR CODE rather than by
        // which params happened to be set. They can be raised by the same call —
        // `as_agent` + `thread` is the normal breakout-room shape — and the old
        // param-order guess reported the agent-ownership refusal for both, so a
        // thread-authorization failure came back as "that agent is not yours".
        if ((0, channel_errors_1.isForbidden)(e)) {
            const kind = (0, channel_errors_1.classifyForbidden)(e);
            // AN AGENT IDENTITY IS NOT ASSUMABLE. The server refuses `as_agent`
            // naming an agent the caller does not own; it never silently strips the
            // claim, so nothing was posted and the fix is to post as YOUR own agent
            // (op="agents" lists the room's, with their owners).
            if (kind === "agent_owner" || (kind === "unknown" && agentAddr.as && !opts.thread)) {
                return (0, respond_1.err)(`You can't post as ${agentAddr.as ? (0, channel_agent_refs_1.agentLabel)(agentAddr.as) : "that agent"} — an agent may only be spoken for by the member who summoned it, and the server verified this one is not yours. Nothing was posted. Post as your own agent, or without \`as_agent\`.`);
            }
            if (opts.thread && kind !== "not_a_member") {
                // S1 — THE REMEDY THAT MANUFACTURED A DUPLICATE ROOM. This arm used to
                // say "that thread belongs to two other members … open your own with
                // op=create_thread", which is wrong for the commonest cause: the write
                // gate (`mayWriteThread`, service-writes-metadata.ts) lets an AGENT
                // participant of a breakout thread post only when the call CLAIMS that
                // agent with `as_agent`. A thread the agent legitimately belongs to
                // therefore 403s on the missing param, and the advice sent it away to
                // open a second room for the same work. Name the missing param first.
                // The thread id is NOT echoed into these lines. It is the caller's own
                // argument, but it round-trips: an agent copies an id out of a `read`
                // legend, and a legend id is `metadata.taskId`, which a peer sets
                // verbatim for any non-UUID value (Q1-E, the same reason close_thread
                // neutralizes it). "the id you just passed" needs no escaping and the
                // caller has the value in hand.
                return (0, respond_1.err)(agentAddr.as
                    ? `You can't post into that thread as ${(0, channel_agent_refs_1.agentLabel)(agentAddr.as)} — nothing was posted. A thread with a participant set is a BREAKOUT ROOM and its SET decides who may write: check it with dopl_channel(op="get_thread", channel="${ch.id}", thread=<the id you just passed>). If you are not in it, ask the member who opened it (or the one it is addressed to) to admit you — do NOT open a second thread for the same work.`
                    : `You can't post into that thread — nothing was posted. FIRST TRY \`as_agent\`: if what admits you to that thread is one of YOUR AGENTS being in its participant set, the server checks the set against the agent you CLAIM, so the post is refused until you name it. Re-send the same post with as_agent="<your handle>". If you are not in the set at all — dopl_channel(op="get_thread", channel="${ch.id}", thread=<the id you just passed>) shows it — ask the member who opened the thread, or the one it is addressed to, to admit you with op="join_thread". Do NOT open your own thread for the same work; that is a duplicate room, not a way in.`);
            }
            if (kind === "not_a_member") {
                return (0, respond_1.err)(`You can't post to **${chName}** — you are not a member of that channel. Nothing was posted.`);
            }
        }
        throw e;
    }
    const kindNote = message.kind !== "message" ? `, kind ${message.kind}` : "";
    // Both agent notes render the handle WITH its id (`agentLabel`) — a handle
    // alone is the owner's claim about a name, and two rooms' agents may share
    // one. `toLabel` is a member label, already render-safe from its resolver.
    const toNote = toLabel ? `, addressed to ${toLabel}` : "";
    const toAgentNote = agentAddr.to
        ? `, addressed to agent ${(0, channel_agent_refs_1.agentLabel)(agentAddr.to)}`
        : "";
    const asNote = agentAddr.as ? `, as agent ${(0, channel_agent_refs_1.agentLabel)(agentAddr.as)}` : "";
    // N-PARTY — the silent drop this feature exists to prevent, in its addressing
    // form: an unaddressed post used to read exactly like an addressed one, so the
    // sender walked away believing an agent had it.
    //
    // WHAT IT MAY NOT CLAIM (2026-07-31). The first version of this note asserted
    // "nobody was woken by it" for every non-direct channel and offered a re-post
    // with `to=` as the remedy. That is false whenever the post THREADED: the
    // receiving desktop routes a first-class thread tag into a live session before
    // `classify` ever sees the addressing, so the note rendered "nobody was woken"
    // directly above `threadLinkageNote`'s "the other side reads this as a
    // continuation", and its remedy manufactured a duplicate request. The rule and
    // both of its shapes live in `channel-addressing.ts`; `landedThread` is read
    // back off the STORED message for the same reason the linkage note is (what
    // actually landed, not what was asked for).
    const landedThread = (0, channel_shared_1.metaString)(message, "taskId");
    const addressingNote = (0, channel_addressing_1.unaddressedPostNote)({
        ref: ch.id,
        isDirect: ch.isDirect,
        // An agent address IS an address: the server stamps the addressed agent's
        // OWNER as `to_user_id`, which is the field the receiving listener triggers
        // on, so a `to_agent` post wakes a machine exactly as a `to` post does.
        addressed: !!toLabel || !!agentAddr.to,
        landedThread,
    });
    // WHEN BOTH ADDRESSES ARE SET AND THEY DISAGREE, THE AGENT'S OWNER WINS. The
    // server stamps `to_user_id` from the addressed agent's owner and it takes
    // precedence over `to` (a handle names one machine unambiguously; a
    // disagreeing pair names none). Silently, until this line: a caller that
    // passed both would otherwise believe it had notified the person it named.
    const addressConflict = agentAddr.to && toUserId && agentAddr.to.ownerUserId !== toUserId
        ? [
            `NOTE: you set both \`to\` and \`to_agent\`, and they name different people. The AGENT's owner is who this reached — ${toLabel ?? "the member you named in \`to\`"} was not notified. Post again addressed to them alone if they also need it.`,
        ]
        : [];
    // Q7: second line, right under the confirmation — a sender cannot otherwise
    // tell continuation from new request, and the tag drop it catches is silent.
    const linkage = await (0, channel_post_linkage_1.threadLinkageNote)(client, ch.id, chName, message, opts.thread);
    return (0, respond_1.withCallerAgent)((0, respond_1.ok)([
        `Posted to **${chName}** (message \`${message.id}\`, seq ${message.seq}${kindNote}${toNote}${toAgentNote}${asNote}). Readers watching with op="await" will pick it up.`,
        ...addressConflict,
        ...(addressingNote ? [addressingNote] : []),
        ...(linkage ? [linkage] : []),
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
    ].join("\n")), 
    // LOCUS: this call spoke as an agent, so the `_dopl_status` footer says so.
    // Threaded through the RESULT rather than stamped on the session identity —
    // `as_agent` is per call, and a session may hold several agents.
    agentAddr.as ? { id: agentAddr.as.id, name: agentAddr.as.name } : null);
}
