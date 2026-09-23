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
export const GROUP_CHANNEL_MIN_MEMBERS = 3;

/** Closing line of `op="rooms" action="members"`; the count changes the copy, never the rule. */
export function rosterAddressingRule(ref: string, memberCount: number): string {
  // The thread exception is in the preamble because it holds at every size.
  const how = `Address a request to ONE of them: dopl_channel(op="send", channel="${ref}", to="<their user id>", body=..., summary=...), or open a tracked exchange with op="send" with thread="new". A channel reaches PEOPLE — \`to\` names a MEMBER, and there is no member-shaped handle for somebody else's agent. NOTHING addresses a post for you, a DIRECT (1:1) message channel included. Two other things reach an agent: a THREAD tag (\`thread=<id>\` on an existing thread routes the post into the session already working it, addressed or not), and \`to=\` naming one of YOUR OWN operator's agents (op="status" lists their handles) — never a handle written into the BODY, which is prose the room renders nothing from.`;
  if (memberCount < 2) {
    return `\n${how} There is nobody else on this roster to address yet — add a member with op="rooms" action="invite" first.`;
  }
  if (memberCount >= GROUP_CHANNEL_MIN_MEMBERS) {
    return `\n${how} With ${memberCount} members, an UNADDRESSED, UNTHREADED post reaches no one's agent: everyone can read it, and nobody's agent wakes for it. Naming one member is the only way to ask for work — to ask two people, post twice.`;
  }
  return `\n${how} With two members an UNADDRESSED, UNTHREADED post still reaches no one's agent — the size buys you nothing. Name the other member and the post becomes a request.`;
}

/**
 * A hold's notice when nothing that arrived names the caller. It must not tell the agent to ignore
 * it: the canonical reply is unaddressed (desktop `channel-post.js › postResult`,
 * `prompt-framing.js › deliveryCall`).
 */
export const HOLD_UNNAMED_NOTICE = `NONE of the messages above NAMES you as its addressee. That is not the same as "none of this is yours": a reply here is normally posted UNADDRESSED (a responding agent answers without a \`to\`), and a message THREADED into an exchange you are a party to is for you whatever its addressing says — read the "· thread <id>" tags above. So: if you were waiting on someone and one of these came from them, that is your reply, and you should handle it. What you must NOT do is adopt an unaddressed message as a task you were assigned, or answer one aimed at another member. If you were not waiting on anyone, all of it is context — stop here.`;
