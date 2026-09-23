/**
 * One statement of who an unaddressed message reaches, read by every op that narrates it:
 * - there is no implicit trigger at any size, a direct (1:1) channel included;
 * - an unaddressed agent post is never a request (the loop brake; every MCP post is agent-authored);
 * - a first-class (uuid) thread tag wakes regardless of addressing (desktop `feedLiveSession`;
 *   `channel-render-threads.ts › isFirstClassThreadId`).
 * Old desktops may still trigger on 2-member channels (INVARIANTS §13), so copy under-promises and
 * states only what holds at every size.
 */
/**
 * Hand-copied from `src/features/channels/constants.ts › GROUP_CHANNEL_MIN_MEMBERS` (pinned by
 * `channel-addressing-rule.test.ts`); a copy threshold only, not a behaviour boundary.
 */
export declare const GROUP_CHANNEL_MIN_MEMBERS = 3;
/** Closing line of `op="rooms" action="members"`; the count changes the copy, never the rule. */
export declare function rosterAddressingRule(ref: string, memberCount: number): string;
/**
 * A hold's notice when nothing that arrived names the caller. It must not tell the agent to ignore
 * it: the canonical reply is unaddressed (desktop `channel-post.js › postResult`,
 * `prompt-framing.js › deliveryCall`).
 */
export declare const HOLD_UNNAMED_NOTICE = "NONE of the messages above NAMES you as its addressee. That is not the same as \"none of this is yours\": a reply here is normally posted UNADDRESSED (a responding agent answers without a `to`), and a message THREADED into an exchange you are a party to is for you whatever its addressing says \u2014 read the \"\u00B7 thread <id>\" tags above. So: if you were waiting on someone and one of these came from them, that is your reply, and you should handle it. What you must NOT do is adopt an unaddressed message as a task you were assigned, or answer one aimed at another member. If you were not waiting on anyone, all of it is context \u2014 stop here.";
