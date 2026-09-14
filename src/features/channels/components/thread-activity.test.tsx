// @vitest-environment jsdom
/**
 * THE ACTIVITY STRIP'S ARITHMETIC — the half that can lie without looking
 * different.
 *
 * A density picture with no axis and no legend is entirely its quantiser: the
 * squares are the same squares whether the numbers behind them are real,
 * relative, absolute, or invented. So what is pinned here is exactly the three
 * claims the strip makes — that a busy day is dark, that a measured ZERO is not
 * the palest green, and that a single message never rounds down into "nothing
 * happened".
 */

import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import {
  ACTIVITY_SHADE,
  ThreadActivityStrip,
  activityLevels,
} from "./thread-activity";

const bins = (...counts: number[]) =>
  counts.map((count, i) => ({
    date: `2026-08-${String(i + 1).padStart(2, "0")}`,
    count,
  }));

describe("activityLevels", () => {
  it("scales to the BUSIEST day in the window, not to an absolute", () => {
    // ⚠ The same shape at two magnitudes must render identically. There is no
    // workspace-independent "busy": 4 messages is a lot for a two-person
    // relationship and nothing for a team room, so an absolute ramp would paint
    // every home channel uniformly pale and say nothing at all.
    const small = activityLevels(bins(1, 2, 4));
    const large = activityLevels(bins(100, 200, 400));
    expect(small).toEqual(large);
  });

  it("puts the maximum on the DARKEST step", () => {
    const levels = activityLevels(bins(1, 10));
    expect(levels.at(-1)).toBe(ACTIVITY_SHADE.length - 1);
  });

  it("⚠ a MEASURED ZERO is -1, never the palest shade", () => {
    // The palest green and "nothing happened" must not be the same pixel —
    // that is the exact confusion between a low bin and an unmeasured one that
    // the fixture version could not avoid.
    expect(activityLevels(bins(0, 5))[0]).toBe(-1);
  });

  it("⚠ ONE message never rounds down into the empty face", () => {
    const levels = activityLevels(bins(1, 400));
    expect(levels[0]).toBeGreaterThanOrEqual(0);
  });

  it("an all-zero window is all empty wells, not a flat pale bar", () => {
    expect(activityLevels(bins(0, 0, 0))).toEqual([-1, -1, -1]);
  });

  it("never exceeds the ramp it indexes into", () => {
    for (const level of activityLevels(bins(1, 3, 7, 9, 40, 41))) {
      expect(level).toBeLessThan(ACTIVITY_SHADE.length);
    }
  });
});

describe("ThreadActivityStrip", () => {
  it("renders NOTHING while loading — not a row of empty wells", () => {
    // An empty well is a MEASURED zero, so a full row of them during loading
    // would state 31 quiet days the server has not answered for yet.
    const { container } = render(
      <ThreadActivityStrip bins={[]} loading metricLabel="Messages" />
    );
    expect(container.querySelector('[role="img"]')).toBeNull();
    expect(screen.getByRole("status")).toBeTruthy();
  });

  it("renders nothing at all for an empty settled series", () => {
    const { container } = render(
      <ThreadActivityStrip bins={[]} loading={false} metricLabel="Messages" />
    );
    expect(container.firstChild).toBeNull();
  });

  it("STATES ITS UNIT AND ITS WINDOW — a picture that names neither is a guess", () => {
    render(
      <ThreadActivityStrip
        bins={bins(1, 2, 3)}
        loading={false}
        metricLabel="Messages"
      />
    );
    const strip = screen.getByRole("img");
    expect(strip.getAttribute("aria-label")).toBe(
      "Messages in this channel per day, 3 days to 2026-08-03"
    );
    expect(strip.children).toHaveLength(3);
  });
});
