"use strict";
/**
 * THREAD LINKAGE, RENDERED — the tag on a message line, the legend that expands
 * it, and the one predicate that decides whether an id is a THREAD at all.
 *
 * Split out of `channel-render.ts` at the §2 500-line cap when F2's session
 * stamp and F4's ad-hoc label landed, on the seam that file drew once already
 * (`channel-render-agents.ts` took agent addressing). The seam is a real reason
 * to change: everything here parses an id out of jsonb and decides what KIND of
 * grouping it names, where the rest of `channel-render.ts` renders typed rows.
 * One-way — nothing here imports `channel-render.ts`.
 *
 * The `channel-` filename prefix is required by the parity split-scan
 * (`tool-group-files.ts`).
 *
 * THE SECURITY RULE IS INHERITED VERBATIM (see `channel-render.ts`'s header):
 * every id spliced here goes through `inlineOr` first, because both splice sites
 * (the line head, the legend) sit OUTSIDE the untrusted-body framing and the
 * route's `metadata` is a bare record with no charset or newline rule.
 *
 * WHAT THAT NEUTRALIZATION IS FOR HAS CHANGED, and the old note here overstated
 * it: it said a non-UUID `metadata.taskId` is free peer text because the write
 * path gates "only inside `if (isUuid(...))`". Not since F-083. The else branch
 * runs `isLegacyThreadParticipant` and DELETES the tag unless it matches
 * `task-<this channel's id>-<digits>` exactly AND the caller is one of the two
 * parties to the message at that seq (`service-writes-metadata.ts`), so a value
 * stored TODAY is either a uuid or that fixed, harmless shape. The neutralizer
 * is DEFENCE IN DEPTH for the rows written before that gate existed — a channel
 * carries dozens — and for the render's own rule that it must be safe on
 * whatever jsonb hands it, not a guard on the live write path.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.UNREADABLE_ID = void 0;
exports.threadIdOf = threadIdOf;
exports.isFirstClassThreadId = isFirstClassThreadId;
exports.shortRef = shortRef;
exports.sessionSlotRef = sessionSlotRef;
exports.threadTagOf = threadTagOf;
exports.threadLegend = threadLegend;
const channel_shared_1 = require("./channel-shared");
/**
 * The tell for an id that neutralized to nothing. Same job as `(untitled)` and
 * `(unnamed)`: an empty pair of backticks would read as a rendering glitch,
 * where this reads as "the server could not print this one".
 */
exports.UNREADABLE_ID = "(unreadable id)";
/** How many leading characters of a thread id stand in for it inline. */
const THREAD_TAG_LEN = 8;
/** Distinct exchanges named in a listing's legend before it truncates. */
const THREAD_LEGEND_MAX = 6;
/**
 * A FIRST-CLASS thread id — a `channel_tasks` uuid, the only shape that names a
 * real thread. Deliberately the same test the rest of the product gates on:
 * `resolvePostMetadata` validates and 403-gates ONLY inside `isUuid`, and the
 * desktop's `targeting.firstClassTaskId` refuses to let anything else select the
 * thread lane at all. Anything failing it has no thread row, hence no title, no
 * status, no participants, and cannot be closed, reopened or joined.
 */
const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
/**
 * The SYNTHETIC id a receiving desktop mints for an untagged request:
 * `task-<channel uuid>-<seq>`, deterministic from (channel, seq)
 * (`main/trigger.js` `taskIdFor`, mirrored in `main/legacy-threads.js`).
 *
 * F4 — THE MECHANISM IS CORRECT AND STAYS; only the LABEL was wrong. It does a
 * real job: it groups an untagged request with its reply on the requester's
 * card, and killing it would strand every untagged exchange. What was wrong is
 * that it rendered IDENTICALLY to a real thread id — same `· thread <tag>`, same
 * legend entry, same "continue this thread with thread=<id>" instruction — so an
 * agent could not tell a shared, titled, closable thread from a label one
 * machine invented for its own card, and was told to post into the latter as if
 * it were the former.
 */
