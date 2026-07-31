import { describe, expect, it } from "vitest";
import { MAX_COMPOSER_LINES, growHeight } from "./auto-grow-textarea";

// A realistic composer: 12.5px text at leading-relaxed (1.625) = 20.3px per line,
// plus py-1 = 8px of vertical padding.
const LH = 20.3;
const PAD = 8;
const line = (n: number) => LH * n + PAD;

describe("growHeight (shared with the desktop session window's D7 math)", () => {
  it("stays one line tall while the content is one line", () => {
    expect(growHeight(line(1), LH, MAX_COMPOSER_LINES, PAD)).toBeCloseTo(line(1));
  });

  it("grows with the typed lines up to the cap", () => {
    expect(growHeight(line(2), LH, MAX_COMPOSER_LINES, PAD)).toBeCloseTo(line(2));
    expect(growHeight(line(3), LH, MAX_COMPOSER_LINES, PAD)).toBeCloseTo(line(3));
  });

  it("stops at exactly three lines and then scrolls", () => {
    // Everything past the cap returns the SAME height — the overflow scrolls.
    expect(growHeight(line(4), LH, MAX_COMPOSER_LINES, PAD)).toBeCloseTo(line(3));
    expect(growHeight(line(40), LH, MAX_COMPOSER_LINES, PAD)).toBeCloseTo(line(3));
  });

  it("never collapses below one line, whatever the measurement says", () => {
    expect(growHeight(0, LH, MAX_COMPOSER_LINES, PAD)).toBeCloseTo(line(1));
    expect(growHeight(-500, LH, MAX_COMPOSER_LINES, PAD)).toBeCloseTo(line(1));
  });

  it("keeps the vertical padding inside the clamp", () => {
    expect(growHeight(line(9), LH, MAX_COMPOSER_LINES, 0)).toBeCloseTo(LH * 3);
    expect(growHeight(line(9), LH, MAX_COMPOSER_LINES, 24)).toBeCloseTo(LH * 3 + 24);
  });

  it("falls back to the raw scrollHeight when the line-height is degenerate", () => {
    // `line-height: normal` parses to NaN; growing is better than collapsing.
    expect(growHeight(120, Number.NaN, MAX_COMPOSER_LINES, PAD)).toBe(120);
    expect(growHeight(120, 0, MAX_COMPOSER_LINES, PAD)).toBe(120);
  });

  it("honours a caller-chosen cap, and never a cap below one line", () => {
    expect(growHeight(line(9), LH, 5, PAD)).toBeCloseTo(line(5));
    expect(growHeight(line(9), LH, 0, PAD)).toBeCloseTo(line(3)); // 0 -> default
    expect(growHeight(line(9), LH, -2, PAD)).toBeCloseTo(line(1)); // clamped to 1
  });

  it("defaults to the session window's three-line cap", () => {
    expect(MAX_COMPOSER_LINES).toBe(3);
  });
});
