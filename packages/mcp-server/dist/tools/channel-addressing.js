"use strict";
/**
 * WHO AN UNADDRESSED MESSAGE ACTUALLY REACHES — ⚠ ONE statement of the rule,
 * read by every op that narrates it (`post`, `members`, the tool description).
 * Restating it per-site produced the same wrong answer three times.
 *
 * ⚠ THE RULE IS NOT KEYED ON `is_direct`. Three facts, each owned elsewhere:
 *
 *  1. THERE IS NO IMPLICIT TRIGGER LEFT, AT ANY SIZE. ⚠ RETIRED 2026-08-18
 *     (wiring plan Phase 3), together with the server-side DM auto-address it
 *     was paired with. `classify` (dopl-desktop-app/main/targeting.js) used to
 *     fire on known-exact `memberCount === 2` plus explicit membership; it no
 *     longer reads the count at all, and `resolvePostMetadata`
 *     (src/features/channels/server/service-writes-metadata.ts) no longer stamps
 *     a DM peer into `to_user_id`. **An unaddressed post reaches nobody's agent
 *     in a two-member channel exactly as in a ten-member one, and a DIRECT
 *     channel is not an exception.** ⚠ SHIP ORDER (INVARIANTS §13): the web half
 *     deploys before a desktop build, so an OLD desktop in the field may still
 *     trigger on a 2-member channel — which is why this copy under-promises
 *     rather than over-promises, and never tells a caller an unaddressed post is
 *     enough.
 *
 *  2. AN UNADDRESSED POST FROM AN AGENT WAS NEVER AN IMPLICIT REQUEST, at any
 *     size, and that is the one claim here that has ALWAYS been safe to make.
 *     The LOOP BRAKE returns `fyi`/`ignore` for every unaddressed AGENT author,
 *     and every post through this tool is agent-authored (`author_kind` derives
 *     from the caller's token in service-shared.ts; an MCP call always carries
 *     one). ⚠ It survives fact 1's retirement UNCHANGED and it is what the copy
 *     leans on: "YOUR post woke nobody" is true against every desktop build in
 *     the field, old or new.
 *
 *  3. A THREAD TAG WAKES PEOPLE WITHOUT READING THE ADDRESSING AT ALL. Three
 *     routes run BEFORE `classify` (main/listener-messages.js) and none looks at
 *     `to_user_id`: `feedLiveSession` hands a FIRST-CLASS (uuid) thread id
 *     straight into the counterparty's running turn, and
 *     `maybeSurfaceRequesterReply` reopens the requester's settled session. ⚠ So
 *     "nobody was woken" is FALSE for a threaded post, and the remedy "re-post
 *     with `to=`" manufactures a duplicate request that re-triggers consent.
 *
 * ⚠ Nothing here may be conditional on a value this package cannot see. Where
 * the member count is unknown (`Channel.memberCount` is optional) the copy
 * states only what holds at every size.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.AWAIT_UNNAMED_NOTICE = exports.GROUP_CHANNEL_MIN_MEMBERS = void 0;
exports.routesToASession = routesToASession;
exports.unaddressedPostNote = unaddressedPostNote;
exports.rosterAddressingRule = rosterAddressingRule;
/**
 * Where a channel stops being a pair and becomes a room. ⚠ HAND-COPIED from
 * `src/features/channels/constants.ts › GROUP_CHANNEL_MIN_MEMBERS` (no shared
 * source tree) — keep both in sync; `channel-addressing-rule.test.ts` pins them.
 *
 * ⚠ IT NO LONGER MARKS A BEHAVIOUR BOUNDARY. It used to be the size at or above
 * which an unaddressed message could never be an implicit request; the implicit
 * request is retired at every size (see fact 1 above), so this is now a COPY
 * threshold only — it decides whether the roster line says "the other member" or
 * names a count. The constant is kept, and kept pinned, because both trees still
 * state the same rule and a silent drift between them is the failure it was
 * added for.
 */
exports.GROUP_CHANNEL_MIN_MEMBERS = 3;
/** Mirrors the desktop's `firstClassTaskId` gate (targeting.js) exactly. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/**
 * TRUE for a thread id the receiving desktop will ROUTE on. Only a first-class
 * (uuid) id reaches `feedLiveSession` / `maybeSurfaceRequesterReply` — both call
 * `firstClassTaskId`, which returns '' for a legacy `task-<channel>-<seq>` id.
 * ⚠ A legacy tag groups on a thread card and wakes nobody; the two cases must
 * not be narrated with one sentence.
 */
