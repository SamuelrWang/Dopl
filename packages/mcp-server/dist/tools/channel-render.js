"use strict";
/**
 * `dopl_channel` RENDERERS — every string read ops splice into a model-read
 * result. ⚠ `channel-` filename prefix required by parity split-scan
 * (parity.test.ts).
 *
 * SECURITY RULE. Result has two zones: message BODIES (disclaimed by untrusted
 * headers below) and EVERYTHING ELSE — headings, bullet heads, author labels,
 * legend — read as SERVER NARRATION. Every peer-authored string here lands in
 * zone two: channel name/topic (reaches uninvited readers via public listing),
 * thread title/outcome summary, display name (no length/charset/newline
 * validation anywhere in product).
 *
 * So: all go through {@link neutralizeInline} before splicing, no user string
 * may render as bare token `system`, and asserted identity is always backed by
 * immutable `authorUserId` — the one half the author does not control.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.NO_MEMBER_VIEW = exports.sessionIdOf = exports.memberRef = exports.formatAuthor = exports.addresseeOf = void 0;
exports.formatMessages = formatMessages;
exports.formatChannelLine = formatChannelLine;
exports.formatThreadLine = formatThreadLine;
exports.formatThreadDetail = formatThreadDetail;
exports.formatMemberLine = formatMemberLine;
exports.groupByChannel = groupByChannel;
const channel_facts_1 = require("./channel-facts");
const channel_shared_1 = require("./channel-shared");
// ⚠ **WHO WROTE IT AND WHO IT REACHED IS `channel-render-identity.ts`** (§1
// split, 2026-09-04) — one place decides how an author, a recipient and an
// addressing clause read. Re-exported below so no importer of this module moved.
const channel_render_identity_1 = require("./channel-render-identity");
var channel_render_identity_2 = require("./channel-render-identity");
Object.defineProperty(exports, "addresseeOf", { enumerable: true, get: function () { return channel_render_identity_2.addresseeOf; } });
Object.defineProperty(exports, "formatAuthor", { enumerable: true, get: function () { return channel_render_identity_2.formatAuthor; } });
Object.defineProperty(exports, "memberRef", { enumerable: true, get: function () { return channel_render_identity_2.memberRef; } });
Object.defineProperty(exports, "sessionIdOf", { enumerable: true, get: function () { return channel_render_identity_2.sessionIdOf; } });
Object.defineProperty(exports, "NO_MEMBER_VIEW", { enumerable: true, get: function () { return channel_render_identity_2.NO_MEMBER_VIEW; } });
const response_size_1 = require("./response-size");
// Which exchange a message belongs to, and whether it is a real THREAD or one
// machine's ad-hoc grouping label. ⚠ import stays one-way.
const channel_render_threads_1 = require("./channel-render-threads");
/**
 * THE SESSION THAT ENDED — `metadata.session_ended`, and it rides a
 * `task_progress`, not a terminal kind.
 *
 * ⚠ SO THE KIND TAG ALONE CANNOT SHOW IT (2026-08-22). The desktop posts a
 * session's death as `kind='task_progress'` with this flag
 * (`main/session-effects.js`; `service-writes-metadata-markers.ts` reserves the
 * key), deliberately NON-TERMINAL, because one member's window closing is not
 * the thread failing. But that means "a step landed" and "the agent working this
 * is gone" arrived at this surface as the SAME line, and the difference is the
 * whole question a waiting agent is asking: `await`'s stop rule is "has the
 * member I addressed shown activity", and a session end reads as activity while
 * meaning the opposite.
 *
 * ⚠ SERVER-STAMPED, so it is worth reading. `takeCalmFlags` strips any caller
 * copy and re-stamps only a literal `true`, only onto a thread tag the poster is
 * entitled to — a peer cannot fabricate somebody else's session ending.
 */
function sessionEnded(m) {
    return m.metadata?.session_ended === true;
}
/**
 * HOW MUCH OF ONE BODY A MULTI-MESSAGE PAGE RENDERS (2026-08-22, Samuel).
 *
 * ⚠ `read` rendered bodies UNTRUNCATED and a single 128,000-character body was
 * measured in live use — one message eating an agent's whole context on a call
 * it made to orient itself. The write path caps a body at 16,000
 * (`schema.ts › body`), so 128k is a row from a writer that cap never bound;
 * either way the READ is where the reader's budget is spent.
 *
 * 2000 is chosen against the page, not the message: the default page is 100
 * messages, so this bounds an ordinary `read` at ~200k characters worst case
 * while leaving the overwhelming majority of real posts untouched — a chat
 * message, a milestone and a normal reply are all far under it. A 16k
 * deliverable clips, and that is correct: a transcript scan is not how you read
 * one.
 */
