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
export declare const GROUP_CHANNEL_MIN_MEMBERS = 3;
/**
 * ⚠ `UUID_RE` AND `routesToASession()` USED TO LIVE HERE, and their removal
 * DELETED A DUPLICATE PREDICATE rather than a rule (T10, 2026-09-02). Fact 3
 * above is unchanged and is still the reason the distinction matters: only a
 * FIRST-CLASS (uuid) thread id reaches `feedLiveSession` /
 * `maybeSurfaceRequesterReply`, so a legacy `task-<channel>-<seq>` tag groups on
 * a card and wakes nobody, and the two cases may never be narrated with one
 * sentence.
 *
 * The last caller of this copy was the "NOT ADDRESSED, BUT THREADED" paragraph,
 * which T12 replaced with the post result's `landed=` field. That field is built
 * by `channel-post-linkage.ts` from **`channel-render-threads.ts ›
 * isFirstClassThreadId`** — the SAME predicate the read render decides
 * `· thread` vs `· ad-hoc` with. One definition is the point: two regexes for
 * "is this a real thread" is exactly how the write lane and the read lane learn
 * to disagree about the same id.
 */
/**
 * ⚠ `unaddressedPostNote()` USED TO LIVE HERE — the "NOT ADDRESSED" paragraph a
 * post result carried whenever the caller named nobody, and its threaded
 * variant. It went with T12 (2026-09-02): the rule it stated is true on every
 * call, so it is stated once in `channel-doctrine.ts`, and the post result
 * carries the FACT instead — `addressed=no`, plus `landed=thread` when a thread
 * tag routed it anyway.
 *
 * Two things it knew are worth not relearning, and both survive above and below.
 * **A THREAD TAG WAKES PEOPLE WITHOUT READING THE ADDRESSING AT ALL** (fact 3),
 * which is why the result reports `landed=` beside `addressed=` rather than
 * collapsing them into one verdict — "nobody was woken" is FALSE for a threaded
 * post, and the old remedy ("re-post with `to=`") manufactured a duplicate
 * request. And **only a FIRST-CLASS (uuid) tag reaches a session** — decided by
 * the ONE predicate, `channel-render-threads.ts › isFirstClassThreadId`.
 */
/**
 * The closing line of `op="rooms" action="members"` — how to address someone, and what an
 * unaddressed post does in a channel of THIS size.
 *
 * The roster is the one surface that knows the exact count, so the count can be
 * NAMED here. ⚠ The RULE no longer branches on it: an unaddressed, unthreaded
 * post reaches no one's agent at two members as at ten (see fact 1). What the
 * count still buys is copy that names the room it is talking about instead of
 * generalising, and the "add somebody first" case at a roster of one.
 */
export declare function rosterAddressingRule(ref: string, memberCount: number): string;
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
export declare const AWAIT_UNNAMED_NOTICE = "NONE of the messages above NAMES you as its addressee. That is not the same as \"none of this is yours\": a reply here is normally posted UNADDRESSED (a responding agent answers without a `to`), and a message THREADED into an exchange you are a party to is for you whatever its addressing says \u2014 read the \"\u00B7 thread <id>\" tags above. So: if you were waiting on someone and one of these came from them, that is your reply, and you should handle it. What you must NOT do is adopt an unaddressed message as a task you were assigned, or answer one aimed at another member. If you were not waiting on anyone, all of it is context \u2014 stop here.";
