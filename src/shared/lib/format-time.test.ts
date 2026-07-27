import { describe, expect, it } from "vitest";
import { formatChannelTimestamp } from "./format-time";

/**
 * Build an ISO string for a Date constructed from LOCAL components, so the
 * round-trip through `formatChannelTimestamp` (which renders in local time)
 * is deterministic regardless of the runner's timezone.
 */
function isoFor(date: Date): string {
  return date.toISOString();
}

describe("formatChannelTimestamp", () => {
  it("renders same-day timestamps as time only", () => {
    const now = new Date();
    const today = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
      14,
      34,
      0
    );
    const out = formatChannelTimestamp(isoFor(today));
    expect(out).toBe("2:34 PM");
    // No calendar date on a same-day stamp.
    expect(out).not.toContain(",");
  });

  it("renders a prior day as date + time", () => {
    const now = new Date();
    const earlier = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
      14,
      34,
      0
    );
    earlier.setDate(earlier.getDate() - 8);
    const out = formatChannelTimestamp(isoFor(earlier));
    // Self-consistent with the same locale calls the formatter uses.
    const expectedDate = earlier.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      ...(earlier.getFullYear() === now.getFullYear() ? {} : { year: "numeric" }),
    });
    const expectedTime = earlier.toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
    });
    expect(out).toBe(`${expectedDate}, ${expectedTime}`);
    // A prior-day stamp always carries a calendar date.
    expect(out).toContain(",");
    expect(out).toMatch(/^[A-Z][a-z]{2} \d{1,2}(, \d{4})?, \d{1,2}:\d{2} (AM|PM)$/);
  });

  it("appends the year for a prior-year timestamp", () => {
    const now = new Date();
    const lastYear = new Date(
      now.getFullYear() - 1,
      5,
      26,
      14,
      34,
      0
    );
    const out = formatChannelTimestamp(isoFor(lastYear));
    expect(out).toContain(String(now.getFullYear() - 1));
  });

  it("renders null / undefined / garbage as an em-dash", () => {
    expect(formatChannelTimestamp(null)).toBe("—");
    expect(formatChannelTimestamp(undefined)).toBe("—");
    expect(formatChannelTimestamp("")).toBe("—");
    expect(formatChannelTimestamp("not-a-date")).toBe("—");
  });
});
