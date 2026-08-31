// NARRATION TEXT SHAPING — the four caps and the two shapers, and the RULE that keeps them
// apart: a CAPTION is flattened, a MESSAGE keeps its shape.
//
// ⚠ §2 SPLIT OUT OF `main/session-narration.js` ON 2026-08-31, under the hard 500-line §1 cap.
// That file took the raised `PROSE_CAP` + the `truncated` confession (Samuel's cutoff report),
// the sender caption (F-376a) and the newline rule (F-376b) in one day and went 43 lines over.
//
// THE SEAM IS REASON-TO-CHANGE, and it is a real one rather than a place the file happened to be
// long: **this file changes when the answer to "how is a string bounded and shaped on its way to
// a renderer" changes.** `session-narration.js` changes when the RING, the event mapping or the
// fan-out changes. The three edits above were all this question and none of the other, which is
// the evidence the seam is where it belongs.
//
// ⚠ PURE, WITH NO REQUIRE AT ALL. `session-narration.js` re-exports every member below, so no
// caller and no test moved.
//
// ── ⚠ THE ONE RULE, WRITTEN ONCE HERE SO IT CANNOT DRIFT ────────────────────────────────────
//
//   CAPTION  a LABEL rendered on one row — a tool's input or result summary, a status line, an
//            id. {@link line} flattens it, because a newline in a caption is a broken layout and
//            the full value exists elsewhere.
//   PROSE    a MESSAGE somebody reads — the agent's answer, its thinking, the operator's own
//            typed turn, a direction's body and its reply. {@link prose} keeps its structure,
//            because for prose THIS RING IS THE ONLY COPY and its shape is content.
//
// ⚠ **BOTH ARE BOUNDED BY CHARACTERS AND NEITHER IS BOUNDED BY SHAPE.** A long message is CUT
// (and says so, via `truncated`) rather than made to fit by having its structure removed. The two
// are not interchangeable: a cut loses the tail and admits it; a flatten loses the meaning of
// everything that arrives (F-376b, which is exactly the mistake this file exists to keep fixed).

// Text bounds. A narration line is a caption, and every one of these strings is
// counterparty- or model-influenced on its way to a renderer.
const TEXT_CAP = 300;
const TOOL_CAP = 40;
// ⚠ A POST IS A MESSAGE, NOT A CAPTION — see the `outbound_post` branch for the arithmetic that
// picks 1000 rather than the UI's 2000.
// ⚠ AND DO NOT MOVE IT: `channels-v2/agent-stream-model.ts › POST_CAP` is the SAME 1000 and the
// held-draft join is character-for-character against it. Changing one silently breaks every
// pending Post card.
const POST_CAP = 1000;

/**
 * THE AGENT'S OWN PROSE IS A MESSAGE, NOT A CAPTION (Samuel, live review 2026-08-27).
 *
 * ⚠ THE BUG THIS FIXES, and it was invisible from the renderer. `assistant` / `thinking` / the
 * operator's own 1:1 text were all bounded by `TEXT_CAP`, so **the string reaching the SPA was
 * ALREADY 300 chars, mid-word, with no marker**. The work stream's "Show more" raises a DISPLAY
 * clamp (140 → 2000) over a string that had been cut long before it got there, so expanding a
 * long line revealed nothing and left the reader looking at "…or I'll pi". Two truncations, one
 * of them silent — and the silent one was upstream of the control meant to undo it.
 *
 * ⚠ 2000 IS THE UI'S OWN CEILING, DELIBERATELY — `channels-v2/agent-stream-log.tsx ›
 * EXPANDED_CHARS`. Matching it makes the renderer's clip the ONLY truncation an operator can
 * ever meet, and that one SAYS it clipped (INVARIANTS §9). Main is out of the business of
 * cutting text nobody is told about.
 *
 * ⚠ WHY PROSE AND NOT THE CAPTIONS. `TEXT_CAP` still bounds the tool input/result summaries and
 * the status lines, and it must: a tool result is a caption ABOUT a payload, `inputSummary` is
 * already capped at 140 by `session-io.js › summarizeInput`, and `inputFull` — which can carry
 * an entire file — never enters this ring at all (see the header). Widening those is how the
 * ring becomes a file cache.
 *
 * ⚠ WHY PROSE AND NOT THE POST. `POST_CAP` stays 1000 on its own stated argument: a `post` frame
 * is a local ECHO covering the seconds before the transcript loads, and **the transcript is the
 * record** — the UI dedupes the echo against it. The agent's prose has NO second copy anywhere:
 * this ring is the only place it ever exists, which is exactly why a silent cut there destroys
 * the only text there is.
 *
 * ⚠ THE COST, STATED. The ring is `NARRATION_MAX` (200) deep per session, `flush()` sends the
 * WHOLE ring for each dirty session, and the per-session ceiling is multiplied by
 * `session-windowless.js › MAX_CONCURRENT_SESSIONS` (6). Since 2026-08-30 the cost is bounded by
 * `RING_CHAR_BUDGET` (60k chars per session per flush) whatever this number says — which is what
 * makes raising it safe at all: a maximal prose block costs more of the ring, and what pays is
 * the OLDEST entries. The ring is memory-only, dies with the session, and is never persisted.
 * **If this ever needs tightening, tighten `NARRATION_MAX` or send a delta instead of the ring —
 * do not re-introduce a silent cut.**
 *
 * ⚠ 8000 SINCE 2026-08-31 (Samuel's cutoff report), AND THE NUMBER IS `session-directed.js ›
 * REPLY_CAP`'s. A private reply crossed to an MCP orchestrator whole at 8000 while the operator's
 * OWN panel lost everything past 2000 — the machine told a remote agent more than it told the
 * human it answers to. The two caps now agree, and `EXPANDED_CHARS`
 * (`channels-v2/agent-stream-log.tsx`) moved with it — raise them together or the silent cut is
 * back.
 * ⚠ AND A CUT NOW SAYS SO ON THE FRAME: {@link prose} stamps `truncated: true` on a line this cap
 * shortened, because a cap EQUAL to the UI's ceiling means the renderer's own `length >` check
 * can never fire on a main-cut line (2000 > 2000 is false — the exact hole Samuel hit). The tail
 * of a prose line exists NOWHERE else, so the flag is the only honest marker possible.
 */
