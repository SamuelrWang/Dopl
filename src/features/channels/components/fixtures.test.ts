/**
 * THE THREAD-ACTIVITY FIXTURE — pinned so the channels-page strip and the WIRED
 * /home strip cannot drift in the two ways F-316 measured they had: cell COUNT
 * and zero SEMANTICS.
 *
 * The strip has no axis and no legend, so a divergence here is invisible in a
 * screenshot — a 24-cell fixture wraps differently in the 380px column than the
 * 31-cell real series, and a `0` fixture paints the palest GREEN where the real
 * strip paints an EMPTY WELL for a quiet day. Both are pinned below.
 */

import { describe, expect, it } from "vitest";
import { HARDCODED_THREAD_ACTIVITY } from "./fixtures";
import { OVERVIEW_SERIES_DAYS } from "@/features/workspaces/server/service-overview";
import { ACTIVITY_SHADE } from "./thread-activity";

describe("HARDCODED_THREAD_ACTIVITY", () => {
  it("has EXACTLY OVERVIEW_SERIES_DAYS cells — the same window the real strip draws", () => {
    // ⚠ The real strip is 31 daily bins; a 24-cell fixture wrapped differently in
    // the same column. Tied to the source of truth so a change to the window
    // cannot leave the fixture behind.
    expect(HARDCODED_THREAD_ACTIVITY).toHaveLength(OVERVIEW_SERIES_DAYS);
  });

  it("uses the EMPTY-WELL encoding for a quiet slice — `-1`, never a `0` shade", () => {
    // `ActivityCells` reads <0 as an empty well and 0..4 as `ACTIVITY_SHADE`
    // steps, exactly as `activityLevels` emits for the real series. A quiet slice
    // must be `-1` (empty well), so the fixture reads a low day and a dead day
    // apart the same way the wired strip does.
    expect(HARDCODED_THREAD_ACTIVITY).toContain(-1);
    for (const level of HARDCODED_THREAD_ACTIVITY) {
      expect(level).toBeGreaterThanOrEqual(-1);
      expect(level).toBeLessThan(ACTIVITY_SHADE.length);
    }
  });
});
