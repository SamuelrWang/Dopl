/**
 * **WHERE A DICTATED PHRASE LANDS IN THE DRAFT — the whole rule, as one pure function**
 * (Samuel, 2026-10-12, item 2: *"Make it stream into the input live, as if typed: at the caret,
 * existing text kept, interim results replaced in place, final committed"*).
 *
 * ⚠ **IT EXISTS BECAUSE THE OLD RULE WAS "append the finished phrase to the end", AND THAT IS
 * NOT WHERE A PERSON IS TYPING.** `use-dictation.ts` held partials back as a preview beside the
 * mic and only finals reached the box, appended after a `replace(/\s+$/, "")`. So a sentence
 * dictated with the caret mid-draft arrived at the far end, and nothing appeared at all until
 * the engine decided a phrase was over.
 *
 * ⚠ **PURE, AND SEPARATE FROM THE HOOK, BECAUSE THE INTERESTING PART IS ARITHMETIC.** Replacing
 * an interim span in place is index bookkeeping — a separator that must not double, a span that
 * must be re-measured after every replacement, a commit that must leave the next phrase room —
 * and none of it needs an engine, a microphone or a React render to test. The hook keeps the
 * events; this keeps the arithmetic.
 *
 * ⚠ **THE SPAN IS THE STATE, AND IT IS THE ONLY STATE.** A caller holds one {@link DictationSpan}
 * per dictation session and hands back whatever this returns. There is no "accumulated text"
 * anywhere: the draft itself is the accumulator.
 *
 * 🔴 **AND BECAUSE A SPAN IS A CHARACTER RANGE, THIS FUNCTION CANNOT SURVIVE AN OUTSIDE EDIT ON
 * ITS OWN — THE CALLER MUST RE-ANCHOR** (Review 21; this docblock claimed the opposite and
 * pointed at the clamp, which was false in both halves). The operator may type while the mic is
 * open — the box stays live, which is the whole point of streaming into it — and a keystroke
 * before the caret shifts every index after it, so the stored range comes to cover THEIR
 * characters and the next interim replaces them. **A clamp cannot help with that**: it bounds
 * where the replacement happens, it does not stop one. The rule that makes it lossless lives in
 * `components/composer.tsx` (`lastWritten`): a draft that differs from what dictation last wrote
 * re-anchors the session at the caret with an EMPTY span, so the next phrase is inserted rather
 * than swapped in. What this function owes is only that it stays total for whatever span it is
 * handed — see {@link insertDictation}'s clamp, which is all the clamp is for.
 */

/** Where the live (not yet committed) dictated span sits in the draft. */
export interface DictationSpan {
  /** Index in the draft where the span begins — the caret when the session opened, then the end
   *  of each committed phrase. */
  start: number;
  /** How many characters of the draft the live span currently occupies. `0` is "nothing live":
   *  the state between a commit and the next interim, and the state a session opens in. */
  length: number;
}

/** The draft after one phrase, with the span and caret that follow from it. */
export interface DictationEdit {
  /** The whole new draft. */
  text: string;
  /** The span to hand back on the next phrase. */
  span: DictationSpan;
  /** Where the caret belongs — immediately after what was just written, as if typed. */
  caret: number;
}

/** A session that has written nothing yet, anchored at `start`. */
export function dictationSpanAt(start: number): DictationSpan {
  return { start, length: 0 };
}

/**
 * Keep the ANCHOR inside `draft`, so this function is TOTAL for any span it is handed.
 *
 * ⚠ **IT IS NOT THE ANSWER TO AN OUTSIDE EDIT, AND IT NEVER WAS** (Review 21) — that is the
 * caller's re-anchor, stated in the header. What it answers is narrower and real: a span recorded
 * one phrase ago can point PAST THE END of a draft that was since cleared, and `start > 0` with no
 * character before it makes the separator rule indent the next phrase into an empty box.
 *
 * ⚠ **ONLY `start` IS CLAMPED, AND THE SPAN'S LENGTH DELIBERATELY IS NOT.** It is read in exactly
 * one place — `draft.slice(start + length)` — and `String.prototype.slice` already treats an index
 * past the end as the end, so a span longer than the text after it drops the right characters with
 * no arithmetic of ours. A second `Math.min` there would be a branch no input can reach, i.e. the
 * kind of defence that reads as a handled case and is never exercised.
 */
function clampStart(draft: string, start: number): number {
  return Math.min(Math.max(start, 0), draft.length);
}

/**
 * Apply one phrase — interim or final — to the draft.
 *
 * @param draft The draft as it stands.
 * @param span Where the last interim went, from the previous call (or {@link dictationSpanAt}).
 * @param phrase The engine's text. Trimmed here: partials routinely arrive with a leading space.
 * @param final `true` once the engine calls this phrase done.
 *
 * ⚠ **AN INTERIM IS REPLACED IN PLACE, WHICH IS WHY THE SPAN IS RETURNED AND NOT DERIVED.** The
 * recognizer re-words itself as it listens — "hello wor" becomes "hello world" becomes "hello
 * world or" — so each interim must overwrite the last one's characters rather than append to
 * them. The returned `length` is measured on what was WRITTEN (separator included), not on the
 * phrase, because that is what the next call has to overwrite.
 *
 * ⚠ **A FINAL COMMITS BY MOVING THE ANCHOR PAST ITSELF AND EMPTYING THE SPAN.** Nothing is
 * rewritten and nothing is appended a second time: the words are already in the draft from the
 * last interim, and `{ start: caret, length: 0 }` is what makes the next phrase land after them
 * instead of on top of them. It is also what makes the end-of-session commit idempotent — the
 * hook delivers the trailing interim as a final, which rewrites the same characters in the same
 * place and then advances.
 *
 * ⚠ **THE SEPARATOR IS DECIDED FROM THE CHARACTER BEFORE THE SPAN, NEVER STORED.** One space,
 * only when the draft does not already end in whitespace there, and never at position 0. A flag
 * ("have I added a space yet?") is a second piece of state to keep in step with a draft the
 * operator can edit underneath it; the character is right there and cannot drift.
 *
 * ⚠ **AN EMPTY PHRASE ERASES THE LIVE SPAN RATHER THAN BEING IGNORED.** A recognizer that
 * retracts its interim ("" after "hello wor") means the words are gone, and leaving them in the
 * box would make the draft disagree with what was heard.
 */
export function insertDictation(
  draft: string,
  span: DictationSpan,
  phrase: string,
  final: boolean
): DictationEdit {
  const start = clampStart(draft, span.start);
  const spoken = phrase.trim();
  const before = draft.slice(0, start);
  // ⚠ `spoken.length > 0` IS WHAT MAKES AN EMPTY PHRASE ERASE CLEANLY — no separate empty branch,
  // because a guard that only repeated this one would be an unobservable difference. No words
  // means no separator, so `written` is "" and the replacement simply removes the live span.
  const needsSpace = spoken.length > 0 && start > 0 && !/\s$/.test(before);
  const written = `${needsSpace ? " " : ""}${spoken}`;
  const text = `${before}${written}${draft.slice(start + span.length)}`;
  const caret = start + written.length;
  return {
    text,
    span: final ? { start: caret, length: 0 } : { start, length: written.length },
    caret,
  };
}