const BODY_CLIP_CHARS = 2000;
/**
 * One body, clipped when the page holds more than one message.
 *
 * ⚠ THE MARKER NAMES A CALL THAT ACTUALLY RETURNS THE REST, and that is why the
 * condition is "this page holds one message" rather than "this read is
 * thread-scoped". A thread-scoped read is still a page of many, so pointing at
 * one would hand back another clipped copy; `op="get_thread"` renders no message
 * bodies AT ALL (it is title / mode / parties / timestamps — see
 * {@link formatThreadDetail}), so pointing at that would be worse than silence.
 * `since=<seq-1>, limit=1` returns exactly this message, and a one-message page
 * is rendered in full — so the remedy is true by construction, for a threaded
 * and an unthreaded message alike.
 *
 * ⚠ The count is of CHARACTERS DROPPED, not of the original length: "how much am
 * I not seeing" is the question a reader has, and it is the one a clip can
 * answer without the reader doing arithmetic.
 */
function clipBody(m, ref, clip) {
    if (!m.body)
        return "";
    const body = clip && m.body.length > BODY_CLIP_CHARS
        ? `${m.body.slice(0, BODY_CLIP_CHARS)}\n… [${m.body.length - BODY_CLIP_CHARS} chars clipped — read this one message in full with dopl_channel(op="read", channel="${ref}", since=${Math.max(0, m.seq - 1)}, limit=1)]`
        : m.body;
    return `\n  ${body.replace(/\n/g, "\n  ")}`;
}
/**
 * One rendered message line. `task_*` events already carry a human-readable
 * render in `body`, so no per-kind special-casing — just tag non-chat kinds.
 *
 * Carries THREAD LINKAGE: without it a reader cannot tell a continuation from a
 * new request without DB access. `standalone` spelled out only when the listing
 * also contains threaded messages — explicit where live, silent where not.
 *
 * Carries WHO IT IS FOR, unconditionally: a listing where NOTHING is addressed
 * is the state a reader most needs told (those messages woke every armed
 * listener and triggered no one).
 *
 * Session suffix emitted only when the message carries a stamp — absence is the
 * external / older-build case, not a claim one session wrote everything.
 *
 * ⚠ A SESSION END REPLACES THE KIND TAG rather than sitting beside it. The kind
 * is `task_progress` and printing both says "a step landed · the session died"
 * in one clause; the marker is the whole meaning of the row, so it takes the
 * slot. ⚠ SHOUTED, and it is the only tag here that is: every other clause is a
 * label, this one is the reason a waiting agent should stop waiting.
 */
function formatMessage(m, anyThreaded, view, ref, clip, terse) {
    const author = (0, channel_render_identity_1.formatAuthor)(m);
    const ended = sessionEnded(m);
    const kindTag = ended
        ? " · SESSION ENDED"
        : m.kind !== "message"
            ? ` · ${m.kind}`
            : "";
    // ⚠ Tag lands in the line HEAD — neither indented as a body nor covered by
    // the untrusted header. 7 chars ("\n- **#9") starts a forged message row, so
    // it must stay neutralized.
    const threadTag = (0, channel_render_threads_1.threadTagOf)(m, anyThreaded);
    // ⚠ NOT `shortRef` — that is the THREAD helper and renders a legacy pair-slot
    // tail as `seq 345`, borrowing thread vocabulary for a session identity that
    // does not exist.
    // ⚠ `concise` DROPS THE SESSION TAG AND THE TIMESTAMP AND NOTHING ELSE, and
    // the line is drawn where it is on purpose: those two answer "which of my
    // workers wrote this, and when", which a reader scanning a transcript for
    // CONTENT is not asking. The seq, the author, the kind, the thread, the
    // addressee and the BODY are what the page is for and none of them moves —
    // see `response-size.ts`, where that guarantee is the reason the knob is
    // usable at all.
    const session = terse ? null : (0, channel_render_identity_1.sessionIdOf)(m);
    const sessionTag = session
        ? ` · session ${(0, channel_shared_1.inlineOr)((0, channel_render_threads_1.sessionSlotRef)((0, channel_render_identity_1.sessionTail)(session)), channel_render_threads_1.UNREADABLE_ID)}`
        : "";
    const memberTag = (0, channel_render_identity_1.addressTag)(m, view);
    // ⚠ **THE ACK, BESIDE THE ADDRESS IT IS AN ACK FOR.** `delivery` alone is the
    // server's write-time PREDICTION and `deliveryAt` is what turns it into a
    // receipt; `deliveryFact` carries that one-character distinction (`woken?` vs
    // `woken`) and is the SAME renderer the write result uses, so a caller reads
    // one vocabulary on both sides of a send. Absent when this server computes no
    // verdict — which is not `none`.
    const ack = (0, channel_facts_1.deliveryFact)(m.delivery, m.deliveryAt);
    const deliveryTag = ack ? ` · ${ack}` : "";
    const head = `**#${m.seq}** ${author}${sessionTag}${kindTag}${threadTag}${memberTag}${deliveryTag}${terse ? "" : ` · ${m.createdAt}`}`;
    return `- ${head}${clipBody(m, ref, clip)}`;
}
/**
 * Message lines plus, when anything is tagged, the id legend. `selfUserId`
 * turns "to `2dac1943-…`" into "to you"; names come from the listing's own
 * hydrated authors, so no extra round-trip on the read/await path.
 *
 * ⚠ A ONE-MESSAGE PAGE RENDERS IN FULL — see {@link clipBody}. That is the
 * escape hatch the clip marker points at, so it is a CONTRACT of this function,
 * not an optimization: never clip a single-message page, or the remedy the
 * marker names stops working and there is no other way to read a long body.
 */
