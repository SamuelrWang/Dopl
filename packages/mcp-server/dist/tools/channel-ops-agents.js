"use strict";
/**
 * `dopl_channel` MULTIPLAYER op handlers: agents (list) / summon_agent /
 * rename_agent / set_agent_status / disengage_agent / join_thread /
 * leave_thread.
 *
 * A NEW file rather than more of `channel-ops-write.ts` (453 lines, §2): these
 * ops are about WHO IS IN THE ROOM, not about what gets said in it. Agent
 * identity itself — how a handle is resolved and how it is rendered — lives one
 * file over in `channel-agent-refs.ts`, because `post`, `create_thread` and
 * `get_thread` all need it and none of them belong here. The `channel-`
 * filename prefix is required by the parity split-scan (parity.test.ts).
 *
 * THE MODEL, once: a CHANNEL is a ROOM — its human members plus the named
 * agents they summon. A THREAD with a participant set is a BREAKOUT ROOM. An
 * agent is owned by ONE member and runs on THAT member's machine, so summoning
 * is member-gated and renaming / parking is owner-gated, server-side.
 *
 * NARRATION: every agent handle here is rendered by {@link agentLabel} and
 * every owner name by `memberRef` — both neutralized, both carrying the
 * immutable id. See the header of `channel-agent-refs.ts` for why a
 * charset-bounded handle is neutralized anyway.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.opAgents = opAgents;
exports.opSummonAgent = opSummonAgent;
exports.opRenameAgent = opRenameAgent;
exports.opSetAgentStatus = opSetAgentStatus;
exports.opDisengageAgent = opDisengageAgent;
exports.opJoinThread = opJoinThread;
exports.opLeaveThread = opLeaveThread;
const respond_1 = require("./respond");
const channel_shared_1 = require("./channel-shared");
const channel_render_1 = require("./channel-render");
const channel_agent_refs_1 = require("./channel-agent-refs");
const channel_errors_1 = require("./channel-errors");
/** Fallback for a channel name that neutralized to nothing. */
const NO_NAME = "(unnamed)";
// ─── agents (READ) ──────────────────────────────────────────────────
/**
 * The room's agent roster. A READ: the route gates it on the CHANNEL's own
 * visibility, because a peer has to see a handle before it can address it.
 *
 * Carries {@link UNTRUSTED_ROSTER_HEADER} rather than a fifth header of its
 * own: the untrusted half of these lines is the OWNER's
 * `profiles.display_name` — the same column, set by the same people, that the
 * member roster's header already frames.
 */
async function opAgents(client, channelRef, selfUserId = null) {
    const ch = await (0, channel_shared_1.resolveChannelOr)(client, channelRef);
    if ((0, channel_shared_1.isErr)(ch))
        return ch;
    const chName = (0, channel_shared_1.inlineOr)(ch.name, NO_NAME);
    const agents = await client.listChannelAgents(ch.id);
    if (agents.length === 0) {
        return (0, respond_1.ok)([
            `No agents in **${chName}** yet.`,
            `Summon one with dopl_channel(op="summon_agent", channel="${ch.id}") — it runs on YOUR machine and acts only when addressed.`,
        ].join("\n"));
    }
    const view = { selfUserId, names: await (0, channel_shared_1.memberNames)(client, ch.id) };
    const lines = [
        `## ${chName} — ${agents.length} agent${agents.length === 1 ? "" : "s"}\n`,
        `${channel_render_1.UNTRUSTED_ROSTER_HEADER}\n`,
    ];
    for (const a of agents) {
        lines.push(`- ${(0, channel_agent_refs_1.agentLabel)(a)} · ${a.status} · summoned by ${(0, channel_render_1.memberRef)(a.ownerUserId, view)}`);
    }
    lines.push(`\nAddress one with dopl_channel(op="post", channel="${ch.id}", to_agent="<handle>", body="...") — addressing is what makes an agent act. Address several at once with to_agents=["<handle>","<handle>"]. When a HUMAN addresses an agent it also ENGAGES it — it then acts on that person's unaddressed messages here until op="disengage_agent", a park/dismiss, or about an hour of quiet; a post of YOURS is agent-authored and engages nothing. An agent's OWNER is the only member who may rename or park it. The ids above are what the thread handshake sorts on when several agents are addressed together: the FIRST id lexicographically is the one that opens the thread.`);
    return (0, respond_1.ok)(lines.join("\n"));
}
// ─── summon / rename / status (WRITES) ──────────────────────────────
/**
 * Summon an agent into the channel. The caller becomes its OWNER, and the
 * handle comes from the server's curated pool unless one is asked for by name.
 */
