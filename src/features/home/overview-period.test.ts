import { describe, expect, it } from "vitest";
import { USAGE_SCOPE_ALL, USAGE_SCOPE_DESKTOP } from "./overview-types";
import { monthKey, monthLabel, shiftMonthKey, usageSeriesPath } from "./overview-period";

describe("the credit histogram period", () => {
  it("carries the year across January and December", () => {
    expect(shiftMonthKey("2026-01", -1)).toBe("2025-12");
    expect(shiftMonthKey("2025-12", 1)).toBe("2026-01");
    expect(monthLabel("2026-09")).toBe("September 2026");
  });

  it("sends neither param for the default selection", () => {
    expect(usageSeriesPath(USAGE_SCOPE_ALL, monthKey())).toBe(
      "/api/home/overview-series?range=month&metric=credits"
    );
  });

  it("narrows by channel id, Desktop agent and a past month", () => {
    expect(usageSeriesPath("ch-1", monthKey())).toContain("&channel=ch-1");
    expect(usageSeriesPath(USAGE_SCOPE_DESKTOP, monthKey())).toContain("&channel=desktop");
    const past = shiftMonthKey(monthKey(), -1);
    expect(usageSeriesPath(USAGE_SCOPE_ALL, past)).toBe(
      `/api/home/overview-series?range=month&metric=credits&month=${past}`
    );
  });
});