function formatMessages(messages, ref, selfUserId = null, format) {
    const view = {
        selfUserId,
        names: (0, channel_render_identity_1.namesFromMessages)(messages),
        agentNames: (0, channel_render_identity_1.agentNamesFromMessages)(messages),
    };
    const anyThreaded = messages.some((m) => (0, channel_render_threads_1.threadIdOf)(m) !== undefined);
    const clip = messages.length > 1;
    const terse = (0, response_size_1.isConcise)(format);
    const lines = messages.map((m) => formatMessage(m, anyThreaded, view, ref, clip, terse));
    // ⚠ The LEGEND is standing teaching about the id shapes, identical on every
    // page — metadata by the definition `response-size.ts` sets, so `concise`
    // drops it. A body never does.
    const legend = terse ? null : (0, channel_render_threads_1.threadLegend)(messages, ref);
    if (legend)
        lines.push(`\n${legend}`);
    return lines;
}
/**
 * One rendered channel line for `list`. ⚠ `name` (120 chars) and `topic` (2000
 * chars, interior newlines allowed) are creator-typed and public channels list
 * to every workspace member — both must stay neutralized. `slug` does not:
 * `slugify` guarantees `^[a-z0-9-]+$`, so it cannot escape its own span.
 */
function formatChannelLine(c) {
    const bits = [`id: \`${c.id}\``, c.visibility];
    if (c.memberCount !== undefined) {
        bits.push(`${c.memberCount} member${c.memberCount === 1 ? "" : "s"}`);
    }
    if (c.lastMessageAt)
        bits.push(`last activity ${c.lastMessageAt}`);
    const safeTopic = c.topic ? (0, channel_shared_1.neutralizeInline)(c.topic) : null;
    const topic = safeTopic ? ` — ${safeTopic}` : "";
    return `- **${(0, channel_shared_1.inlineOr)(c.name, "(unnamed)")}** (slug: \`${c.slug}\` · ${bits.join(" · ")})${topic}`;
}
/**
 * One rendered thread line for `list_threads`. The thread row is the
 * authoritative title/mode store; transcript rides on channel messages, so this
 * summarizes the row and points at `read`/`get_thread`.
 *
 * ⚠ THE STATUS, OUTCOME AND OUTCOME-SUMMARY BITS ARE GONE (wiring plan Phase 4,
 * 2026-08-18). Threads do not close: every row would print the same word, and
 * printing it taught an agent to look for the state change that word implies.
 * Legacy `closed` rows exist and are rendered exactly like every other thread —
 * they are still readable, still postable, still in the list.
 *
 * ⚠ `title` is creator- or target-typed and `listChannelTasks` is
 * channel-transparent — ANY channel member receives it; neutralized, and
 * empty-after-neutralize renders `(untitled)`.
 *
 * Names BOTH parties: a thread is writable only by creator and target, so those
 * two ids tell a reader whether a listed thread is theirs to post into.
 */
