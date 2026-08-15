/**
 * WHO AN UNADDRESSED MESSAGE ACTUALLY REACHES — ⚠ ONE statement of the rule,
 * read by every op that narrates it (`post`, `members`, the tool description).
 * Restating it per-site produced the same wrong answer three times.
 *
 * ⚠ THE RULE IS NOT KEYED ON `is_direct`. Three facts, each owned elsewhere:
 *
 *  1. THE IMPLICIT TRIGGER IS KEYED ON MEMBER COUNT. `classify`
 *     (dopl-desktop-app/main/targeting.js) fires on known-exact
 *     `memberCount === 2` plus explicit membership; `is_direct` appears NOWHERE
 *     in it. So an unaddressed message in a two-member CHANNEL is a request for
 *     the only other member. Web lane agrees via `GROUP_CHANNEL_MIN_MEMBERS`
 *     (src/features/channels/constants.ts).
 *
 *  2. AN UNADDRESSED POST FROM AN AGENT IS NEVER AN IMPLICIT REQUEST, AT ANY
 *     SIZE. The LOOP BRAKE above that trigger returns `fyi`/`ignore` for every
 *     unaddressed AGENT author, and every post through this tool is
 *     agent-authored (`author_kind` derives from the caller's token in
 *     service-shared.ts; an MCP call always carries one). ⚠ That licenses "YOUR
 *     post woke nobody", never "an unaddressed message wakes nobody".
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

/**
 * Channel size at or above which an unaddressed message can never be an
 * implicit request. ⚠ HAND-COPIED from
 * `src/features/channels/constants.ts › GROUP_CHANNEL_MIN_MEMBERS` (no shared
 * source tree) — keep both in sync; `channel-addressing.test.ts` pins them.
 */
export const GROUP_CHANNEL_MIN_MEMBERS = 3;

/** Mirrors the desktop's `firstClassTaskId` gate (targeting.js) exactly. */
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * TRUE for a thread id the receiving desktop will ROUTE on. Only a first-class
 * (uuid) id reaches `feedLiveSession` / `maybeSurfaceRequesterReply` — both call
 * `firstClassTaskId`, which returns '' for a legacy `task-<channel>-<seq>` id.
 * ⚠ A legacy tag groups on a thread card and wakes nobody; the two cases must
 * not be narrated with one sentence.
 */
export function routesToASession(threadId: string | undefined): boolean {
  return threadId !== undefined && UUID_RE.test(threadId);
}

/** Where the roster op sends a reader who needs a member to name. */
function membersCall(ref: string): string {
  return `dopl_channel(op="members", channel="${ref}")`;
}

/**
 * The line a `post` result carries when the caller named nobody. `null` when
 * there is nothing to warn about: an explicit `to`, or a DIRECT channel (where
 * `resolveDirectPeer` stamps the other member server-side).
 *
 * ⚠ Two shapes:
 *   - THREADED into a first-class thread — may already be in front of the other
 *     party's agent, so the remedy is WAIT, never re-post;
 *   - anything else — nothing reached an agent, so name a member and re-post.
 */
export function unaddressedPostNote({
  ref,
  isDirect,
  addressed,
  landedThread,
}: {
  ref: string;
  isDirect: boolean | undefined;
  addressed: boolean;
  landedThread: string | undefined;
}): string | null {
  if (addressed || isDirect) return null;
  if (routesToASession(landedThread)) {
    return `NOT ADDRESSED, BUT THREADED — you passed no \`to\`, so the ADDRESSING on this post woke nobody. The thread tag can: a message carrying a first-class thread id is handed straight to the session the other party already has open on that thread, with no addressing check at all, so this may be in front of their agent right now. Do NOT re-post it with \`to=\` to be sure — that lands as a second, UNTHREADED request and starts a second run against the same work. Wait for the answer with dopl_channel(op="await", channel="${ref}", since=<this seq>), or check the thread with op="get_thread".`;
  }
  return `NOT ADDRESSED — you passed no \`to\` and this is not a direct message, so nothing put this post in front of an agent: every member can read it, and it arrives as a notification rather than as a request. (An unaddressed post from an AGENT is never taken as an implicit request, whatever the channel's size — and posts you make are agent-authored.) If it is a request rather than a remark, re-post it with to="<one member>" — ${membersCall(ref)} lists who is here.`;
}

/**
 * The closing line of `op="members"` — how to address someone, and what an
 * unaddressed post does in a channel of THIS size.
 *
 * The roster is the one surface that knows the exact count, so the rule can be
 * stated concretely here. ⚠ It still cannot see `is_direct` (this op reads
 * members, not the channel row) — say what the direct case does without
 * claiming which case this channel is.
 */
export function rosterAddressingRule(ref: string, memberCount: number): string {
  // ⚠ Thread exception belongs in the PREAMBLE, not one count branch — it holds
  // at every size (`feedLiveSession` reads the tag, never the roster), and a
  // count-scoped "reaches no one's agent at all" is the over-claim this module
  // exists to stop.
  const how = `Address a request to ONE of them: dopl_channel(op="post", channel="${ref}", to="<their user id>", body=..., summary=...), or open a tracked exchange with op="create_thread". A channel reaches PEOPLE — there is no handle for an agent. Only a DIRECT (1:1) message channel addresses your post for you, and this op reads the roster, not the channel row, so it cannot tell you whether this is one. The other way to reach an agent is a THREAD tag: \`thread=<id>\` on an existing thread routes the post into the session already working it, addressed or not.`;
  if (memberCount < 2) {
    return `\n${how} There is nobody else on this roster to address yet — add a member with op="invite" first.`;
  }
  if (memberCount >= GROUP_CHANNEL_MIN_MEMBERS) {
    return `\n${how} With ${memberCount} members, an UNADDRESSED, UNTHREADED post reaches no one's agent: everyone can read it, and nobody's agent wakes for it. Naming one member is the only way to ask for work — to ask two people, post twice.`;
  }
  return `\n${how} Two members is the ONE size where an unaddressed message is an implicit request: the other side treats a message from a PERSON as meant for the only other member. A post from an AGENT never counts, so leaving \`to\` off still reaches no agent when the post is yours. Name them and the distinction stops mattering.`;
}

/**
 * The `await` wake notice — said when nothing that arrived NAMES the caller.
 *
 * ⚠ Must NOT tell the agent to ignore what it got: THE CANONICAL REPLY IN THIS
 * PRODUCT IS UNADDRESSED. `channel-post.js › postResult` posts a responder's
 * reply with `authorKind: 'agent'` and NO `toUserId`, and
 * `prompt-framing.js › deliveryCall` teaches every session agent that exact call
 * with no `to`. `resolveDirectPeer` stamps `to_user_id` only for DIRECT
 * channels — so in exactly the N>=3 case this notice exists for, the answer a
 * requester waits on names nobody.
 */
export const AWAIT_UNNAMED_NOTICE = `NONE of the messages above NAMES you as its addressee. That is not the same as "none of this is yours": a reply here is normally posted UNADDRESSED (a responding agent answers without a \`to\`), and a message THREADED into an exchange you are a party to is for you whatever its addressing says — read the "· thread <id>" tags above. So: if you were waiting on someone and one of these came from them, that is your reply, and you should handle it. What you must NOT do is adopt an unaddressed message as a task you were assigned, or answer one aimed at another member. If you were not waiting on anyone, all of it is context — stop here.`;