const SYNTHETIC_THREAD_RE = /^task-[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}-(\d{1,15})$/;
/**
 * The thread a message belongs to. `metadata.taskId` is the STORAGE key for the
 * domain's `thread` (see the boundary note in channel.ts) and is what actually
 * decides continuation-vs-new on the receiving side, so it is the right field
 * to read — the body cannot tell them apart.
 */
function threadIdOf(m) {
    return (0, channel_shared_1.metaString)(m, "taskId");
}
/** True when this id names a real, shared `channel_tasks` thread. */
function isFirstClassThreadId(id) {
    return UUID_RE.test(id);
}
/**
 * A SHORT, STABLE stand-in for an id — the half that actually distinguishes it.
 *
 * Not a blind `slice(0, 8)`, and that is the whole point of the function. Every
 * synthetic id in one channel begins `task-` + the SAME channel uuid, so the
 * first eight characters of two different ad-hoc exchanges are byte-identical
 * (`task-dba` for all of them) — a "short tag" that collapses the very things it
 * is there to tell apart. Its distinguishing half is the trailing SEQ, which is
 * also the most useful thing to print: it is the seq of the message that OPENED
 * the exchange, so `seq 345` names a line the reader can go and look at.
 *
 * `seq 345` and not `#345`: every one of these goes through `neutralizeInline`
 * at the splice site, which strips `#` along with the rest of the markdown
 * punctuation that could pose as structure — so a `#` here would silently render
 * as a bare number.
 */
function shortRef(id) {
    const synthetic = SYNTHETIC_THREAD_RE.exec(id);
    return synthetic ? `seq ${synthetic[1]}` : id.slice(0, THREAD_TAG_LEN);
}
/**
 * The same short stand-in for the TAIL OF A SESSION SLOT KEY, which is a
 * different kind of thing and needs a different word.
 *
 * A desktop slot key is `<channel>:<agent-or-thread>`, and the render prints the
 * tail. Through `shortRef` a legacy tail came out as `session \`seq 345\`` — the
 * thread vocabulary, on a session — which names a session identity that does not
 * exist: 345 is the seq of the message that opened the PAIR exchange, not
 * anything the session is called. `pair 345` says what the slot actually is (the
 * desktop's PAIR slot for that exchange) and cannot be mistaken for a thread
 * tag. Every other tail is an agent or thread uuid and is unchanged.
 */
function sessionSlotRef(tail) {
    const synthetic = SYNTHETIC_THREAD_RE.exec(tail);
    return synthetic ? `pair ${synthetic[1]}` : shortRef(tail);
}
/**
 * The thread clause of a message line.
 *
 * Three shapes, and the difference between the first two is F4:
 *  - a UUID → `· thread <tag>`, unchanged;
 *  - anything else → `· ad-hoc <tag>`, because it is NOT a thread. In practice
 *    that is the synthetic `task-<channel>-<seq>` label above; a fabricated
 *    non-UUID tag lands here too, which is correct — it has no thread row
 *    either, and the legend still prints it verbatim so nothing is hidden;
 *  - no tag at all → `· no thread`, but only when the listing uses tags at all
 *    (the distinction is explicit where it is live, silent where it is not).
 */
