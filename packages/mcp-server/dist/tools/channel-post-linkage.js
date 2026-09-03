"use strict";
/**
 * DID THIS POST LAND IN A THREAD, AND IN THE ONE THAT WAS ASKED FOR? — the
 * `thread=` and `landed=` facts on a post result.
 *
 * ⚠ WHAT THIS FILE USED TO BE (T10, 2026-09-02). `threadLinkageNote` answered
 * the same question in up to five paragraphs, and to write the longest of them
 * it made a SECOND API CALL per post — `listChannelThreads`, to offer the caller
 * threads it might have meant. That call is gone with the paragraphs, so a post
 * is now one round trip instead of two. The QUESTION it answered is not gone: a
 * sender genuinely cannot tell a continuation from a new request, and a dropped
 * tag is silent, so both survive as tokens the caller reads in one glance.
 *
 * ⚠ THE ANSWER IS READ OFF THE **STORED** MESSAGE, NEVER OFF THE REQUEST.
 * `metadata.taskId` is what the receiving desktop routes on, so this reports
 * what actually LANDED rather than what was asked for — which is the only way
 * `dropped` can be told from `threaded` at all.
 *
 * ⚠ AN AD-HOC ID IS NOT A THREAD, and the two must not render the same. A
 * first-class (uuid) id names a `channel_tasks` row; a legacy
 * `task-<channel>-<seq>` id is the label a receiving machine mints for an
 * untagged request so a reply groups with it on that machine's card. It has no
 * row, no title and nothing to join — and the remedies are OPPOSITE: an ad-hoc
 * id the caller PASSED is working and must keep being passed (dropping it forks
 * the exchange), where one the caller did NOT pass means the machine grouped it
 * and a real thread is the upgrade. `landed=` states which case this is; the
 * doctrine states what to do about each.
 *
 * ⚠ `channel-` filename prefix required by the parity split-scan (parity.test.ts).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.threadFacts = threadFacts;
const channel_shared_1 = require("./channel-shared");
// ⚠ THE one predicate for "is this id a real thread" — shared with the read
// render so the two lanes cannot disagree about what a `task-…` id is.
const channel_render_threads_1 = require("./channel-render-threads");
/**
 * ⚠ PURE, AND THAT IS THE POINT: every input is already in hand by the time the
 * post returns, so answering this costs no request. `askedThread` is the
 * caller's own argument from THIS call — never round-tripped through storage —
 * which is what makes a mismatch decidable.
 */
function threadFacts(message, askedThread) {
    const landedThread = (0, channel_shared_1.metaString)(message, "taskId");
    if (!landedThread) {
        return { thread: undefined, landed: askedThread ? "dropped" : "room" };
    }
    return {
        thread: landedThread,
        landed: (0, channel_render_threads_1.isFirstClassThreadId)(landedThread) ? "thread" : "adhoc",
    };
}
