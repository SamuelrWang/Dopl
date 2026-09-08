/**
 * THE LINE ESTIMATOR AND THE TRIM IT FEEDS (2026-09-08).
 *
 * ⚠ **THE TABLE BELOW IS THE FORMULA'S PIN, NOT A SAMPLE.** `estimateMessageLines`
 * is an ESTIMATE by design, which makes it exactly the kind of function whose
 * behaviour drifts silently — nothing downstream ever throws when it is wrong,
 * pages just quietly get longer or shorter. Every row here states a rule of the
 * formula rather than a convenient input.
 */

import { describe, expect, it } from "vitest";
import {
  estimateMessageLines,
  takeLineBudget,
} from "./transcript-line-budget";

describe("estimateMessageLines", () => {
  const cases: Array<{ name: string; body: string; lines: number }> = [
    // ⚠ 1, NOT 0. Every message occupies a row; a page of empty bodies summing
    // to zero would never reach any budget and the row cap would be the only
    // bound left, silently.
    { name: "an EMPTY body is one line", body: "", lines: 1 },
    { name: "a short one-liner is one line", body: "ok", lines: 1 },
    {
      name: "three short physical lines are three lines",
      body: "one\ntwo\nthree",
      lines: 3,
    },
    // A blank line is still a rendered line — `max(1, ceil(0 / 80))`.
    { name: "a blank physical line still counts 1", body: "a\n\nb", lines: 3 },
    // 240 / 80 = 3 exactly.
    { name: "one 240-char line wraps to three", body: "x".repeat(240), lines: 3 },
    // 81 chars is two lines, which is the whole reason the divide is a ceiling.
    { name: "81 chars is two lines", body: "x".repeat(81), lines: 2 },
    { name: "exactly 80 chars is one line", body: "x".repeat(80), lines: 1 },
    {
      name: "wrapping is summed PER physical line, not over the whole body",
      // 240 + 240 = 3 + 3, never ceil(481 / 80) = 7 (the newline would count).
      body: `${"x".repeat(240)}\n${"x".repeat(240)}`,
      lines: 6,
    },
    {
      // 🔒 THE FENCE RULE. Prose soft-wraps; a `<pre>` does not. Dividing code
      // by 80 lets one pasted log claim the whole budget.
      name: "a fenced block counts its lines VERBATIM, however long",
      body: ["```sh", "x".repeat(240), "short", "```"].join("\n"),
      lines: 4,
    },
    {
      name: "the same block unfenced wraps normally — the discriminator",
      body: ["sh", "x".repeat(240), "short", ""].join("\n"),
      lines: 6,
    },
    {
      name: "prose around a fence is still wrapped",
      body: ["intro", "```", "code", "```", "x".repeat(160)].join("\n"),
      lines: 6,
    },
    { name: "a tilde fence counts too", body: "~~~\ncode\n~~~", lines: 3 },
    {
      // An unclosed fence swallows the rest of the body — the right answer, and
      // the same one a markdown renderer gives.
      name: "an UNCLOSED fence holds to the end of the body",
      body: ["```", "x".repeat(400), "x".repeat(400)].join("\n"),
      lines: 3,
    },
  ];

  for (const { name, body, lines } of cases) {
    it(name, () => expect(estimateMessageLines(body)).toBe(lines));
  }
});

/** `n` messages whose bodies each estimate to `lines`, ascending by construction. */
function rows(n: number, lines: number): Array<{ id: number; body: string }> {
  const body = Array.from({ length: lines }, (_, i) => `l${i}`).join("\n");
  return Array.from({ length: n }, (_, i) => ({ id: i, body }));
}

describe("takeLineBudget", () => {
  it("keeps the NEWEST rows — the kept block is a SUFFIX", () => {
    // The cursor argument in one assertion: everything dropped sits strictly
    // below the oldest returned row, so the caller's next `before` is exact.
    const all = rows(10, 100);
    const { rows: kept } = takeLineBudget(all, 200, 300);
    expect(kept).toHaveLength(3);
    expect(kept.map((r) => r.id)).toEqual([7, 8, 9]);
  });

  it("takes the message that CROSSES the budget, then stops", () => {
    const { rows: kept } = takeLineBudget(rows(10, 2), 200, 300);
    // 2 lines each: 150 would be needed and only 10 exist, so all 10 come back.
    expect(kept).toHaveLength(10);
  });

  it("returns ~150 two-line messages against a 300-line budget", () => {
    const { rows: kept, hasMore } = takeLineBudget(rows(200, 2), 200, 300);
    expect(kept).toHaveLength(150);
    expect(hasMore).toBe(true);
  });

  it("🔒 ALWAYS at least one row, even when it alone blows the budget", () => {
    // 800 estimated lines in one message. A page of NONE would latch the
    // client's `exhausted` and hide the channel behind one long post.
    const one = [{ id: 0, body: "old" }, { id: 1, body: "x\n".repeat(800) }];
    const { rows: kept, hasMore } = takeLineBudget(one, 200, 300);
    expect(kept.map((r) => r.id)).toEqual([1]);
    expect(hasMore).toBe(true);
  });

  it("reports hasMore FALSE for a channel shorter than the budget", () => {
    const { rows: kept, hasMore } = takeLineBudget(rows(3, 2), 200, 300);
    expect(kept).toHaveLength(3);
    expect(hasMore).toBe(false);
  });

  it("reports hasMore TRUE at the row ceiling, even with nothing trimmed", () => {
    // ⚠ AT the ceiling is indistinguishable from OVER it — the rule
    // `listChannelTasks` already applies to `truncated`. Costs one short fetch;
    // the opposite error hides history.
    const { rows: kept, hasMore } = takeLineBudget(rows(4, 1), 4, 300);
    expect(kept).toHaveLength(4);
    expect(hasMore).toBe(true);
  });

  it("keeps every row when NO budget is asked for (the MCP / desktop path)", () => {
    const { rows: kept, hasMore } = takeLineBudget(rows(10, 100), 200, undefined);
    expect(kept).toHaveLength(10);
    expect(hasMore).toBe(false);
  });

  it("answers an empty block with an empty page and hasMore false", () => {
    const { rows: kept, hasMore } = takeLineBudget([], 200, 300);
    expect(kept).toEqual([]);
    expect(hasMore).toBe(false);
  });
});