async function opSummonAgent(client, channelRef, name) {
    const ch = await (0, channel_shared_1.resolveChannelOr)(client, channelRef);
    if ((0, channel_shared_1.isErr)(ch))
        return ch;
    const chName = (0, channel_shared_1.inlineOr)(ch.name, NO_NAME);
    let agent;
    try {
        agent = await client.createChannelAgent(ch.id, name ? { name } : {});
    }
    catch (e) {
        if ((0, respond_1.isAlreadyExists)(e)) {
            return (0, respond_1.err)(`An agent named ${(0, channel_shared_1.inlineOr)(name ?? "", channel_agent_refs_1.NO_HANDLE)} already exists in **${chName}** — handles are unique per channel, case-insensitively. Nothing was summoned: pick another name, or omit \`name\` and the server takes the next free one from its pool.`);
        }
        if ((0, channel_errors_1.isForbidden)(e)) {
            return (0, respond_1.err)(`You can't summon an agent in **${chName}** — you are not a member of it. Nothing was summoned.`);
        }
        if ((0, channel_errors_1.isBadRequest)(e)) {
            return (0, respond_1.err)(`That summon was rejected as invalid.${(0, channel_errors_1.serverDetail)(e)} A handle is 2-31 characters: a lowercase letter, then lowercase letters, digits or hyphens. Nothing was summoned.`);
        }
        throw e;
    }
    return (0, respond_1.ok)([
        `Summoned agent ${(0, channel_agent_refs_1.agentLabel)(agent)} into **${chName}** (status ${agent.status}). It is YOURS — it runs on your machine, and only you may rename or park it.`,
        // S3 — the call example takes the agent's ID, not its handle. `to_agent`
        // and `as_agent` both accept either, and the id is the half the SERVER
        // issued: splicing the handle raw into narration is the defect this
        // file's own header forbids, and neutralizing it would put backticks
        // inside a copy-pasteable argument. The handle is still stated, once,
        // through `agentLabel` on the line above.
        `It acts only when ADDRESSED: dopl_channel(op="post", channel="${ch.id}", to_agent="${agent.id}", body="...") — its handle works there too. When it posts, it posts as ITSELF: as_agent set to that same handle or id, which is REQUIRED for anything it writes to be attributed to it at all.`,
    ].join("\n"));
}
/** Rename an agent. OWNER ONLY — the server refuses anyone else. */
async function opRenameAgent(client, channelRef, agentRef, name) {
    const ch = await (0, channel_shared_1.resolveChannelOr)(client, channelRef);
    if ((0, channel_shared_1.isErr)(ch))
        return ch;
    const chName = (0, channel_shared_1.inlineOr)(ch.name, NO_NAME);
    const agent = await (0, channel_agent_refs_1.resolveAgentOr)(client, ch.id, agentRef);
    if ((0, channel_shared_1.isErr)(agent))
        return agent;
    const was = (0, channel_agent_refs_1.agentLabel)(agent);
    let renamed;
    try {
        renamed = await client.updateChannelAgent(ch.id, agent.id, { op: "rename", name });
    }
    catch (e) {
        const refused = agentWriteError(e, was, chName, "rename");
        if (refused)
            return refused;
        throw e;
    }
    return (0, respond_1.ok)(`Renamed ${was} to ${(0, channel_agent_refs_1.agentLabel)(renamed)} in **${chName}**. Address it by its NEW handle from here on — the id is unchanged.`);
}
/**
 * Move an agent along its lifecycle. OWNER ONLY — the states describe a
 * process on the owner's own machine.
 */
