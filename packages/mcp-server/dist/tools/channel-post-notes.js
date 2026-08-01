"use strict";
/**
 * WHAT A POST'S ADDRESSING ACTUALLY DID — the three result lines that answer it,
 * plus the one refusal that fires when a post's addressing contradicts itself.
 *
 * Split out of `channel-ops-write.ts` at the §2 500-line cap (SHOULD-FIX-6),
 * along the seam that file had already drawn twice and then stopped drawing:
 * every OTHER line of a post's result lives in its own module already —
 * `channel-post-linkage.ts` answers "did it thread?", `channel-addressing.ts`
 * owns the unaddressed rule, `channel-wake-guidance.ts` owns what may be
 * claimed about waiting. These three were the residue, and they are the same
 * kind of thing: narration ABOUT an address, assembled from a resolved post and
 * the message the server wrote back. `opPost` is left as what it should be —
 * resolve, call, map the failures, hand the outcome here.
 *
 * The `channel-` filename prefix is required by the parity split-scan
 * (parity.test.ts).
 *
 * THE TEXT DISCIPLINE IS INHERITED, NOT RESTATED. Every string below is server
 * NARRATION with no untrusted-content framing around it. Two peer-authored
 * values reach it and both arrive ALREADY render-safe: `safeChannelName` is
 * neutralized by its caller, and a member `label` is neutralized at its source
 * (`resolveMemberOr`). Neither may be neutralized again — double-wrapping
 * strips the span's own backticks and hands back the bare name, i.e. the bug.
 * Agent handles go through `agentLabel`, which carries the immutable id.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.CHAT_ADDRESSED_REFUSAL = void 0;
exports.postAddressLines = postAddressLines;
exports.agentAttributionNotes = agentAttributionNotes;
const channel_agent_refs_1 = require("./channel-agent-refs");
const channel_addressing_1 = require("./channel-addressing");
/**
 * THE ONE SENTENCE for `intent:"chat"` + an address, said in both places it can
 * be reached: `opPost`'s local guard (which catches it before anything is sent)
 * and the route's `CHANNEL_CHAT_ADDRESSED` 400 (which catches it if the two ever
 * disagree). One constant, because two statements of one rule is how the copy in
 * this tool drifted from the code three times already.
 *
 * The rule is not a validation nicety. `chat` means "reach nobody's agent" and
 * an address means "reach exactly this one"; honouring either half would deliver
 * a message whose sender and whose recipient's machine disagree about what it
 * is, which is the silent-delivery failure the whole addressing contract exists
 * to prevent. So it is refused and the CALLER chooses.
 */
exports.CHAT_ADDRESSED_REFUSAL = 'A message with `intent`="chat" cannot be addressed — nothing was sent. "chat" means the humans in the room, reaching nobody\'s agent; `to` / `to_agent` / `to_agents` mean the opposite, and the server refuses the pair rather than guessing which half you meant. Send it as CHAT by dropping the address, or as a REQUEST by dropping `intent` (a request is the default).';
/**
 * The address lines for one successful post, in the order they are read.
 *
 * Empty is a legitimate answer: an ordinary addressed post in a live thread has
 * nothing to warn about and says nothing.
 */
function postAddressLines(f) {
    return [
        ...addressConflictLines(f),
        ...multiAddressLines(f),
        ...addressingNoteLines(f),
    ];
}
/**
 * WHEN BOTH ADDRESSES ARE SET AND THEY DISAGREE, THE AGENT'S OWNER WINS. The
 * server stamps `to_user_id` from the addressed agent's owner and it takes
 * precedence over `to` (a handle names one machine unambiguously; a disagreeing
 * pair names none). Silently, until this line: a caller that passed both would
 * otherwise believe it had notified the person it named.
 */
