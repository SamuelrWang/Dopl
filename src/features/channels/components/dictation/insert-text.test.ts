/**
 * **WHERE A DICTATED PHRASE LANDS — the arithmetic, with no engine and no render** (Samuel,
 * 2026-10-12, item 2: *"at the caret, existing text kept, interim results replaced in place,
 * final committed"*). Four clauses, and each one is a separate way for live dictation to look
 * broken while every other test stays green.
 *
 * ⚠ **THE SPAN IS FED BACK, EXACTLY AS THE COMPOSER FEEDS IT BACK.** Most cases below are a
 * SEQUENCE, because every bug this function can have is a bug in what the previous call left
 * behind — an anchor that did not advance, a length measured on the phrase instead of on what
 * was written, a separator counted twice. A per-call assertion with a hand-built span would miss
 * all three.
 */

import { describe, expect, it } from "vitest";
import { dictationSpanAt, insertDictation, type DictationSpan } from "./insert-text";

/** Drive a whole dictation: `[text, final]` in, the draft and span out. */
function dictate(
  draft: string,
  anchor: number,
  phrases: readonly [string, boolean][]
): { text: string; span: DictationSpan; caret: number } {
  let text = draft;
  let span = dictationSpanAt(anchor);
  let caret = anchor;
  for (const [phrase, final] of phrases) {
    const edit = insertDictation(text, span, phrase, final);
    text = edit.text;
    span = edit.span;
    caret = edit.caret;
  }
  return { text, span, caret };
}

describe("an interim is replaced IN PLACE", () => {
  it("overwrites the last interim rather than appending to it", () => {
    // ⚠ THE RECOGNIZER RE-WORDS ITSELF. Appending would read "hello wor hello world".
    const out = dictate("", 0, [
      ["hello wor", false],
      ["hello world", false],
    ]);
    expect(out.text).toBe("hello world");
  });

  it("measures the span on what was WRITTEN, separator included", () => {
    // ⚠ THE OFF-BY-ONE THIS CATCHES: a length taken from the phrase leaves the separator space
    // behind on every replacement, so the draft grows a space per interim ("note  hi").
    const out = dictate("note", 4, [
      ["hi", false],
      ["hi there", false],
    ]);
    expect(out.text).toBe("note hi there");
  });

  it("erases the span when the engine retracts the phrase", () => {
    const out = dictate("note", 4, [
      ["maybe", false],
      ["", false],
    ]);
    // ⚠ The separator goes with the words — not "note ".
    expect(out.text).toBe("note");
  });
});

describe("a final COMMITS", () => {
  it("leaves the words where the interim put them and does not write them twice", () => {
    const out = dictate("", 0, [
      ["hello wor", false],
      ["hello world", true],
    ]);
    expect(out.text).toBe("hello world");
    // The span is empty and anchored past the phrase: the next one lands after it.
    expect(out.span).toEqual({ start: 11, length: 0 });
  });

  it("is IDEMPOTENT over the same words, which is what the end-of-session commit does", () => {
    // ⚠ `use-dictation.ts › onEnd` delivers the outstanding interim AS A FINAL. It rewrites the
    // same characters in the same place; a commit that appended would double the last phrase of
    // every dictation that was stopped mid-sentence — i.e. most of them.
    const out = dictate("", 0, [
      ["and more", false],
      ["and more", true],
    ]);
    expect(out.text).toBe("and more");
  });

  it("puts the NEXT phrase after the committed one, with one space", () => {
    const out = dictate("", 0, [
      ["first", true],
      ["second", false],
    ]);
    expect(out.text).toBe("first second");
  });

  it("keeps a sentence of several phrases in order", () => {
    const out = dictate("", 0, [
      ["the quick", false],
      ["the quick brown", true],
      ["fox jum", false],
      ["fox jumped", true],
    ]);
    expect(out.text).toBe("the quick brown fox jumped");
  });
});

