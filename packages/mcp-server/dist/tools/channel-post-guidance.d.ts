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
export declare function bodyCarriesATag(body: string): boolean;
/**
 * How many readers the SERVER resolved out of the body, read back off the
 * STORED message. ⚠ Tolerant in the same direction as `mentionedUserIdsOf`: a
 * missing key, or a value that is not an array of strings, counts as ZERO
 * rather than being trusted.
 */
export declare function resolvedMentionCount(message: ChannelMessage): number;
export type MentionKind = "agent" | "handle";
export type MentionToken = {
    token: string;
    kind: MentionKind;
};
/**
 * Every `@…` in the body, in order, de-duplicated, classified by SHAPE.
 * ⚠ De-duplicated because the report is about which ADDRESSES were written, not
 * how many times; a body naming one agent four times has one address in it.
 */
export declare function classifyMentions(body: string): MentionToken[];
/**
 * THE PER-MENTION REPORT — one line, or none when the body carried no `@…`.
 *
 * ⚠ EVERY CLAUSE IS SOMETHING THIS SERVER ACTUALLY KNOWS. The agent half is a
 * SHAPE judgement plus the LAW (which is this tool's own rule, not a guess about
 * another machine); the human half is the server's own stamped count. Nothing
 * here asserts that a particular token reached a particular reader.
 */
export declare function mentionBreakdownLine(mentions: MentionToken[], resolved: number): string | null;
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
 *      ⚠ **AND ITS SECOND SENTENCE WAS CORRECTED ON 2026-08-31.** It said
 *      `@<agentid>` "is a WAKE for that agent's machine" — true of a HUMAN
 *      writing it and false of the agent reading this line, which is the only
 *      audience it has. An agent-authored post wakes nobody, so the copy was
 *      telling every caller that the thing it had just done had worked. It now
 *      says who may spend the handle. ⚠ AND THIS BRANCH NO LONGER FIRES AT ALL
 *      for a body whose only tokens were agent handles — see
 *      {@link postGuidanceLines}: five causes about roster spelling, printed
 *      over a body that named no member, IS the mis-narration, not a fix for it.
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
export declare function tagOutcomeNote(channelId: string, count: number): string;
/**
 * The standing line under a post that landed in the MAIN ROOM. States the
 * capability FIRST — an agent just told "work traffic stays in its thread"
 * reads a bare warning here as "that post was a mistake" — then the sparseness
 * bar, in the one form it can apply to its own next turn.
 */
export declare function mainRoomPostNote(channelId: string): string;
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
export declare function threadTagNote(channelId: string): string;
/**
 * The whole contribution of this module to a successful `post` result: the
 * per-mention BREAKDOWN and the tag REPORT when the caller wrote an `@…`, plus
 * at most ONE standing line chosen by where the post landed (read back off the
 * stored message, never off what the caller asked for).
 *
 * ⚠ **THE REPORT IS NOW GATED ON THERE BEING A MEMBER HANDLE TO REPORT ON**
 * (2026-08-31). {@link tagOutcomeNote}'s zero branch is five paragraphs about
 * roster spelling; over a body whose every token was an AGENT handle it answers
 * a question the caller did not ask, in the voice of a defect, about the one
 * thing they did right. The BREAKDOWN covers that body instead, and says the
 * true thing about it. A body with BOTH kinds gets both lines, in that order:
 * what each token is, then what became of the member half.
 *
 * ⚠ The breakdown does NOT replace {@link tagOutcomeNote} where a member handle
 * failed. It says WHICH token could not be accounted for; that note says the
 * five reasons and the remedy, and neither is derivable from the other.
 */
export declare function postGuidanceLines({ channelId, landedThread, body, message, }: {
    channelId: string;
    /** `metadata.taskId` off the STORED message — absent means the main room. */
    landedThread: string | undefined;
    /** The body as posted; inspected for @-tokens, and only the TOKENS are ever
     *  rendered back (neutralized) — never the surrounding prose. */
    body: string;
    /** The STORED message, for the server's own mention resolution. */
    message: ChannelMessage;
}): string[];