function routesToASession(threadId) {
    return threadId !== undefined && UUID_RE.test(threadId);
}
/** Where the roster op sends a reader who needs a member to name. */
function membersCall(ref) {
    return `dopl_channel(op="members", channel="${ref}")`;
}
/**
 * The line a `post` result carries when the caller named nobody. `null` ONLY
 * when the caller passed an explicit `to`.
 *
 * ⚠ A DIRECT CHANNEL NO LONGER SUPPRESSES THIS NOTE. It used to: the server
 * stamped the other member for you (`resolveDirectPeer`), so an unaddressed DM
 * post really was addressed. That fallback is retired (2026-08-18), and a DM
 * post with no `to` now reaches nobody's agent like any other — telling a caller
 * otherwise is the invisible-delivery failure this module exists to prevent.
 *
 * ⚠ Two shapes:
 *   - THREADED into a first-class thread — may already be in front of the other
 *     party's agent, so the remedy is WAIT, never re-post;
 *   - anything else — nothing reached an agent, so name a member and re-post.
 */
function unaddressedPostNote({ ref, addressed, landedThread, }) {
    if (addressed)
        return null;
    if (routesToASession(landedThread)) {
        return `NOT ADDRESSED, BUT THREADED — you passed no \`to\`, so the ADDRESSING on this post woke nobody. The thread tag can: a message carrying a first-class thread id is handed straight to the session the other party already has open on that thread, with no addressing check at all, so this may be in front of their agent right now. Do NOT re-post it with \`to=\` to be sure — that lands as a second, UNTHREADED request and starts a second run against the same work. Wait for the answer with dopl_channel(op="await", channel="${ref}", since=<this seq>), or check the thread with op="get_thread".`;
    }
    return `NOT ADDRESSED — you passed no \`to\`, so nothing put this post in front of an agent: every member can read it, and it arrives as a notification rather than as a request. That holds in a DIRECT (1:1) message too — nothing is addressed for you anywhere any more. (An unaddressed post from an AGENT is never taken as an implicit request, whatever the channel's size — and posts you make are agent-authored.) If it is a request rather than a remark, re-post it with to="<one member>" — ${membersCall(ref)} lists who is here.`;
}
/**
 * The closing line of `op="members"` — how to address someone, and what an
 * unaddressed post does in a channel of THIS size.
 *
 * The roster is the one surface that knows the exact count, so the count can be
 * NAMED here. ⚠ The RULE no longer branches on it: an unaddressed, unthreaded
 * post reaches no one's agent at two members as at ten (see fact 1). What the
 * count still buys is copy that names the room it is talking about instead of
 * generalising, and the "add somebody first" case at a roster of one.
 */
function rosterAddressingRule(ref, memberCount) {
    // ⚠ Thread exception belongs in the PREAMBLE, not one count branch — it holds
    // at every size (`feedLiveSession` reads the tag, never the roster), and a
    // count-scoped "reaches no one's agent at all" is the over-claim this module
    // exists to stop.
    const how = `Address a request to ONE of them: dopl_channel(op="post", channel="${ref}", to="<their user id>", body=..., summary=...), or open a tracked exchange with op="create_thread". A channel reaches PEOPLE — there is no handle for an agent. NOTHING addresses a post for you, a DIRECT (1:1) message channel included. The other way to reach an agent is a THREAD tag: \`thread=<id>\` on an existing thread routes the post into the session already working it, addressed or not.`;
    if (memberCount < 2) {
        return `\n${how} There is nobody else on this roster to address yet — add a member with op="invite" first.`;
    }
    if (memberCount >= exports.GROUP_CHANNEL_MIN_MEMBERS) {
        return `\n${how} With ${memberCount} members, an UNADDRESSED, UNTHREADED post reaches no one's agent: everyone can read it, and nobody's agent wakes for it. Naming one member is the only way to ask for work — to ask two people, post twice.`;
    }
    return `\n${how} With two members an UNADDRESSED, UNTHREADED post still reaches no one's agent — the size buys you nothing. Name the other member and the post becomes a request.`;
}
/**
 * The `await` wake notice — said when nothing that arrived NAMES the caller.
 *
 * ⚠ Must NOT tell the agent to ignore what it got: THE CANONICAL REPLY IN THIS
 * PRODUCT IS UNADDRESSED. `channel-post.js › postResult` posts a responder's
 * reply with `authorKind: 'agent'` and NO `toUserId`, and
 * `prompt-framing.js › deliveryCall` teaches every session agent that exact call
 * with no `to`. ⚠ THAT IS NOW TRUE IN EVERY CHANNEL SHAPE, not only at N>=3:
 * `resolveDirectPeer` used to stamp `to_user_id` on a DM reply, and no longer
 * does (2026-08-18), so the answer a requester waits on names nobody there
 * either — which makes this notice MORE load-bearing, not less.
 */
exports.AWAIT_UNNAMED_NOTICE = `NONE of the messages above NAMES you as its addressee. That is not the same as "none of this is yours": a reply here is normally posted UNADDRESSED (a responding agent answers without a \`to\`), and a message THREADED into an exchange you are a party to is for you whatever its addressing says — read the "· thread <id>" tags above. So: if you were waiting on someone and one of these came from them, that is your reply, and you should handle it. What you must NOT do is adopt an unaddressed message as a task you were assigned, or answer one aimed at another member. If you were not waiting on anyone, all of it is context — stop here.`;
