/**
 * THE WORD-LEVEL DIFF. Everything below is arithmetic over two strings — no
 * clock, no I/O, no DOM.
 *
 * ⚠ THE FIRST TEST IS THE ONE THE REST RELY ON: `tokenize` is LOSSLESS, so a
 * span-by-span re-join reproduces the input byte for byte. Every "before/after
 * reconstructs" assertion below is that property applied, and the renderer's
 * `whitespace-pre-wrap` is only honest while it holds.
 */

import { describe, expect, it } from "vitest";
import { DIFF_TOKEN_CEILING, diffBodies, diffStats, tokenize } from "./diff";

/** Re-join the spans that make up each side. */
function sides(spans: ReturnType<typeof diffBodies>) {
  return {
    before: spans.filter((s) => s.kind !== "added").map((s) => s.text).join(""),
    after: spans.filter((s) => s.kind !== "removed").map((s) => s.text).join(""),
  };
}

describe("tokenize", () => {
  it("is lossless — re-joining the tokens reproduces the input", () => {
    for (const input of [
      "",
      "one",
      "  leading and trailing  ",
      "a\n\nb\tc  ",
      "# Heading\n\n- bullet\n- another\n",
      "日本語のテキストです",
      "🙂 emoji 👨‍👩‍👧‍👦 family",
    ]) {
      expect(tokenize(input).join("")).toBe(input);
    }
  });

  it("keeps a leading whitespace run as its own token", () => {
    expect(tokenize("   x")).toEqual(["   ", "x"]);
  });
});

describe("diffBodies", () => {
  it("identical non-empty bodies are ONE `same` span, not an empty diff", () => {
    // "nothing changed" and "there is nothing here" are different facts.
    expect(diffBodies("hello world", "hello world")).toEqual([
      { kind: "same", text: "hello world" },
    ]);
  });

  it("two empty bodies are an empty diff", () => {
    expect(diffBodies("", "")).toEqual([]);
  });

  it("an empty before is a whole-body addition", () => {
    expect(diffBodies("", "brand new")).toEqual([
      { kind: "added", text: "brand new" },
    ]);
  });

  it("an empty after is a whole-body removal", () => {
    expect(diffBodies("all of it", "")).toEqual([
      { kind: "removed", text: "all of it" },
    ]);
  });

  it("a single replaced word touches only that word", () => {
    const spans = diffBodies("the quick brown fox", "the quick red fox");
    expect(spans.map((s) => s.kind)).toEqual(["same", "removed", "added", "same"]);
    expect(sides(spans)).toEqual({
      before: "the quick brown fox",
      after: "the quick red fox",
    });
  });

  it("emits the REMOVAL before the ADDITION at the same position", () => {
    const spans = diffBodies("alpha", "beta");
    expect(spans.map((s) => s.kind)).toEqual(["removed", "added"]);
  });

  it("an insertion in the middle keeps both surrounding runs `same`", () => {
    const spans = diffBodies("a b c", "a b extra c");
    expect(spans.filter((s) => s.kind === "added").map((s) => s.text)).toEqual([
      "extra ",
    ]);
    expect(sides(spans)).toEqual({ before: "a b c", after: "a b extra c" });
  });

  it("preserves markdown structure across a multi-line edit", () => {
    const before = "# Title\n\nFirst para.\n\n## Errors\n\nOld text.\n";
    const after = "# Title\n\nFirst para.\n\n## Errors\n\nNew text here.\n";
    const spans = diffBodies(before, after);
    expect(sides(spans)).toEqual({ before, after });
    expect(spans.some((s) => s.kind === "same" && s.text.includes("# Title"))).toBe(
      true
    );
  });

  it("CJK: a run with no spaces is ONE token, so an inner edit reports the run", () => {
    // ⚠ LOUD BUT NEVER WRONG, and never split mid-grapheme — the module's
    // docblock states the trade.
    const spans = diffBodies("日本語のテキスト", "日本語の文章");
    expect(spans.map((s) => s.kind)).toEqual(["removed", "added"]);
    expect(sides(spans)).toEqual({
      before: "日本語のテキスト",
      after: "日本語の文章",
    });
  });

  it("CJK with spaces diffs per space-separated run", () => {
    const spans = diffBodies("日本語 の テキスト", "日本語 の 文章");
    expect(spans.filter((s) => s.kind === "same").map((s) => s.text)).toEqual([
      "日本語 の ",
    ]);
  });

  it("astral characters survive intact", () => {
    const spans = diffBodies("keep 👨‍👩‍👧‍👦 drop", "keep 👨‍👩‍👧‍👦 stay");
    expect(sides(spans).after).toBe("keep 👨‍👩‍👧‍👦 stay");
    expect(spans.some((s) => s.kind === "same" && s.text.includes("👨‍👩‍👧‍👦"))).toBe(true);
  });

  it("whitespace-only change is still a change, and is not swallowed", () => {
    const spans = diffBodies("a b", "a  b");
    expect(sides(spans)).toEqual({ before: "a b", after: "a  b" });
    expect(spans.some((s) => s.kind !== "same")).toBe(true);
  });

  it("past the token ceiling it answers a WHOLE-BODY replace, never a partial diff", () => {
    const before = "x ".repeat(DIFF_TOKEN_CEILING + 1);
    const after = `${before}tail`;
    expect(diffBodies(before, after)).toEqual([
      { kind: "removed", text: before },
      { kind: "added", text: after },
    ]);
  });
});

describe("diffStats", () => {
  it("counts TOKENS on each side", () => {
    const spans = diffBodies("one two three", "one four five six");
    expect(diffStats(spans)).toEqual({ added: 3, removed: 2 });
  });

  it("an unchanged body counts zero on both sides", () => {
    expect(diffStats(diffBodies("same", "same"))).toEqual({ added: 0, removed: 0 });
  });
});