async function opSetAgentStatus(client, channelRef, agentRef, status) {
    const ch = await (0, channel_shared_1.resolveChannelOr)(client, channelRef);
    if ((0, channel_shared_1.isErr)(ch))
        return ch;
    const chName = (0, channel_shared_1.inlineOr)(ch.name, NO_NAME);
    const agent = await (0, channel_agent_refs_1.resolveAgentOr)(client, ch.id, agentRef);
    if ((0, channel_shared_1.isErr)(agent))
        return agent;
    const label = (0, channel_agent_refs_1.agentLabel)(agent);
    let updated;
    try {
        updated = await client.updateChannelAgent(ch.id, agent.id, {
            op: "set_status",
            status,
        });
    }
    catch (e) {
        const refused = agentWriteError(e, label, chName, "change the status of");
        if (refused)
            return refused;
        throw e;
    }
    // `dismissed` is a STATUS, not a delete — say so, because an agent that
    // believes dismissal erases its posts will re-post them under a new handle.
    const note = updated.status === "dismissed"
        ? " It keeps its row and its handle, so everything it already posted stays attributed to it."
        : "";
    return (0, respond_1.ok)(`Set ${(0, channel_agent_refs_1.agentLabel)(updated)} in **${chName}** to ${updated.status}.${note}`);
}
/**
 * END an agent's ENGAGEMENT — it goes back to IDLE: still in the room, still
 * reading everything, acting only on messages that TAG it.
 *
 * NOT OWNER-ONLY, and it is the only write in this file that is not. The server
 * allows the owner OR the human recorded as having engaged it
 * (`service-agents.ts#disengageAgent`), because engagement is a relationship
 * between an agent and the person who addressed it: ending an agent's attention
 * to YOUR messages is a different act from parking somebody else's process. The
 * refusal text below therefore may NOT reuse {@link agentWriteError}'s "an agent
 * belongs to the member who summoned it" line — that sentence is true of rename
 * and park and false here, and an engager told they must own the agent would
 * stop asking for the one thing they are entitled to do.
 *
 * IDEMPOTENT server-side: an already-idle agent clears to the same two nulls, so
 * this reads the same whether or not anything was engaged. That is stated rather
 * than hidden — an agent that reads "disengaged" as proof it HAD been engaged
 * would infer an exchange that never happened.
 *
 * THE RESULT MAY NOT OFFER THE CALLER A RE-ENGAGE, and it did until 2026-07-31
 * ("address it by handle again — that re-engages it"). `recordAgentEngagement`
 * (`service-writes-agents.ts`) now opens with `if (ctx.source === "agent")
 * return;` — engagement requires a HUMAN CREDENTIAL, because `authorKind` is
 * caller-assertable and `ctx.source` is derived from the token — and every post
 * made through this tool carries an agent token. So the one remedy the op
 * offered was an effect the reader cannot cause: it would tag the agent, watch
 * it answer that single message, and find it idle again on the next turn with
 * nothing saying why. What the reader CAN cause is a THREAD with a participant
 * set, which is the sustained-attention mechanism that does not go through
 * engagement at all — so that is what the result names instead.
 */
