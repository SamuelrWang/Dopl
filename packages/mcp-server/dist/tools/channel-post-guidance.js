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
exports.classifyMentions = classifyMentions;
exports.mentionBreakdownLine = mentionBreakdownLine;
exports.tagOutcomeNote = tagOutcomeNote;
exports.mainRoomPostNote = mainRoomPostNote;
exports.threadTagNote = threadTagNote;
exports.postGuidanceLines = postGuidanceLines;
const channel_shared_1 = require("./channel-shared");
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
// ── PER-MENTION RESOLUTION (2026-08-31) ────────────────────────────────────
//
// ⚠ WHY A BREAKDOWN AND NOT JUST THE COUNT. {@link tagOutcomeNote} answers "how
// many landed" and then spends a paragraph on five things that might have gone
// wrong. That is the right answer when every token is the same KIND. It is the
// wrong answer for a body carrying two kinds of token at once — which is the
// ordinary shape of an orchestration post ("@samuel please look, @agent-x2sz1ztt
// carry on") — because the count is over HUMAN handles only and reads as a
// verdict on the whole body. A live orchestrator read a zero count that way and
// concluded its agent handle was misspelled (ENGINEERING, 2026-08-31).
//
// ⚠ WHAT THIS PACKAGE CAN AND CANNOT DECIDE, STATED SO THE COPY CANNOT DRIFT
// PAST IT:
//   • THE GRAMMAR IS PUBLIC, so the ID FORM is decidable HERE, exactly.
//     `@agent-<id>` / `@<id>` over `main/agent-id.js`'s charset is an AGENT
//     handle by SHAPE, whatever it does or does not reach.
//   • WHETHER AN AGENT HANDLE REACHES ANYTHING IS NOT DECIDABLE HERE OR ON THE
//     SERVER AT ALL — the resolver is the operator's desktop, over ids minted on
//     that machine (INVARIANTS §11's name door). So the report says what the
//     token IS and what the LAW does with it, never that it arrived.
//   • WHICH HUMAN HANDLE RESOLVED IS NOT DECIDABLE HERE EITHER: the server
//     stamps USER IDS, not the tokens they came from, and this package cannot
//     see the roster. So human tokens are reported as a SET against the server's
//     COUNT, and where the two disagree the copy says it cannot tell which.
//
// ⚠ IT DOES NOT MIRROR THE CODE RULE, for the reason {@link bodyCarriesATag}
// gives: a backticked handle is still a token the AUTHOR wrote, and swallowing
// it here would leave the one line that explains why it reached nobody unwritten.
/**
 * ⚠ HAND-COPIED from `src/features/channels/lib/mentions.ts › MENTION_TOKEN_RE`
 * — `@` plus one or more non-whitespace, non-`@` characters, at any position,
 * mid-word included. Same copy {@link bodyCarriesATag} tests with, widened to a
 * capture so the tokens themselves can be reported.
 */
const MENTION_TOKEN_RE = /@([^\s@]+)/g;
/**
 * ⚠ HAND-COPIED from `dopl-desktop-app/main/session-dispatch.js ›
 * mentionedAgentIds` — the ID DOOR, both forms, the `agent-` prefix optional
 * exactly as it is there. The lookbehind is NOT reproduced: that regex scans
 * free prose and needs it so the bare alternative cannot also match inside
 * `@agent-<id>`; this one is anchored against ONE already-extracted token, where
 * the two forms cannot overlap.
 */
const AGENT_HANDLE_RE = /^(?:agent-)?[a-z][a-z0-9]{7}$/;
/** ⚠ TRAILING PUNCTUATION IS STRIPPED, LEADING IS NOT — `mentions.ts ›
 *  mentionHandleOf`'s rule, restated so `@agent-x2sz1ztt.` at the end of a
 *  sentence classifies as the handle it plainly is. */
function stripTrailing(token) {
    return token.replace(/[^\p{L}\p{N}_-]+$/u, "");
}
/**
 * Every `@…` in the body, in order, de-duplicated, classified by SHAPE.
 * ⚠ De-duplicated because the report is about which ADDRESSES were written, not
 * how many times; a body naming one agent four times has one address in it.
 */
function classifyMentions(body) {
    const out = [];
    const seen = new Set();
    for (const m of String(body ?? "").matchAll(MENTION_TOKEN_RE)) {
        const token = stripTrailing(m[1] ?? "");
        if (!token || seen.has(token))
            continue;
        seen.add(token);
        out.push({
            token,
            kind: AGENT_HANDLE_RE.test(token) ? "agent" : "handle",
        });
    }
    return out;
}
/**
 * THE PER-MENTION REPORT — one line, or none when the body carried no `@…`.
 *
 * ⚠ EVERY CLAUSE IS SOMETHING THIS SERVER ACTUALLY KNOWS. The agent half is a
 * SHAPE judgement plus the LAW (which is this tool's own rule, not a guess about
 * another machine); the human half is the server's own stamped count. Nothing
 * here asserts that a particular token reached a particular reader.
 */