function addressConflictLines(f) {
    const head = f.toAgents[0];
    if (!head || !f.toUserId || head.ownerUserId === f.toUserId)
        return [];
    return [
        `NOTE: you set both \`to\` and an AGENT address, and they name different people. The FIRST addressed agent's owner is who this reached — ${f.toLabel ?? "the member you named in `to`"} was not notified. Post again addressed to them alone if they also need it.`,
    ];
}
/**
 * MULTI-ADDRESS — say what N addresses actually did, because "addressed to 2
 * agents" reads like one delivery to a pair and it is not: each agent is reached
 * on its OWNER's machine, independently, and the two may be different machines.
 *
 * The handshake line is the other half: both of them are now about to decide
 * whether to open a thread, and two threads for one request is the failure that
 * contract exists to stop. THE KEY IS SPELLED WITH THE CHANNEL'S UUID (BLOCKER-1)
 * — `channelId` here is the resolved `ch.id`, never the slug the caller may have
 * passed — because a slug-built key derives no participant set and 403s the
 * co-addressed agent out of the room it was told to join.
 */
function multiAddressLines(f) {
    if (f.toAgents.length <= 1)
        return [];
    return [
        `ADDRESSED ${f.toAgents.length} AGENTS. Each one is reached on ITS OWN owner's machine, separately — this is not one delivery to a group, and they may be different people's machines. The member stamped as this post's human addressee is the owner of the FIRST one you named. If the work needs a thread, exactly ONE of them opens it (the one whose agent id sorts first) with client_msg_id="thread-open-${f.channelId}-${f.seq}" — that is the channel's UUID and the seq of THIS message, and both halves matter: a key built from the slug opens a thread the others cannot write into. Say so in the body if you want to be sure, and expect ONE thread back, not ${f.toAgents.length}.`,
    ];
}
/**
 * The "who was this put in front of" line — or nothing, when the post named
 * somebody and there is nothing to warn about.
 *
 * CHAT IS UNADDRESSED ON PURPOSE, so it must not get the warning written for an
 * address the caller FORGOT. `unaddressedPostNote`'s remedy is "re-post it with
 * to=<one member>", which is precisely the thing an `intent:"chat"` caller
 * decided against; rendering it here would talk every deliberate chat message
 * into becoming a request. The chat line says the same fact (nothing was put in
 * front of an agent) with the opposite advice.
 */
function addressingNoteLines(f) {
    if (f.intent === "chat") {
        return [
            `CHAT — you posted this as \`intent\`="chat", so it addresses nobody: the people in **${f.safeChannelName}** can read it, no agent was put in front of it, and in a DIRECT channel the automatic address to the other member was skipped too. That is the point of the field, so this is NOT a delivery failure to repair. If you meant to ask for work, post again WITHOUT \`intent\` (a request is the default) and name who it is for.`,
        ];
    }
    const note = (0, channel_addressing_1.unaddressedPostNote)({
        ref: f.channelId,
        isDirect: f.isDirect,
        // An agent address IS an address: the server stamps the addressed agent's
        // OWNER as `to_user_id`, which is the field the receiving listener triggers
        // on, so a `to_agent` post wakes a machine exactly as a `to` post does.
        addressed: !!f.toLabel || f.toAgents.length > 0,
        landedThread: f.landedThread,
    });
    return note ? [note] : [];
}
/**
 * The agent-identity clauses of the "Posted to ..." confirmation line.
 *
 * EVERY addressed agent is named, not just the head. A multi-address that
 * reported only the first would read exactly like a single address, which is the
 * silent-drop shape this whole result line exists to prevent. Both notes render
 * the handle WITH its id (`agentLabel`) — a handle alone is the owner's claim
 * about a name, and two rooms' agents may share one.
 */
function agentAttributionNotes(toAgents, asAgent) {
    const toAgentNote = toAgents.length > 0
        ? `, addressed to ${toAgents.length === 1 ? "agent" : `${toAgents.length} agents`} ${toAgents.map(channel_agent_refs_1.agentLabel).join(", ")}`
        : "";
    return {
        toAgentNote,
        asNote: asAgent ? `, as agent ${(0, channel_agent_refs_1.agentLabel)(asAgent)}` : "",
    };
}