async function opDisengageAgent(client, channelRef, agentRef) {
    const ch = await (0, channel_shared_1.resolveChannelOr)(client, channelRef);
    if ((0, channel_shared_1.isErr)(ch))
        return ch;
    const chName = (0, channel_shared_1.inlineOr)(ch.name, NO_NAME);
    const agent = await (0, channel_agent_refs_1.resolveAgentOr)(client, ch.id, agentRef);
    if ((0, channel_shared_1.isErr)(agent))
        return agent;
    const label = (0, channel_agent_refs_1.agentLabel)(agent);
    let updated;
    try {
        updated = await client.updateChannelAgent(ch.id, agent.id, {
            op: "disengage",
        });
    }
    catch (e) {
        if ((0, channel_errors_1.isForbidden)(e)) {
            return (0, respond_1.err)(`You can't disengage ${label} — nothing changed. An agent's engagement may be ended by the member who SUMMONED it or by the human who ENGAGED it (the one whose messages it has been acting on), and the server says you are neither. If it is answering YOU when it should not be, say so in the room; if it is somebody else's exchange, leave it alone.`);
        }
        if ((0, respond_1.isNotFound)(e)) {
            return (0, respond_1.err)(`No such agent in **${chName}** — nothing changed.`);
        }
        throw e;
    }
    return (0, respond_1.ok)([
        `Disengaged ${(0, channel_agent_refs_1.agentLabel)(updated)} in **${chName}** — it is IDLE again: it still sees everything in this channel and now acts only on messages that ADDRESS it (to_agent="<handle>").`,
        `Idempotent, so this says the same thing whether it was engaged or already idle. YOU CANNOT RE-ENGAGE IT — engagement is stamped only for a HUMAN author (\`recordAgentEngagement\` returns before it reads anything when the credential is an agent's), and every post you make through this tool is agent-credentialed. Addressing it by handle again still DELIVERS and still makes it act on THAT message; it just leaves it idle afterwards, so you would have to tag it again on every turn. Only a person can put it back on standing attention, by addressing it themselves.`,
        `IF WHAT YOU WANT IS SUSTAINED JOINT WORK, THAT IS A THREAD, NOT AN ENGAGEMENT: open one with dopl_channel(op="create_thread", channel="${ch.id}", to="<a member>", participants=["agent:<its handle>"], title="...", body="..."). Its participant set — not a tag and not an engagement window — is then who may read and write there, for as long as the thread is open.`,
    ].join("\n"));
}
/**
 * The refusals both agent writes share, mapped off the status. Null when the
 * error is none of them, so the caller rethrows rather than inventing a cause.
 * `label` is ALREADY render-safe ({@link agentLabel}) — do not re-wrap it.
 */
function agentWriteError(e, label, safeChannelName, verb) {
    if ((0, channel_errors_1.isForbidden)(e)) {
        return (0, respond_1.err)(`You can't ${verb} ${label} — an agent belongs to the member who summoned it, and only that member may rename or park it. Nothing changed.`);
    }
    if ((0, respond_1.isNotFound)(e)) {
        return (0, respond_1.err)(`No such agent in **${safeChannelName}** — nothing changed.`);
    }
    if ((0, respond_1.isAlreadyExists)(e)) {
        return (0, respond_1.err)(`That handle is already taken in **${safeChannelName}** — handles are unique per channel, case-insensitively. Nothing changed.`);
    }
    if ((0, channel_errors_1.isBadRequest)(e)) {
        return (0, respond_1.err)(`That change was rejected as invalid.${(0, channel_errors_1.serverDetail)(e)} A handle is 2-31 characters: a lowercase letter, then lowercase letters, digits or hyphens. Nothing changed.`);
    }
    return null;
}
/**
 * Admit an identity to a thread's participant set — which is what makes the
 * thread a BREAKOUT ROOM. Idempotent server-side: joining twice returns the row
 * already there, so a retry converges instead of erroring.
 */
