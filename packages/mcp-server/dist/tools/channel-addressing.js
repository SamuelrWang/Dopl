"use strict";
/**
 * WHO AN UNADDRESSED MESSAGE ACTUALLY REACHES — one statement of the rule, read
 * by every op that narrates it (`post`, `members`, and the tool description).
 *
 * It lives in its own module because the wave that added this copy stated the
 * rule THREE times in three files and got it wrong in all three, in the same
 * way: it keyed the trigger on `is_direct`. The rule is not keyed on
 * `is_direct`. Three facts, each verified in the code that owns it:
 *
 *  1. THE IMPLICIT TRIGGER IS KEYED ON MEMBER COUNT.
 *     `classify` (dopl-desktop-app/main/targeting.js:152) fires it on a
 *     known-exact `memberCount === 2` plus explicit membership; `is_direct`
 *     appears NOWHERE in that function. So a two-member channel opened as a
 *     CHANNEL (what `op="open"` with a name gives you) is not the silent hole
 *     the old copy described — an unaddressed message there is a request for
 *     the only other member. The web lane says the same thing, keyed on
 *     `GROUP_CHANNEL_MIN_MEMBERS` (src/features/channels/constants.ts), and so
 *     does docs/ENGINEERING.md §N-PARTY. This lane was the outlier.
 *
 *  2. AN UNADDRESSED POST FROM AN AGENT IS NEVER AN IMPLICIT REQUEST, AT ANY
 *     SIZE. The LOOP BRAKE one line above that trigger (targeting.js:146)
 *     returns `fyi`/`ignore` for every unaddressed AGENT author, and every post
 *     made through this tool is agent-authored: the write path derives
 *     `author_kind` from the caller's token (`source: auth.agentTokenId ?
 *     "agent" : "user"`, src/features/channels/server/service-shared.ts:57) and
 *     an MCP call always carries one. That is what makes "your post woke
 *     nobody" a safe thing to say. It is NOT a licence to say "an unaddressed
 *     message wakes nobody", which is the false generalization fact 1 kills.
 *
 *  3. A THREAD TAG WAKES PEOPLE WITHOUT READING THE ADDRESSING AT ALL.
 *     Three routes run BEFORE `classify` (dopl-desktop-app/main/
 *     listener-messages.js:36-38) and none of them looks at `to_user_id`:
 *     `feedLiveSession` hands a message carrying a FIRST-CLASS (uuid) thread id
 *     straight into the counterparty's running turn, and
 *     `maybeSurfaceRequesterReply` reopens the requester's settled session for
 *     it. So "nobody was woken" is false for exactly the post the write op used
 *     to render it above — `threadLinkageNote`'s "THREADED into X — the other
 *     side reads this as a continuation" — and the remedy it offered (re-post
 *     with `to=`) manufactures the duplicate request that re-triggers consent.
 *     That is the 1.7.14 incident shape, produced by the note meant to prevent
 *     silent drops.
 *
 *  4. ENGAGEMENT WAS A FOURTH WAY, and it is gone (channels rollback §1). A
 *     human who addressed an agent by handle stamped `channel_agents.engaged_at`
 *     and the desktop then treated that human's UNTAGGED messages as that
 *     agent's for ~an hour. Nothing stamps it now, nothing reads it, and there
 *     is no handle to address — so fact 1's "two members" is once again the
 *     ONLY size at which an untagged message from a person is an implicit
 *     request, with no hedge.
 *
 * Nothing here is conditional on a value this package cannot see. Where the
 * member count is unknown (`Channel.memberCount` is optional) the copy states
 * only what holds at every size.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.AWAIT_UNNAMED_NOTICE = exports.GROUP_CHANNEL_MIN_MEMBERS = void 0;
exports.routesToASession = routesToASession;
exports.unaddressedPostNote = unaddressedPostNote;
exports.rosterAddressingRule = rosterAddressingRule;
/**
 * The channel size at or above which an unaddressed message can never be an
 * implicit request. DUPLICATED, deliberately, from
 * `src/features/channels/constants.ts#GROUP_CHANNEL_MIN_MEMBERS` — the web app
 * and this package share no source tree, and a magic `3` in three strings is
 * how the lanes drifted in the first place. `channel-addressing.test.ts` pins
 * the two copies to the same number.
 */
exports.GROUP_CHANNEL_MIN_MEMBERS = 3;
/** Mirrors the desktop's `firstClassTaskId` gate (targeting.js) exactly. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/**
 * TRUE for a thread id the receiving desktop will ROUTE on. Only a first-class
 * (uuid) id reaches `feedLiveSession` / `maybeSurfaceRequesterReply`: both call
 * `firstClassTaskId`, which returns '' for a legacy `task-<channel>-<seq>` id.
 * So a legacy tag groups the message on a thread card and wakes nobody, and the
 * two cases must not be narrated with one sentence.
 */