function mentionBreakdownLine(mentions, resolved) {
    if (mentions.length === 0)
        return null;
    const agents = mentions.filter((m) => m.kind === "agent");
    const handles = mentions.filter((m) => m.kind === "handle");
    // ⚠ THE `@` GOES **INSIDE** `inlineOr`, NOT AROUND ITS RESULT. `narration.ts ›
    // neutralizeInline` returns the value ALREADY WRAPPED in a code span, so
    // wrapping it again produces `` `@`token`` `` — a broken span, in a line whose
    // whole job is to show the caller the exact token it wrote back to it.
    const show = (list) => list.map((m) => (0, channel_shared_1.inlineOr)(`@${m.token}`, "`(unreadable)`")).join(", ");
    const parts = [`WHAT EACH \`@\` IN YOUR BODY IS:`];
    if (agents.length > 0) {
        parts.push(`${show(agents)} — AGENT HANDLE${agents.length === 1 ? "" : "S"} by shape, so ${agents.length === 1 ? "it is" : "they are"} a WAKE and not a tag: an agent id is not a channel member, stamps nobody, and can never land in a Tags inbox. It reaches YOUR OWN operator's agent of that id (you post under their account, which is what licenses it) and never another member's. ⚠ THIS SERVER CANNOT CONFIRM IT LANDED — the token is resolved on your operator's machine, over ids no server holds, so treat the post as a REQUEST and watch for that agent's own posts rather than assuming it woke.`);
    }
    if (handles.length > 0) {
        const label = `${show(handles)} — MEMBER HANDLE${handles.length === 1 ? "" : "S"} by shape, resolved by the server against THIS channel's human roster.`;
        if (resolved === 0) {
            parts.push(`${label} NONE of them resolved: no reader was stamped on this message, so nobody's Tags inbox has it.`);
        }
        else if (resolved >= handles.length) {
            parts.push(`${label} The server stamped ${resolved} reader${resolved === 1 ? "" : "s"}, so ${handles.length === 1 ? "it landed" : "they landed"}.`);
        }
        else {
            // ⚠ THE HONEST MIDDLE. The stamp is a set of USER IDS; the tokens are
            // strings. There is no join between them here, and inventing one (by
            // position, by count) would name the wrong token as the failure.
            parts.push(`${label} The server stamped only ${resolved} of ${handles.length} — at least one reached nobody, and WHICH ONE is not knowable from here (the stamp is a set of reader ids, not the tokens they came from).`);
        }
    }
    return parts.join(" ");
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
function tagOutcomeNote(channelId, count) {
    if (count > 0) {
        return `TAGGED ${count} ${count === 1 ? "person" : "people"} — the server resolved that many readers out of your body and stamped them on the message, so it is in their Tags inbox, which is where an operator looks instead of reading every message.`;
    }
    return `YOUR \`@\` TAG RESOLVED TO NOBODY — the message was posted, but no reader was stamped on it, so no one's Tags inbox has it. FIVE THINGS DO THIS. (1) THE HANDLE WAS IN CODE: a handle inside backticks or a fenced block is quoted text and tags nobody — if you were writing ABOUT tagging, that is what happened, and it is working as intended. Write the handle as plain prose when you mean it as a tag. (2) SPELLING: a handle is the person's display name or the local part of their email, lowercased, either whole with the spaces squeezed out or just its first word, and the match is EXACT, so \`@dia\` for Diana names nobody. (3) THEY ARE NOT IN THIS CHANNEL: tags resolve against this channel's roster only, so a workspace member who is not a member here cannot be tagged into it. (4) TWO MEMBERS ANSWER TO IT: a contested handle resolves to neither rather than being guessed — use the longer form (their full name with the spaces squeezed out). (5) YOU TAGGED AN AGENT ID: tags resolve against the human roster only — an agent id can never be tagged and starts no inbox entry. That is not a failure: \`@agent-<id>\` is a WAKE for that agent, on your operator's machine, and it is working as intended. For (2), (3) and (4), check dopl_channel(op="members", channel="${channelId}") and re-post with the handle spelled as it is listed there; if they are not on that list, they cannot be reached from this channel at all. (A server that does not resolve tags at all looks identical from here, so if the handle is plain prose and matches the roster, this is not yours to fix.)`;
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
function postGuidanceLines({ channelId, landedThread, body, message, }) {
    const tagged = bodyCarriesATag(body);
    const mentions = classifyMentions(body);
    const resolved = resolvedMentionCount(message);
    const lines = [];
    const breakdown = mentionBreakdownLine(mentions, resolved);
    if (breakdown)
        lines.push(breakdown);
    // ⚠ `bodyCarriesATag` still gates, and it is the WIDER of the two predicates:
    // it fires on any `@x`, including a token `classifyMentions` reports as a
    // member handle and one it reports as an agent one. The second conjunct is
    // what stops the roster paragraph printing over an agent-only body.
    if (tagged && mentions.some((m) => m.kind === "handle")) {
        lines.push(tagOutcomeNote(channelId, resolved));
    }
    if (!landedThread)
        lines.push(mainRoomPostNote(channelId));
    else if (!tagged)
        lines.push(threadTagNote(channelId));
    return lines;
}