async function opJoinThread(client, channelRef, threadId, who) {
    const ch = await (0, channel_shared_1.resolveChannelOr)(client, channelRef);
    if ((0, channel_shared_1.isErr)(ch))
        return ch;
    const chName = (0, channel_shared_1.inlineOr)(ch.name, NO_NAME);
    const resolved = await resolveParticipantOr(client, ch.id, who);
    if ((0, channel_shared_1.isErr)(resolved))
        return resolved;
    let participant;
    try {
        participant = await client.addThreadParticipant(ch.id, threadId, resolved.ref);
    }
    catch (e) {
        const refused = participantWriteError(e, threadId, chName, "admit", 
        // The CURATION rule, which is what a TASK_FORBIDDEN on a join means.
        `You can't admit anyone to thread ${(0, channel_shared_1.inlineOr)(threadId, channel_agent_refs_1.NO_AGENT_ID)} — nothing changed, and you have NOT been removed from **${chName}**. A breakout room's participant set is curated by the member who OPENED that thread, the member it is ADDRESSED TO, and the people already in the set; you are none of those. Ask one of them to admit you — dopl_channel(op="post", channel="${ch.id}", to="<one of them>", thread=<the id you just passed>, body="...") reaches them. Do NOT open your own thread for the same work; that is a duplicate room, not a way in.`);
        if (refused)
            return refused;
        throw e;
    }
    // NIT-8 — the SAME value, through the SAME container as every other mention
    // of a thread id in this file. It was a hand-built code span here and
    // `inlineOr(threadId, NO_AGENT_ID)` on every error path three lines up, which
    // is the "judged per site" reasoning this file's header forbids: the argument
    // for leaving it raw is that a server-issued uuid cannot carry a backtick,
    // and that argument is exactly the one that left `close_thread` rendering a
    // raw peer title through a whole audit. One rule, one container.
    //
    // The `thread="..."` COPY-PASTEABLE ARGUMENTS below stay raw, on the rule
    // `opSummonAgent` already states for `agent.id`: a neutralized value carries
    // its own backticks, and backticks inside a quoted call argument produce a
    // call that does not work. Narration is wrapped; arguments are not.
    const safeThreadId = (0, channel_shared_1.inlineOr)(participant.threadId, channel_agent_refs_1.NO_AGENT_ID);
    return (0, respond_1.ok)([
        `Added ${resolved.label} to thread ${safeThreadId} in **${chName}** — that thread is now a BREAKOUT ROOM, and its participant set is who may post into it.`,
        resolved.ref.kind === "agent"
            ? `The agent still acts only when ADDRESSED: post into the thread with thread="${participant.threadId}" and to_agent="<handle>". And when that agent POSTS into this thread it must name itself — as_agent="<its handle>" — because the server checks the set against the agent a post CLAIMS; without it the post is refused.`
            : // B3 — ADMITTING NOBODY IS TOLD. `joinThreadParticipant` inserts one
                // row and posts nothing, and `channel_task_participants` is
                // deliberately NOT in the realtime publication, so there is no
                // message, no notification and no push on any surface. This line used
                // to claim "admitting a PERSON notifies them", which is the same
                // class of false promise as the escalation rule it echoed.
                `Admitting a PERSON notifies NOBODY: this writes one row and sends no message, and nothing pushes it to them. It never spawns their agent either. If they need to know, TELL them — dopl_channel(op="post", channel="${ch.id}", thread="${participant.threadId}", to="<them>", body="..."). Address an agent by handle when you need one to act.`,
    ].join("\n"));
}
/** Remove an identity from a thread's participant set. Idempotent. */
async function opLeaveThread(client, channelRef, threadId, who) {
    const ch = await (0, channel_shared_1.resolveChannelOr)(client, channelRef);
    if ((0, channel_shared_1.isErr)(ch))
        return ch;
    const chName = (0, channel_shared_1.inlineOr)(ch.name, NO_NAME);
    const resolved = await resolveParticipantOr(client, ch.id, who);
    if ((0, channel_shared_1.isErr)(resolved))
        return resolved;
    try {
        await client.removeThreadParticipant(ch.id, threadId, resolved.ref);
    }
    catch (e) {
        const refused = participantWriteError(e, threadId, chName, "remove", 
        // The EJECT rule, which is narrower than the curation rule on join.
        `You can't remove ${resolved.label} from thread ${(0, channel_shared_1.inlineOr)(threadId, channel_agent_refs_1.NO_AGENT_ID)} — nothing changed, and you have NOT been removed from **${chName}**. You may always take YOURSELF out of a breakout room, or an agent you own; ejecting anyone else is the call of the member who opened the thread or the member it is addressed to. Ask one of them.`);
        if (refused)
            return refused;
        throw e;
    }
    return (0, respond_1.ok)(`Removed ${resolved.label} from thread ${(0, channel_shared_1.inlineOr)(threadId, channel_agent_refs_1.NO_AGENT_ID)} in **${chName}**. Leaving is idempotent — this reads the same whether a row went away or there was none to remove.`);
}
/**
 * Resolve the ONE identity a join/leave names. Exactly one of `member` /
 * `agent` — naming both is refused rather than silently preferring one, since
 * the two address different machines.
 */
