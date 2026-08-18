/**
 * THE TWO CAPABILITIES AN AGENT HAS TO BE TOLD IT HAS — posting to the MAIN
 * ROOM sparsely, and @-tagging a person — said in the RESULT of a post and not
 * only in the tool description (wiring plan Phase 11).
 *
 * ⚠ WHY IT LIVES HERE AT ALL. A tool RESULT is read by the same model at the
 * moment it decides what to do next, so it teaches HARDER than a description
 * read once at connection time (INVARIANTS §10). Guidance that lives only in
 * `channel-description.ts` is outvoted by whatever the result says, and the
 * decision these lines are for — "do I post again, and does a human need to see
 * this" — is made immediately after a post lands.
 *
 * ⚠ TWO KINDS OF LINE, and the distinction is what keeps the result readable:
 *   1. A REPORT of what this call did — {@link tagOutcomeNote}, rendered only
 *      when the body actually carried an `@…`. It is the same lane as the
 *      addressing and thread-linkage lines above it: a fact about THIS write.
 *   2. STANDING GUIDANCE — at most ONE, chosen by where the post LANDED
 *      ({@link postGuidanceLines}): the main room gets sparseness, a thread
 *      with no tag gets when-to-tag. Rendering both puts a paragraph of advice
 *      under every single write, which is how an agent learns to skip the lines
 *      that are specific to this one.
 *
 * ⚠ `channel-` filename prefix required by the parity split-scan
 * (parity.test.ts) and by the removed-vocabulary source scan
 * (channel-law.test.ts), which reads every non-test `channel-*.ts` here.
 *
 * ⚠ Every string below is server NARRATION. Nothing peer-authored splices in —
 * the only interpolation is the caller's own channel id and a COUNT. Resolved
 * mention ids are deliberately not rendered: naming them would need a roster
 * read this op does not make, and a bare uuid teaches an agent nothing.
 */

import type { ChannelMessage } from "@dopl/client";

/**
 * ⚠ HAND-COPIED from `src/features/channels/lib/mentions.ts ›
 * MENTIONS_METADATA_KEY` (no shared source tree between the app and this
 * package — the same arrangement `channel-addressing.ts ›
 * GROUP_CHANNEL_MIN_MEMBERS` lives under). It is the reserved key the server
 * stamps its OWN resolution into; a caller cannot set it (INVARIANTS §5), which
 * is exactly why reading it back is worth anything.
 */
const MENTIONS_METADATA_KEY = "mentionedUserIds";

/**
 * Did the AUTHOR try to tag anybody? ⚠ DELIBERATELY NOT THE RESOLVER — this
 * package cannot see the roster, so "did the tag LAND" is the server's answer
 * ({@link resolvedMentionCount}), never this function's.
 *
 * ⚠ Mirrors `lib/mentions.ts › MENTION_TOKEN_RE` exactly: a token is `@`
 * followed by one or more non-whitespace, non-`@` characters, at ANY position,
 * mid-word included. A stricter rule here would say "you tagged nobody" about a
 * body the server's parser reads as a tag, which is the two-parsers-disagreeing
 * bug that module exists to prevent.
 */
export function bodyCarriesATag(body: string): boolean {
  return /@[^\s@]/.test(body);
}

/**
 * How many readers the SERVER resolved out of the body, read back off the
 * STORED message. ⚠ Tolerant in the same direction as `mentionedUserIdsOf`: a
 * missing key, or a value that is not an array of strings, counts as ZERO
 * rather than being trusted.
 */
export function resolvedMentionCount(message: ChannelMessage): number {
  const value = (message.metadata as Record<string, unknown> | undefined)?.[
    MENTIONS_METADATA_KEY
  ];
  if (!Array.isArray(value)) return 0;
  return value.filter((id) => typeof id === "string").length;
}

/**
 * THE REPORT: the caller wrote an `@…`, so say what became of it. This is the
 * one line in the phase that catches a SILENT failure — a misspelled handle
 * resolves to nobody, and without this the agent believes it escalated.
 *
 * ⚠ THE ZERO BRANCH UNDER-PROMISES ON PURPOSE. An absent stamp has two causes
 * and this package can distinguish neither: the handle really names nobody, or
 * the server it is talking to does not resolve mentions yet (INVARIANTS §13 —
 * the web half deploys on its own schedule, and an old server answers a new
 * client). It leads with the likely cause and the actionable remedy, then says
 * the other case out loud rather than asserting a delivery failure it cannot
 * prove. The author's OWN id is dropped by the server resolver too, so a
 * self-tag lands on this branch legitimately.
 */