describe("the caret, and the text around it", () => {
  it("inserts AT the caret and keeps what follows", () => {
    // ⚠ THE OLD BEHAVIOUR, WHICH IS WHAT THIS REPLACES: appended to the end, i.e. "ping me".
    const out = dictate("ping  — thanks", 5, [["now", true]]);
    expect(out.text).toBe("ping now — thanks");
  });

  it("reports the caret immediately after what it wrote", () => {
    const out = dictate("ping ", 5, [["now", false]]);
    expect(out.caret).toBe(8);
    expect(out.text.slice(0, out.caret)).toBe("ping now");
  });

  it("writes at the START of a draft with no leading space", () => {
    // ⚠ `start === 0` has no preceding character to inspect, and a separator there would indent
    // every dictation that begins a message.
    const out = dictate("rest", 0, [["hello", true]]);
    expect(out.text).toBe("hellorest");
  });
});

describe("the separator", () => {
  it("adds ONE space when the draft does not already end in whitespace", () => {
    expect(insertDictation("note", dictationSpanAt(4), "hi", true).text).toBe("note hi");
  });

  it("adds NONE when it already does — a trailing space, a newline, a tab", () => {
    for (const draft of ["note ", "note\n", "note\t"]) {
      expect(insertDictation(draft, dictationSpanAt(draft.length), "hi", true).text).toBe(
        `${draft}hi`
      );
    }
  });

  it("is decided from the character BEFORE THE SPAN, not the end of the draft", () => {
    // ⚠ THE MUTATION THIS CATCHES: a separator chosen by `/\s$/.test(draft)`. The draft here ends
    // in a space, but the span does not sit there, so one is still needed at the caret.
    const out = dictate("ping tail ", 4, [["now", true]]);
    expect(out.text).toBe("ping now tail ");
  });

  it("trims the engine's own padding instead of stacking it", () => {
    // Desktop and browser engines both hand over leading spaces on partials.
    expect(insertDictation("note", dictationSpanAt(4), "   hi  ", true).text).toBe("note hi");
  });
});

/**
 * **THE FUNCTION STAYS TOTAL FOR ANY SPAN — which is NOT the same as surviving an outside edit**
 * (Review 21). A span whose indices no longer describe the draft still gets a sane answer here,
 * but keeping the operator's characters when they type mid-dictation is the CALLER's re-anchor
 * (`components/composer.tsx › lastWritten`), pinned in `composer-toolbar.test.tsx`. This describe
 * block read "the operator keeps typing while the mic is open" and implied it covered that.
 */
describe("any span it is handed gets a sane answer", () => {
  it("survives a draft that was CLEARED under a live span", () => {
    // ⚠ Discard, or a send, mid-dictation. The anchor now points PAST THE END of the draft, and
    // without the clamp `start` stays 4: the separator rule then sees a `start > 0` with no
    // character before it and indents the words — " hello there" into an empty box.
    const mid = insertDictation("note", dictationSpanAt(4), "hello", false);
    expect(mid.text).toBe("note hello");
    const out = insertDictation("", mid.span, "hello there", false);
    expect(out.text).toBe("hello there");
    expect(out.span).toEqual({ start: 0, length: 11 });
  });

  it("survives a span longer than the text left after it", () => {
    // ⚠ NOT CLAMPED, AND THAT IS THE DOCUMENTED BEHAVIOUR: `slice` treats an index past the end
    // as the end, so the over-long span drops the right characters with no arithmetic here.
    const out = insertDictation("ab", { start: 1, length: 99 }, "hi", true);
    expect(out.text).toBe("a hi");
  });

  it("survives a negative anchor", () => {
    // ⚠ THE DRAFT IS LONGER THAN THE ANCHOR IS NEGATIVE, AND THAT IS WHAT MAKES THIS A TEST.
    // `slice` counts a negative index FROM THE END, so an unclamped -5 over this draft splits it
    // at "abc" and writes into the middle ("abchidefgh"). A draft shorter than 5 would have
    // collapsed to the same answer either way and pinned nothing.
    const out = insertDictation("abcdefgh", { start: -5, length: 0 }, "hi", true);
    expect(out.text).toBe("hiabcdefgh");
  });
});