function threadTagOf(m, anyTagged) {
    const id = threadIdOf(m);
    if (!id)
        return anyTagged ? ` · no thread` : "";
    const label = isFirstClassThreadId(id) ? "thread" : "ad-hoc";
    return ` · ${label} ${(0, channel_shared_1.inlineOr)(shortRef(id), exports.UNREADABLE_ID)}`;
}
/**
 * Expands the short tags used on the message lines into full ids so a reader can
 * actually act on one. Scales with distinct exchanges, not with messages. Null
 * when nothing in the listing is tagged.
 *
 * TWO LINES, NOT ONE, and they promise different things — that separation is
 * F4's whole fix. The threads line says "continue one with thread=<id>", meaning
 * a shared, titled, closable exchange. The ad-hoc line cannot promise that: a
 * `task-…` id names no row, so posting into one is not joining anything.
 *
 * BUT IT MUST NOT ORDER THE READER NOT TO PASS ONE, which is what it did. The
 * receiving desktop's own prompt (`main/prompt-framing.js` THREAD_TAG) tells a
 * session to keep its `thread` argument on every post, and for a legacy exchange
 * that argument IS this id; "do NOT pass one" therefore contradicted the running
 * product and, followed, forks the exchange (the requester's card goes on
 * grouping by the legacy id while a new thread carries a different participant
 * set). What passing one really buys is the grouping and nothing more, so that
 * is what the line now says. Passing SOMEONE ELSE'S is not a hazard either: the
 * post path checks a legacy id against the opening message's pair and SILENTLY
 * STRIPS one that is not the poster's (F-083), so it lands untagged.
 *
 * L3: for a real thread the TITLE is the honest half of the pair — server-
 * stamped from the thread row, caller copies stripped — so a UUID entry with NO
 * title is one whose thread the server could not name. An ad-hoc entry is
 * titleless BY CONSTRUCTION (there is no row to title it), which is exactly why
 * a bare id used to be an ambiguous tell and is now a labelled one.
 *
 * FIX M2 — the title is peer-typed (200 chars, interior newlines allowed) and
 * this legend is SERVER NARRATION outside the untrusted-body framing, so it is
 * neutralized; a title that neutralizes to nothing renders as no title at all.
 */
function threadLegend(messages, ref) {
    const titles = new Map();
    for (const m of messages) {
        const id = threadIdOf(m);
        if (!id)
            continue;
        if (!titles.get(id))
            titles.set(id, (0, channel_shared_1.metaString)(m, "taskTitle"));
    }
    if (titles.size === 0)
        return null;
    const entries = [...titles.entries()];
    const threads = entries.filter(([id]) => isFirstClassThreadId(id));
    const adHoc = entries.filter(([id]) => !isFirstClassThreadId(id));
    const lines = [];
    if (threads.length > 0)
        lines.push(legendThreads(threads, ref));
    if (adHoc.length > 0)
        lines.push(legendAdHoc(adHoc, ref));
    return lines.join("\n");
}
/** One legend entry: `<short> = <full id>` plus the title where there is one. */
function legendEntry([id, title]) {
    const named = title ? (0, channel_shared_1.neutralizeInline)(title) : null;
    // Q1-E: the FULL id, at full length, is what lands here — and a code span
    // built by hand is not a container, it is two backticks. One backtick in a
    // peer-set `taskId` closed it and the rest of the value became legend text;
    // a newline forged whole legend entries and the tool-call guidance under
    // them. `inlineOr` is the container: it strips the backtick before it wraps.
    return `${(0, channel_shared_1.inlineOr)(shortRef(id), exports.UNREADABLE_ID)} = ${(0, channel_shared_1.inlineOr)(id, exports.UNREADABLE_ID)}${named ? ` (${named})` : ""}`;
}
/** `+N more` when the legend truncated, else nothing. */
function moreNote(total, shown) {
    return total > shown ? `; +${total - shown} more` : "";
}
function legendThreads(entries, ref) {
    const shown = entries.slice(0, THREAD_LEGEND_MAX).map(legendEntry);
    return `Threads above: ${shown.join("; ")}${moreNote(entries.length, shown.length)}. Continue one with dopl_channel(op="post", channel="${ref}", thread="<the full id>") — a post with no thread reads as a NEW request on the other side.`;
}
function legendAdHoc(entries, ref) {
    const shown = entries.slice(0, THREAD_LEGEND_MAX).map(legendEntry);
    return `Ad-hoc exchanges above: ${shown.join("; ")}${moreNote(entries.length, shown.length)}. These are NOT threads: a \`task-<channel>-<seq>\` id is the label a RECEIVING machine mints for an untagged request so the reply groups with it on that machine's card. There is no thread row behind one: no title, no status, no recorded parties, and nothing to close, reopen or join. Passing one as thread="<the full id>" keeps a reply grouped with its request, which is worth doing on every post in that exchange; it does not open a shared exchange, and an id that is not yours is dropped and the post lands untagged. If this work needs a real thread, open one with dopl_channel(op="create_thread", channel="${ref}", title="...", body="...", to="...").`;
}