function routesToASession(threadId) {
    return threadId !== undefined && UUID_RE.test(threadId);
}
/** Where the roster op sends a reader who needs a member to name. */
function membersCall(ref) {
    return `dopl_channel(op="members", channel="${ref}")`;
}
/**
 * The line a `post` result carries when the caller named nobody. `null` when
 * there is nothing to warn about: an explicit `to`, or a DIRECT channel (where
 * `resolveDirectPeer` stamps the other member server-side).
 *
 * Two shapes, because two different things happened:
 *   - THREADED into a first-class thread — the post may already be in front of
 *     the other party's agent, so the remedy is to WAIT, never to re-post;
 *   - anything else — nothing reached an agent, so name a member and re-post.
 */
function unaddressedPostNote({ ref, isDirect, addressed, landedThread, }) {
    if (addressed || isDirect)
        return null;
    if (routesToASession(landedThread)) {
        return `NOT ADDRESSED, BUT THREADED — you passed no \`to\`, so the ADDRESSING on this post woke nobody. The thread tag can: a message carrying a first-class thread id is handed straight to the session the other party already has open on that thread, with no addressing check at all, so this may be in front of their agent right now. Do NOT re-post it with \`to=\` to be sure — that lands as a second, UNTHREADED request and starts a second run against the same work. Wait for the answer with dopl_channel(op="await", channel="${ref}", since=<this seq>), or check the thread with op="get_thread".`;
    }
    return `NOT ADDRESSED — you passed no \`to\` and this is not a direct message, so nothing put this post in front of an agent: every member can read it, and it arrives as a notification rather than as a request. (An unaddressed post from an AGENT is never taken as an implicit request, whatever the channel's size — and posts you make are agent-authored.) If it is a request rather than a remark, re-post it with to="<one member>" — ${membersCall(ref)} lists who is here.`;
}
/**
 * The closing line of `op="members"` — how to address someone, and what an
 * unaddressed post does in a channel of THIS size.
 *
 * The roster is the one surface that knows the exact count, so it is the one
 * place the rule can be stated concretely rather than hedged. It still cannot
 * see `is_direct` (this op reads members, not the channel row), so it says what
 * the direct case does without claiming which case this channel is.
 */
function rosterAddressingRule(ref, memberCount) {
    // The thread exception belongs in the PREAMBLE, not in one count branch: it is
    // true at every size (`feedLiveSession` reads the tag, never the roster), and a
    // count-scoped absolute like "reaches no one's agent at all" is exactly the
    // over-claim this module exists to stop.
    const how = `Address a request to ONE of them: dopl_channel(op="post", channel="${ref}", to="<their user id>", body=..., summary=...), or open a tracked exchange with op="create_thread". A channel reaches PEOPLE — there is no handle for an agent. Only a DIRECT (1:1) message channel addresses your post for you, and this op reads the roster, not the channel row, so it cannot tell you whether this is one. The other way to reach an agent is a THREAD tag: \`thread=<id>\` on an existing thread routes the post into the session already working it, addressed or not.`;
    if (memberCount < 2) {
        return `\n${how} There is nobody else on this roster to address yet — add a member with op="invite" first.`;
    }
    if (memberCount >= exports.GROUP_CHANNEL_MIN_MEMBERS) {
        return `\n${how} With ${memberCount} members, an UNADDRESSED, UNTHREADED post reaches no one's agent: everyone can read it, and nobody's agent wakes for it. Naming one member is the only way to ask for work — to ask two people, post twice.`;
    }
    return `\n${how} Two members is the ONE size where an unaddressed message is an implicit request: the other side treats a message from a PERSON as meant for the only other member. A post from an AGENT never counts, so leaving \`to\` off still reaches no agent when the post is yours. Name them and the distinction stops mattering.`;
}
/**
 * The `await` wake notice — said when nothing that arrived NAMES the caller.
 *
 * It used to read "NONE of the messages above is addressed to you … Do not
 * answer them and do not treat them as a task: they are context", which told an
 * agent to ignore its own answer: the canonical reply in this product is
 * UNADDRESSED. Both halves of that are in the desktop:
 * `channel-post.js#postResult` posts the responder's reply with `authorKind:
 * 'agent'` and NO `toUserId`, and `prompt-framing.js#deliveryCall` teaches every
 * session agent the exact delivery call with no `to` in it. `resolveDirectPeer`
 * stamps `to_user_id` only for DIRECT channels — so in exactly the N>=3 case
 * this notice exists for, the answer a requester is waiting on names nobody.
 *
 * The condition is unchanged (it is the one thing this op can check without a
 * round-trip); what it SAYS is now true of a reply and of a thread the caller is
 * a party to, neither of which the addressing field can express.
 */
exports.AWAIT_UNNAMED_NOTICE = `NONE of the messages above NAMES you as its addressee. That is not the same as "none of this is yours": a reply here is normally posted UNADDRESSED (a responding agent answers without a \`to\`), and a message THREADED into an exchange you are a party to is for you whatever its addressing says — read the "· thread <id>" tags above. So: if you were waiting on someone and one of these came from them, that is your reply, and you should handle it. What you must NOT do is adopt an unaddressed message as a task you were assigned, or answer one aimed at another member. If you were not waiting on anyone, all of it is context — stop here.`;
