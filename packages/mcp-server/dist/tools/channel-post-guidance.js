"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.bodyCarriesATag = bodyCarriesATag;
exports.resolvedMentionCount = resolvedMentionCount;
exports.tagOutcomeNote = tagOutcomeNote;
exports.mainRoomPostNote = mainRoomPostNote;
exports.threadTagNote = threadTagNote;
exports.postGuidanceLines = postGuidanceLines;
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
 *
 * ⚠ IT DOES NOT MIRROR THE CODE RULE, DELIBERATELY (2026-08-22). The server
 * skips a handle inside a code span or a fenced block; this predicate does not,
 * so a body whose ONLY handle is backticked still counts as "the author tried to
 * tag somebody" and still earns {@link tagOutcomeNote}'s zero branch — which is
 * the one line that explains WHY it tagged nobody. Teaching the exception here
 * would swallow the report and leave the agent believing the tag was never
 * written. This asks "did the AUTHOR try"; only the server answers "did it land".
 */
function bodyCarriesATag(body) {
    return /@[^\s@]/.test(body);
}
/**
 * How many readers the SERVER resolved out of the body, read back off the
 * STORED message. ⚠ Tolerant in the same direction as `mentionedUserIdsOf`: a
 * missing key, or a value that is not an array of strings, counts as ZERO
 * rather than being trusted.
 */
function resolvedMentionCount(message) {
    const value = message.metadata?.[MENTIONS_METADATA_KEY];
    if (!Array.isArray(value))
        return 0;
    return value.filter((id) => typeof id === "string").length;
}
/**
 * THE REPORT: the caller wrote an `@…`, so say what became of it. This is the
 * one line in the phase that catches a SILENT failure — a misspelled handle
 * resolves to nobody, and without this the agent believes it escalated.
 *
 * ⚠ THE ZERO BRANCH NAMES THE CAUSES IT ACTUALLY HAS, and it under-promises at
 * the end. Five things make the server resolve an `@…` to nobody, and this
 * package can distinguish none of them — it cannot see the roster and cannot see
 * the body's markdown structure the way the write path does:
 *   1. THE HANDLE IS IN CODE. A backticked or fenced `@handle` is quoted text
 *      and tags nobody (2026-08-22 — `lib/mentions.ts`, THE CODE RULE). ⚠ Listed
 *      FIRST because it is the cause an agent hits without noticing: writing
 *      ABOUT tagging, in a body that formats handles as code, is exactly what
 *      produced the incident that bought the rule.
 *   2. SPELLING. Exact equality against a roster-derived handle, never a prefix.
 *   3. NOT IN THIS CHANNEL. Resolution is scoped to the channel roster, so a
 *      workspace member who is not in the room resolves to nobody.
 *   4. AMBIGUITY FAILS CLOSED. A handle two members both answer to resolves to
 *      neither rather than being guessed.
 *   5. THE HANDLE WAS AN AGENT ID (2026-08-24). Mentions resolve against the
 *      channel's HUMAN roster (`lib/mentions.ts` over `listChannelMembers`), so
 *      an agent id matches nothing and never can. ⚠ IT IS ADDED BECAUSE BOTH
 *      SIDES OF A LIVE TWO-AGENT TEST HIT IT INDEPENDENTLY, and the copy above
 *      sent them to `op="members"` to check a spelling that was never going to
 *      be on that list. `@<agentid>` in a body is the WAKE the `launch_agent`
 *      bullet teaches — a real, working, DIFFERENT mechanism — so this cause is
 *      the one where the agent did the right thing and read the wrong report.
 *      ⚠ It carries NO roster remedy on purpose: the remedy sentence names
 *      (2), (3) and (4), and pointing this one at the member list is exactly
 *      the wrong turn that made it worth naming.
 *
 * ⚠ SELF-TAGGING IS NO LONGER A CAUSE, and the removal is the point. The server
 * used to drop the AUTHOR unconditionally, so an agent tagging its own operator
 * — the one escalation it has — landed here and read as a spelling mistake.
 * Since 2026-08-22 (`server/service-writes-metadata-mentions.ts`) an AGENT's tag
 * at its own account is KEPT, so a self-tag now reports as a real tag. Do not
 * re-add "you may have tagged yourself" to this copy: it would tell an agent to
 * stop doing the thing that works.
 *
 * ⚠ THE CLOSING CAVEAT STAYS. An old server that does not resolve mentions at
 * all is indistinguishable from here (INVARIANTS §13 — the web half deploys on
 * its own schedule), so the line ends by saying so rather than asserting a
 * delivery failure it cannot prove.
 */
