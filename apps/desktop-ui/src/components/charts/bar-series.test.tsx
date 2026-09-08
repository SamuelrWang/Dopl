import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { BarSeries, niceCeiling, type BarPoint } from "./bar-series";

/**
 * THE SHARED BAR HISTOGRAM — the plot behind BOTH the workspace Overview's
 * `ActivityChart` and /home's `UsageChart`.
 *
 * ⚠ **THESE CASES PIN THE REFERENCE GEOMETRY SAMUEL RULED ON 2026-09-08**, and
 * they are the reason the plot has a suite of its own at all: every visual rule
 * he named is a property of the PRIMITIVE, not of either card, so pinning them
 * in the two page suites would have been the same assertion written twice and
 * drifting once. *"our bars are too thick/wide … their bars are not transparent
 * … i like the slanted dates, it makes it able to fit. we should be able to fit
 * 30 days … their font colors are black not gray."*
 *
 * ⚠ **CLASS NAMES ARE THE ASSERTION HERE, DELIBERATELY.** jsdom computes no
 * layout and resolves no container query, so "rotated", "solid" and "ink" are
 * only observable as the utilities that produce them. The two rules that ARE
 * arithmetic — the 80% slot ratio and the pill floor — are read off the inline
 * style, where they are real numbers.
 */

/** `n` consecutive days of July, the first of them empty so the pill floor has
 *  a zero-height bar to hold up. */
function julyDays(n: number): BarPoint[] {
  return Array.from({ length: n }, (_, index) => ({
    key: `2026-07-${String(index + 1).padStart(2, "0")}`,
    label: `${index + 1}/7`,
    value: index,
  }));
}

const barsOf = (root: HTMLElement) =>
  Array.from(root.querySelectorAll<HTMLElement>("[title]"));
/** The captions are the only rotated boxes in the plot. */
const captionsOf = (root: HTMLElement) =>
  Array.from(root.querySelectorAll<HTMLElement>(".origin-top-right"));

describe("niceCeiling", () => {
  it("climbs a 1/2/5/10 ladder so every gridline is a round number", () => {
    expect(niceCeiling(0)).toBe(4);
    expect(niceCeiling(3)).toBe(4);
    expect(niceCeiling(9)).toBe(20);
    expect(niceCeiling(41)).toBe(80);
  });
});

describe("BarSeries", () => {
  it("draws one bar AND one caption for every day of a 31-day month", () => {
    const { container } = render(<BarSeries points={julyDays(31)} />);

    expect(barsOf(container)).toHaveLength(31);
    // 🔒 EVERY day is captioned — the plot used to print every 5th, and the
    // slant is what bought the other 30.
    const captions = captionsOf(container);
    expect(captions).toHaveLength(31);
    expect(captions.map((node) => node.textContent)).toEqual(
      julyDays(31).map((day) => day.label)
    );
  });

  it("slants every caption −45° about its top-right corner, over its own bar", () => {
    const { container } = render(<BarSeries points={julyDays(31)} />);

    for (const caption of captionsOf(container)) {
      expect(caption.className).toContain("rotate-[-45deg]");
      expect(caption.className).toContain("origin-top-right");
    }
    // The anchor corner sits on the bar's CENTRE, so the first caption is half a
    // bar in from the left edge and the last is half a bar in from the right.
    const [first] = captionsOf(container);
    const last = captionsOf(container).at(-1);
    expect(Number.parseFloat(first!.style.right)).toBeCloseTo(98.71, 1);
    expect(Number.parseFloat(last!.style.right)).toBeCloseTo(1.29, 1);
  });

  it("gives each bar 80% of its day's slot, so 31 bars spend 80cqw of 100", () => {
    const { container } = render(<BarSeries points={julyDays(31)} />);
    const widths = barsOf(container).map((bar) =>
      Number.parseFloat(bar.style.width)
    );

    expect(new Set(widths).size).toBe(1);
    expect(widths.reduce((sum, width) => sum + width, 0)).toBeCloseTo(80, 1);
  });

  it("never lets a bar be shorter than it is wide — the pill floor", () => {
    const { container } = render(<BarSeries points={julyDays(31)} />);
    const [empty] = barsOf(container);

    expect(empty!.style.height).toBe("0%");
    // The floor IS the width, in the same unit, capped so a 7-bin plot does not
    // stand every empty bar up as a slab.
    expect(empty!.style.minHeight).toBe(`min(${empty!.style.width}, 28px)`);
    expect(empty!.className).toContain("rounded-full");
  });

  it("paints the bars with a SOLID token, never an alpha tint", () => {
    const { container } = render(<BarSeries points={julyDays(31)} />);

    for (const bar of barsOf(container).slice(0, -1)) {
      expect(bar.className).toContain("bg-chart-bar");
      // 🔒 `surface-raised-*` is alpha on purpose; a bar wearing one takes the
      // card's face and reads as a smudge (Samuel: "not transparent").
      expect(bar.className).not.toContain("surface-raised");
    }
  });

  it("inks the newest day by default, in fill AND in caption weight", () => {
    const { container } = render(<BarSeries points={julyDays(31)} />);
    const bars = barsOf(container);
    const captions = captionsOf(container);

    expect(bars.at(-1)!.className).toContain("bg-surface-cta");
    expect(bars.at(-1)!.className).not.toContain("bg-chart-bar");
    expect(captions.at(-1)!.className).toContain("font-medium");
    expect(bars[0]!.className).not.toContain("bg-surface-cta");
    expect(captions[0]!.className).not.toContain("font-medium");
  });

  it("inks the day named by `highlightKey` instead", () => {
    const { container } = render(
      <BarSeries points={julyDays(31)} highlightKey="2026-07-04" />
    );
    const bars = barsOf(container);
    const captions = captionsOf(container);

    expect(bars[3]!.className).toContain("bg-surface-cta");
    expect(captions[3]!.className).toContain("font-medium");
    // The default has moved off the last bar, not been added to.
    expect(bars.at(-1)!.className).toContain("bg-chart-bar");
    expect(captions.at(-1)!.className).not.toContain("font-medium");
  });

  it("writes both axes in INK, not the muted gray they used to be", () => {
    const { container } = render(<BarSeries points={julyDays(31)} />);

    for (const caption of captionsOf(container)) {
      expect(caption.className).toContain("text-text-primary");
    }
    // The Y axis is the other set of `font-mono` labels on the plot.
    const axis = Array.from(
      container.querySelectorAll<HTMLElement>(".font-mono")
    );
    expect(axis.length).toBeGreaterThan(31);
    for (const label of axis) {
      expect(label.className).not.toContain("text-text-muted");
    }
  });

  it("thins the captions ONLY below the width where they would crowd", () => {
    const { container } = render(<BarSeries points={julyDays(31)} />);
    const captions = captionsOf(container);

    // Counted back from the newest day, which always keeps its caption.
    expect(captions.at(-1)!.className).not.toContain("@max-[420px]:hidden");
    expect(captions.at(-2)!.className).toContain("@max-[420px]:hidden");
    expect(captions.at(-3)!.className).not.toContain("@max-[420px]:hidden");
  });

  it("still draws the axis for an empty series rather than disappearing", () => {
    const { container } = render(<BarSeries points={[]} />);

    expect(barsOf(container)).toHaveLength(0);
    expect(captionsOf(container)).toHaveLength(0);
    expect(container.querySelectorAll(".border-t")).toHaveLength(5);
  });
});
