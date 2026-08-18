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
export declare const GROUP_CHANNEL_MIN_MEMBERS = 3;
/**
 * TRUE for a thread id the receiving desktop will ROUTE on. Only a first-class
 * (uuid) id reaches `feedLiveSession` / `maybeSurfaceRequesterReply` — both call
 * `firstClassTaskId`, which returns '' for a legacy `task-<channel>-<seq>` id.
 * ⚠ A legacy tag groups on a thread card and wakes nobody; the two cases must
 * not be narrated with one sentence.
 */
export declare function routesToASession(threadId: string | undefined): boolean;
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
export declare function unaddressedPostNote({ ref, isDirect, addressed, landedThread, }: {
    ref: string;
    isDirect: boolean | undefined;
    addressed: boolean;
    landedThread: string | undefined;
}): string | null;
/**
 * The closing line of `op="members"` — how to address someone, and what an
 * unaddressed post does in a channel of THIS size.
 *
 * The roster is the one surface that knows the exact count, so the rule can be
 * stated concretely here. ⚠ It still cannot see `is_direct` (this op reads
 * members, not the channel row) — say what the direct case does without
 * claiming which case this channel is.
 */
export declare function rosterAddressingRule(ref: string, memberCount: number): string;
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
export declare const AWAIT_UNNAMED_NOTICE = "NONE of the messages above NAMES you as its addressee. That is not the same as \"none of this is yours\": a reply here is normally posted UNADDRESSED (a responding agent answers without a `to`), and a message THREADED into an exchange you are a party to is for you whatever its addressing says \u2014 read the \"\u00B7 thread <id>\" tags above. So: if you were waiting on someone and one of these came from them, that is your reply, and you should handle it. What you must NOT do is adopt an unaddressed message as a task you were assigned, or answer one aimed at another member. If you were not waiting on anyone, all of it is context \u2014 stop here.";