function tagOutcomeNote(channelId, count) {
    if (count > 0) {
        return `TAGGED ${count} ${count === 1 ? "person" : "people"} — the server resolved that many readers out of your body and stamped them on the message, so it is in their Tags inbox, which is where an operator looks instead of reading every message.`;
    }
    return `YOUR \`@\` TAG RESOLVED TO NOBODY — the message was posted, but no reader was stamped on it, so no one's Tags inbox has it. FIVE THINGS DO THIS. (1) THE HANDLE WAS IN CODE: a handle inside backticks or a fenced block is quoted text and tags nobody — if you were writing ABOUT tagging, that is what happened, and it is working as intended. Write the handle as plain prose when you mean it as a tag. (2) SPELLING: a handle is the person's display name or the local part of their email, lowercased, either whole with the spaces squeezed out or just its first word, and the match is EXACT, so \`@dia\` for Diana names nobody. (3) THEY ARE NOT IN THIS CHANNEL: tags resolve against this channel's roster only, so a workspace member who is not a member here cannot be tagged into it. (4) TWO MEMBERS ANSWER TO IT: a contested handle resolves to neither rather than being guessed — use the longer form (their full name with the spaces squeezed out). (5) YOU TAGGED AN AGENT ID: tags resolve against the human roster only — an agent id can never be tagged. Writing \`@<agentid>\` in a body is a WAKE for that agent's machine, not a tag, and it starts no inbox entry. For (2), (3) and (4), check dopl_channel(op="members", channel="${channelId}") and re-post with the handle spelled as it is listed there; if they are not on that list, they cannot be reached from this channel at all. (A server that does not resolve tags at all looks identical from here, so if the handle is plain prose and matches the roster, this is not yours to fix.)`;
}
/**
 * The standing line under a post that landed in the MAIN ROOM. States the
 * capability FIRST — an agent just told "work traffic stays in its thread"
 * reads a bare warning here as "that post was a mistake" — then the sparseness
 * bar, in the one form it can apply to its own next turn.
 */
function mainRoomPostNote(channelId) {
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
function threadTagNote(channelId) {
    return `NOBODY IS TAGGED IN THIS POST — usually right, because a thread is mostly your agent and theirs working, but it also means no HUMAN has been pointed at it. When you need a person — a decision only they can make, a summary worth their minutes, or "I am blocked" — put \`@<their handle>\` in the body. The server resolves the tag out of the body (there is no argument for it) and lands the message in that person's Tags inbox, which is what an operator watches instead of reading every message; the direction of the product is that agent traffic reaches a human that way. A tag is not an address: it starts no agent, and \`to\` is still the only thing that asks for a machine. Handles match EXACTLY, so check the spelling with dopl_channel(op="members", channel="${channelId}") — and read this line on your next post, because it says when a tag resolved to nobody.`;
}
/**
 * The whole contribution of this module to a successful `post` result: the tag
 * REPORT when the caller wrote one, plus at most ONE standing line chosen by
 * where the post landed (read back off the stored message, never off what the
 * caller asked for).
 */
function postGuidanceLines({ channelId, landedThread, body, message, }) {
    const tagged = bodyCarriesATag(body);
    const lines = tagged
        ? [tagOutcomeNote(channelId, resolvedMentionCount(message))]
        : [];
    if (!landedThread)
        lines.push(mainRoomPostNote(channelId));
    else if (!tagged)
        lines.push(threadTagNote(channelId));
    return lines;
}