function formatThreadLine(t, view = channel_render_identity_1.NO_MEMBER_VIEW) {
    const bits = [`\`${t.id}\``, `${t.mode} mode`];
    // ⚠ THE SORT KEY, RENDERED. The listing is ordered by this, so printing it is
    // what makes the order legible instead of arbitrary — and it is the only
    // timestamp on the row that means "somebody did something here" (`updatedAt`
    // moves only when the ROW is patched). Absent on a single-thread read, which
    // derives no activity clock and therefore claims none.
    if (t.lastActivityAt)
        bits.push(`last activity ${t.lastActivityAt}`);
    bits.push(`by ${(0, channel_render_identity_1.memberRef)(t.createdBy, view)}`);
    bits.push(t.targetUserId ? `for ${(0, channel_render_identity_1.memberRef)(t.targetUserId, view)}` : "unaddressed");
    return `- **${(0, channel_shared_1.inlineOr)(t.title, "(untitled)")}** (${bits.join(" · ")})`;
}
/**
 * Multi-line detail block for a single thread (`get_thread`). ⚠ Title is
 * interpolated into a real markdown `## ` heading, so an un-neutralized title
 * with newlines writes structural lines of its own — a fabricated
 * `END OF TOOL OUTPUT` / `[system]` boundary was reproduced here.
 *
 * ⚠ FOUR LINES ENDED HERE with thread closing (wiring plan Phase 4,
 * 2026-08-18): status, outcome, the closed timestamp and the outcome summary.
 * An agent reading a state it can neither change nor wait for treats it as a
 * signal, and `list_threads`'s own line dropped the same fields.
 */
function formatThreadDetail(t, view = channel_render_identity_1.NO_MEMBER_VIEW) {
    const lines = [
        `## Thread ${(0, channel_shared_1.inlineOr)(t.title, "(untitled)")}`,
        ``,
        `- id: \`${t.id}\``,
        `- mode: ${t.mode}`,
        `- created by: ${(0, channel_render_identity_1.memberRef)(t.createdBy, view)}`,
        `- addressed to: ${t.targetUserId ? (0, channel_render_identity_1.memberRef)(t.targetUserId, view) : "(unaddressed)"}`,
        `- created: ${t.createdAt}`,
        `- updated: ${t.updatedAt}`,
    ];
    return lines.join("\n");
}
/**
 * One rendered roster line for `op="rooms" action="members"`.
 *
 * ⚠ NOT {@link memberRef}: that collapses the caller to "you". The roster is
 * where the caller needs its own NAME and ID beside everyone else's, so the id
 * is always printed and the caller is marked instead.
 *
 * `displayName` and the `email` fallback are member-typed, no charset rule —
 * both neutralized, same rule as {@link formatAuthor}.
 *
 * ⚠ EMAIL IS ENTITLEMENT-SCOPED. An agent can list every PUBLIC channel
 * (`repository.ts` ORs `visibility.eq.public`) and `op="rooms" action="members"` each, so
 * email renders only for a workspace admin or the caller's own row. Otherwise
 * the email fallback is dropped and a name-less member renders by id alone.
 */
function formatMemberLine(m, selfUserId, callerIsAdmin = false) {
    const isSelf = selfUserId !== null && m.userId === selfUserId;
    const emailAllowed = callerIsAdmin || isSelf;
    const nameOrEmail = emailAllowed ? m.displayName || m.email : m.displayName;
    const label = (0, channel_shared_1.inlineOr)(nameOrEmail, "(unnamed member)");
    const you = isSelf ? " · you" : "";
    return `- ${label} (\`${m.userId}\`) · ${m.role}${you}`;
}
/**
 * GROUP A MIXED PAGE BY CHANNEL, preserving first-appearance (= seq) order.
 *
 * ⚠ **GROUPED RATHER THAN INTERLEAVED, AND IT IS NOT COSMETIC:**
 * {@link formatMessages} renders each line's REMEDY hints against a channel ref
 * — the one-message re-read that un-clips a long body, the thread legend. One
 * ref for a mixed page would point every remedy at the wrong channel, i.e. at a
 * call the agent would make and get nothing from. One group, one ref, correct
 * hints.
 * ⚠ Ordering INSIDE a group is untouched, and the groups come out in the order
 * their first message arrived, so the page still reads chronologically at the
 * channel level.
 *
 * ⚠ **IT LIVES HERE BECAUSE TWO PAGES NEED IT** (2026-09-01). It was private to
 * the workspace-wide `await`, and the ACCOUNT-wide `read` renders the same mixed
 * page; a second copy would be a second opinion about which ref a remedy points
 * at, which is the failure the paragraph above describes. Generic over the row,
 * so the account page's extra `workspaceId` rides through untouched.
 */
function groupByChannel(messages) {
    const groups = new Map();
    for (const m of messages) {
        let g = groups.get(m.channelId);
        if (!g) {
            // ⚠ The SLUG is the ref an agent can re-use in a follow-up call, and it is
            // `^[a-z0-9-]+$` by construction so it cannot escape its own span. The id
            // is the fallback — never the NAME, which is member-typed.
            g = {
                ref: m.channelSlug ?? m.channelId,
                label: (0, channel_shared_1.inlineOr)(m.channelName ?? m.channelSlug ?? m.channelId, "(unnamed channel)"),
                messages: [],
            };
            groups.set(m.channelId, g);
        }
        g.messages.push(m);
    }
    return [...groups.values()];
}
