// THE NARRATION FEED'S PER-ENTRY SHAPERS — §2 SPLIT out of `main/session-narration.js`
// (2026-10-11, the hard 500-line §1 cap, alongside `session-narration-fanout.js`).
//
// ⚠ WHAT IS HERE IS "WHAT ONE ENTRY LOOKS LIKE", AND THAT IS THE SEAM. Four things, all of them
// pure over a single entry or a single string: the sender caption's bound, the inbound body's
// two-cap shaper, the run ordinal that is stamped at the append, and the directed-reply re-tag.
// What STAYS in `session-narration.js` is the event -> entry MAPPING itself (`entryFor`) and the
// privacy re-tag beside it: those two answer "which event becomes which kind", which is a
// different question and a different reason to change. The caps themselves are a third file
// again (`narration-text.js`), and its header carries the CAPTION-vs-PROSE rule all of this obeys.
//
// ⚠ PURE, AND THE ONLY REQUIRE IS THE CAP LAYER. Nothing here touches a window, a session
// registry or a timer — that is `session-narration-fanout.js` — and nothing here requires
// `session-narration.js` back, so the dependency points ONE WAY and there is no cycle. (That
// module replaces `module.exports` wholesale, so a partner capturing it at load would get `{}`.)
//
// ⚠ ORDER OF APPLICATION IS NOT IN THIS FILE and must not drift into it. `note` applies
// `retagPrivate` first and {@link retagDirected} only over its output, and stamps
// {@link stampToolRun} at the APPEND; both facts are argued where the calls are.
//
// Every name below is re-exported from `session-narration.js` unchanged where it was exported
// before, so no caller and no test moved.

const { POST_CAP, prose } = require('./narration-text');

/**
 * HOW MUCH OF A SENDER'S NAME RIDES AN INBOUND FRAME (2026-10-10, #3081).
 *
 * ⚠ IT IS A CAPTION CAP, so it goes through `narration-text.js › line` with everything that
 * implies: one row, flattened, no newline a peer-typed name could use to forge a second line in
 * the banner. 80 is generous for a display name and still bounded — `authorLabel` can hand over
 * *"<display name>'s agent"*, which is a member's own prose plus eight characters.
 * ⚠ NOT `TOOL_CAP` (40), which it is close enough to borrow and would be wrong to: that number is
 * a tool identifier's bound and would start cutting real names the day somebody tightened it.
 */
const SENDER_CAP = 80;

/**
 * AN ARRIVING MESSAGE'S BODY: PROSE SHAPE, POST-SIZED BOUND (2026-10-10, #3081).
 *
 * ⚠ **IT IS TWO CAPS ON PURPOSE AND NEITHER IS REDUNDANT.** {@link prose} is the only shaper that
 * keeps a message's structure (indents, bullets, fences, one blank line between paragraphs) and the
 * only one that reports its own cut — but its bound is `PROSE_CAP`, which is sized for text THIS
 * RING IS THE ONLY COPY OF. An inbound message is not that: it is on the server and in the message
 * pane. So the shape comes from `prose` and the LENGTH from `POST_CAP`, the bound the `outbound_post`
 * arm already justifies for the same reason.
 *
 * ⚠ **THE TRUNCATION FLAG IS THE OR OF BOTH CAPS.** `prose` reports only its own; the re-slice below
 * is a second place the tail can be lost, and a frame that lost it without saying so is the silent
 * cut `narration-text.js › prose` was written to abolish (INVARIANTS §9). Either cut must confess.
 * ⚠ TRIMMED AFTER THE SLICE, matching `line`'s chain: a slice that lands on the space between
 * two words must not leave it dangling.
 */
function inboundBody(value) {
  const { text: whole, truncated } = prose(value);
  const text = whole.slice(0, POST_CAP).trim();
  return { text, truncated: truncated || text.length < whole.length };
}

/**
 * HOW MANY TOOL USES THIS RUN HAS HAD, STAMPED ON THE FRAME (2026-10-10, Samuel's "the count went down").
 *
 * ⚠ **THE RING IS A WINDOW AND A COUNT DERIVED FROM IT IS NOT A COUNT.** The stream groups a run of
 * consecutive tool frames into one row and prints the run's size, and it computed that size by COUNTING THE
 * FRAMES IT STILL HAD (`agent-stream-model.ts › toolUses`). Both of the ring's bounds then evict the
 * OLDEST entries by design — `NARRATION_MAX` is 200 and a call plus its result is two frames, so a run of
 * more than ~100 uses starts dropping its own head, and `RING_CHAR_BUDGET` gets there sooner. The row
 * counted up to 105 and then counted DOWN as the head went over the side: a running total that decreases,
 * which is the one thing a running total cannot do.
 *
 * ⚠ **SO THE NUMBER IS STAMPED WHERE NOTHING IS EVICTED — AT THE APPEND**, which is where `note` calls
 * this. The ordinal travels ON the newest frames, which are the ones a ring never drops, so the reader's
 * `max` is exact however much of the head is gone. ⚠ It is a per-RUN ordinal and not a session total: the
 * row says what THIS run did, and a session total under one of several runs would be a different (and
 * wrong) sentence.
 *
 * ⚠ **THE RESET MIRRORS THE READER'S RUN BREAK, WHICH IS "ANY NON-TOOL LANE"** — `agent-stream-lanes.ts ›
 * LANE_BY_KIND` puts `tool` and `result` in the tool lane and everything else elsewhere, so `result`
 * carries the run's current ordinal WITHOUT advancing it (a call and its result are two frames about ONE
 * use, the rule `toolUses` already stated) and every other kind ends the run. Two tables, one rule: if that
 * map gains a tool-lane kind, this reset gains it too.
 *
 * ⚠ **ABSENT IS THE HONEST DEGRADATION.** A `result` with no run behind it, and every non-tool frame, carry
 * nothing rather than a zero — the reader falls back to its own frame count, which is exactly the behaviour
 * every build before this one had.
 */
function stampToolRun(s, entry) {
  if (!entry || !s) return entry;
  const run = Number.isFinite(s.toolRun) && s.toolRun > 0 ? s.toolRun : 0;
  if (entry.kind === 'tool') {
    s.toolRun = run + 1;
    return { ...entry, runCount: s.toolRun };
  }
  if (entry.kind === 'result') return run > 0 ? { ...entry, runCount: run } : entry;
  s.toolRun = 0;
  return entry;
}

/**
 * THE ANSWER TO A DIRECTION, TAGGED AS ONE (2026-08-31).
 *
 * ⚠ APPLIED AFTER `session-narration.js › retagPrivate` AND ONLY OVER ITS OUTPUT, so there is
 * exactly one place an `assistant` line becomes private and this narrows that result rather than
 * competing with it. A directed turn IS a private turn; what this adds is WHOSE question it
 * answers, which is the half the operator cannot otherwise see.
 * ⚠ ONLY `private` MOVES — the same rule `retagPrivate` follows for `assistant`. A `post`
 * inside a directed turn keeps `lane: 'channel'`, because it is the one thing that did not
 * stay private.
 */
function retagDirected(entry, isDirected) {
  if (!entry || !isDirected || entry.kind !== 'private') return entry;
  return { ...entry, kind: 'directed-reply', lane: 'directed' };
}

module.exports = { SENDER_CAP, inboundBody, stampToolRun, retagDirected };