export function tagOutcomeNote(channelId: string, count: number): string {
  if (count > 0) {
    return `TAGGED ${count} ${count === 1 ? "person" : "people"} — the server resolved that many readers out of your body and stamped them on the message, so it is in their Tags inbox, which is where an operator looks instead of reading every message.`;
  }
  return `YOUR \`@\` TAG RESOLVED TO NOBODY — the message was posted, but no reader was stamped on it, so no one's Tags inbox has it. Almost always that is the SPELLING: a handle is the person's display name or the local part of their email, lowercased, either whole with the spaces squeezed out or just its first word, and the match is EXACT, so \`@dia\` for Diana names nobody and a handle two members both answer to resolves to nobody rather than being guessed. Check it against dopl_channel(op="members", channel="${channelId}") and re-post with the handle spelled as it is listed there. (A server that does not resolve tags at all looks identical from here, so if the spelling matches the roster, this is not yours to fix.)`;
}

/**
 * The standing line under a post that landed in the MAIN ROOM. States the
 * capability FIRST — an agent just told "work traffic stays in its thread"
 * reads a bare warning here as "that post was a mistake" — then the sparseness
 * bar, in the one form it can apply to its own next turn.
 */
export function mainRoomPostNote(channelId: string): string {
  return `POSTED TO THE ROOM ITSELF, not into a thread — that is ALLOWED, and it is a capability rather than a habit. The main room is for what the PEOPLE in it need: a milestone that changes what somebody else is doing, an answer to something asked in the room. Keep it sparse, and the bar is concrete — YOU HAVE NOW POSTED TO THIS CHANNEL IN THIS RUN, so the next one needs a reason a human would name out loud. Progress on work that has a thread belongs in that thread (\`thread=<id>\`), or in dopl_channel(op="milestone", channel="${channelId}", thread="<id>", body="<one line>").`;
}

/**
 * The standing line under a THREADED post that tagged nobody. ⚠ Opens by saying
 * the common case is CORRECT: this fires on the majority of posts (a thread
 * really is mostly two agents working), and a line that read as a defect every
 * time would train the agent to tag everything, which costs a human exactly as
 * much as tagging nothing.
 *
 * ⚠ Says what a tag DOES (the Tags inbox) and never promises a notification.
 * The mention gating is the desktop's (wiring plan Phase 7) and ships in a
 * separate build, so this states the product's direction and no delivery
 * guarantee this package can see.
 */
export function threadTagNote(channelId: string): string {
  return `NOBODY IS TAGGED IN THIS POST — usually right, because a thread is mostly your agent and theirs working, but it also means no HUMAN has been pointed at it. When you need a person — a decision only they can make, a summary worth their minutes, or "I am blocked" — put \`@<their handle>\` in the body. The server resolves the tag out of the body (there is no argument for it) and lands the message in that person's Tags inbox, which is what an operator watches instead of reading every message; the direction of the product is that agent traffic reaches a human that way. A tag is not an address: it starts no agent, and \`to\` is still the only thing that asks for a machine. Handles match EXACTLY, so check the spelling with dopl_channel(op="members", channel="${channelId}") — and read this line on your next post, because it says when a tag resolved to nobody.`;
}

/**
 * The whole contribution of this module to a successful `post` result: the tag
 * REPORT when the caller wrote one, plus at most ONE standing line chosen by
 * where the post landed (read back off the stored message, never off what the
 * caller asked for).
 */
export function postGuidanceLines({
  channelId,
  landedThread,
  body,
  message,
}: {
  channelId: string;
  /** `metadata.taskId` off the STORED message — absent means the main room. */
  landedThread: string | undefined;
  /** The body as posted; only ever inspected for an @-token, never rendered. */
  body: string;
  /** The STORED message, for the server's own mention resolution. */
  message: ChannelMessage;
}): string[] {
  const tagged = bodyCarriesATag(body);
  const lines = tagged
    ? [tagOutcomeNote(channelId, resolvedMentionCount(message))]
    : [];
  if (!landedThread) lines.push(mainRoomPostNote(channelId));
  else if (!tagged) lines.push(threadTagNote(channelId));
  return lines;
}