const PROSE_CAP = 8000;

/** One line, whitespace collapsed, bounded, or ''. The same discipline as
 *  `session-summary.js › displayText`. */
function line(value, cap) {
  if (value == null) return '';
  return String(value).replace(/\s+/g, ' ').trim().slice(0, cap).trim();
}

/**
 * PROSE, BOUNDED — AND THE CUT CONFESSED (2026-08-31, Samuel's cutoff report).
 *
 * ⚠ WHY A FLAG AND NOT A LONGER CAP. `PROSE_CAP` equals the UI's `EXPANDED_CHARS` by design, so
 * the renderer's own `text.length > EXPANDED_CHARS` clip check is FALSE on every line this side
 * shortened — the string arrives at exactly the ceiling, and the reader gets a message that just
 * stops mid-sentence with nothing anywhere saying so. For prose the ring is the ONLY copy in
 * existence, so the tail is not elsewhere, it is GONE — which is precisely why the frame must say
 * it (INVARIANTS §9: a clipped read says so).
 *
 * Returns `{ text, truncated }`; `truncated` is `true` ONLY when the cap actually shortened the
 * text. Callers stamp the field on the entry only when true — absent means "arrived whole", the
 * same absent-means-unremarkable discipline `pending` carries.
 *
 * ── ⚠ IT KEEPS NEWLINES, AND {@link line} STILL DOES NOT (F-376b, 2026-08-31) ──────────────
 *
 * THE DEFECT. This helper's first version said "SAME CHAIN AS `line`, character for character",
 * and that inherited `/\s+/g -> ' '` — which is correct for a CAPTION and destroys a MESSAGE.
 * Every block structure an agent writes is made of newlines: headings, bullets, numbered steps,
 * fenced code, paragraphs. Flattened, a fifteen-step plan reaches the operator's panel as one
 * unreadable paragraph, and the renderer that would have drawn it as markdown never sees a
 * newline to draw. **The lane was not truncating the structure, it was deleting it**, silently,
 * on the one class of frame that is the only copy of itself.
 *
 * THE SPLIT, AND IT IS BY FRAME CLASS RATHER THAN BY LENGTH:
 *   PROSE     the agent's answer, its thinking, the operator's own typed turn, a direction's
 *             body and its reply — a MESSAGE somebody reads. Structure is content. Bounded by
 *             CHARACTERS (`PROSE_CAP`) and never by shape.
 *   CAPTION   tool input/result summaries, status lines, ids — a LABEL rendered on one row.
 *             `line` keeps the flatten, because a newline in a caption is a broken layout and
 *             the full value is elsewhere.
 *
 * ⚠ **CAPPING BY CHARACTERS AND NEVER BY STRUCTURE IS THE RULE**, so a long block is CUT (and
 * says so) rather than being made to fit by having its shape removed. The two are not
 * interchangeable: a cut loses the tail and admits it; a flatten loses the meaning of everything
 * that arrives.
 *
 * ⚠ WHAT IS STILL NORMALIZED, because prose is not a licence to pass a value through unread:
 * CR/CRLF collapse to `\n` (one spelling of a line break reaches the SPA), runs of blank lines
 * collapse to at most one (a paragraph break, never a page of them), trailing spaces per line
 * go, and horizontal runs of spaces/tabs INSIDE a line collapse — indentation at the START of a
 * line is preserved, because that is what a nested bullet and a code block are made of.
 * ⚠ AND `PROSE_CAP` IS STILL THE ONLY LENGTH BOUND. The normalizations above can only ever
 * SHORTEN, so the ring's `RING_CHAR_BUDGET` argument is unchanged: worst case is still
 * `PROSE_CAP` characters per prose entry.
 */
const LEADING_SPACE = /^[^\S\n]*/;
const HORIZONTAL_RUN = /[^\S\n]+/g;

function prose(value) {
  if (value == null) return { text: '', truncated: false };
  // ⚠ PER LINE, WHICH IS WHY IT IS A SPLIT AND NOT A CLEVERER REGEX. Only a per-line pass can
  // keep the INDENT (a nested bullet, a fenced code body) while collapsing runs INSIDE the line,
  // and a single global regex that tries to do both is the kind that quietly eats a `\n`.
  const whole = String(value)
    .replace(/\r\n?/g, '\n') // one spelling of a line break reaches the SPA
    .split('\n')
    .map((ln) => {
      const indent = LEADING_SPACE.exec(ln)[0];
      return (indent + ln.slice(indent.length).replace(HORIZONTAL_RUN, ' ')).replace(/\s+$/, '');
    })
    .join('\n')
    .replace(/\n{3,}/g, '\n\n') // a paragraph break, never a page of them
    // ⚠ TRIMMED LAST, so a leading blank line cannot survive as indentation on line one.
    .trim();
  const text = whole.slice(0, PROSE_CAP).trim();
  return { text, truncated: whole.length > text.length };
}

module.exports = {
  TEXT_CAP,
  TOOL_CAP,
  POST_CAP,
  PROSE_CAP,
  line,
  prose,
};