async function resolveParticipantOr(client, channelId, who) {
    if (who.member && who.agent) {
        return (0, respond_1.err)(`Pass either \`member\` (a person) or \`agent\` (a named agent), not both — they name different participants.`);
    }
    if (who.agent) {
        const agent = await (0, channel_agent_refs_1.resolveAgentOr)(client, channelId, who.agent);
        if ((0, channel_shared_1.isErr)(agent))
            return agent;
        return { ref: { kind: "agent", id: agent.id }, label: (0, channel_agent_refs_1.agentLabel)(agent) };
    }
    if (who.member) {
        const member = await (0, channel_shared_1.resolveMemberOr)(client, who.member);
        if ((0, channel_shared_1.isErr)(member))
            return member;
        return { ref: { kind: "user", id: member.userId }, label: member.label };
    }
    return (0, respond_1.err)(`Name who is joining or leaving: \`member\`=<email or user id> for a person, or \`agent\`=<handle or agent id> for an agent.`);
}
/**
 * The refusals a participant write shares. Null when it is none of them.
 *
 * THE TWO 403s ARE NOT THE SAME REFUSAL, and mapping both onto "you are not a
 * member of that channel" was a lie with a scary shape: an agent refused by the
 * CURATION rule told its operator they had been removed from the room. The
 * routes raise `CHANNEL_FORBIDDEN` for a caller outside the channel and
 * `TASK_FORBIDDEN` for a caller inside it who has no authority over THIS
 * THREAD (service-participants.ts), so the code is read rather than guessed —
 * the same doctrine as the 400 mapping. `curation` is the thread-authorization
 * arm, and it differs per op (admitting is curated by three parties, ejecting
 * by two), so the caller passes the one that fits.
 */
function participantWriteError(e, threadId, safeChannelName, verb, curation) {
    if ((0, respond_1.isNotFound)(e)) {
        return (0, respond_1.err)(`No thread ${(0, channel_shared_1.inlineOr)(threadId, channel_agent_refs_1.NO_AGENT_ID)} in **${safeChannelName}**. List them with op="list_threads".`);
    }
    if ((0, channel_errors_1.isForbidden)(e)) {
        switch ((0, channel_errors_1.classifyForbidden)(e)) {
            case "thread_authorization":
                return (0, respond_1.err)(curation);
            case "not_a_member":
                return (0, respond_1.err)(`You can't ${verb} participants in **${safeChannelName}** — you are not a member of that channel. Nothing changed.`);
            default:
                // NOT "you are not a member": an uncoded 403 on a thread route is far
                // more likely to be a thread rule than a channel one, and telling an
                // agent it left the room is the failure this switch exists to end.
                return (0, respond_1.err)(`The server refused to ${verb} that participant (HTTP 403) and did not name a cause this tool recognizes.${(0, channel_errors_1.serverDetail)(e)} Nothing changed — check the thread with op="get_thread" before retrying.`);
        }
    }
    if ((0, channel_errors_1.isBadRequest)(e)) {
        return (0, respond_1.err)(`That participant change was rejected.${(0, channel_errors_1.serverDetail)(e)} A participant must already belong to the channel: a person as a MEMBER, an agent as an agent OF THIS CHANNEL. Nothing changed.`);
    }
    return null;
}
