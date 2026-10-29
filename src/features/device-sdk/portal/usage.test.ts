import { describe, expect, it } from "vitest";
import { parseUsageRange, summarizeUsage, usageBuckets } from "./usage";

const NOW = new Date("2026-10-28T14:37:12.000Z");

describe("usageBuckets", () => {
  it("24h = 24 hourly UTC buckets ending with the current hour", () => {
    const b = usageBuckets("24h", NOW);
    expect(b).toHaveLength(24);
    expect(b[23]).toMatchObject({ startIso: "2026-10-28T14:00:00.000Z", endIso: "2026-10-28T15:00:00.000Z", tick: "14:00" });
    expect(b[0].startIso).toBe("2026-10-27T15:00:00.000Z");
  });

  it("7d and 30d = daily UTC buckets ending today, contiguous", () => {
    const week = usageBuckets("7d", NOW);
    expect(week).toHaveLength(7);
    expect(week[6]).toMatchObject({ startIso: "2026-10-28T00:00:00.000Z", tick: "Oct 28" });
    const month = usageBuckets("30d", NOW);
    expect(month).toHaveLength(30);
    for (let i = 1; i < month.length; i++) expect(month[i].startIso).toBe(month[i - 1].endIso);
  });
});

describe("parseUsageRange", () => {
  it("defaults to 30d and accepts only known ranges", () => {
    expect(parseUsageRange({})).toBe("30d");
    expect(parseUsageRange({ range: "7d" })).toBe("7d");
    expect(parseUsageRange({ range: ["24h", "7d"] })).toBe("24h");
    expect(parseUsageRange({ range: "1h" })).toBe("30d");
  });
});

describe("summarizeUsage", () => {
  it("totals and success rate; null rate with no calls", () => {
    const [a, b] = usageBuckets("7d", NOW);
    expect(summarizeUsage([{ ...a, calls: 8, failed: 2 }, { ...b, calls: 2, failed: 0 }])).toMatchObject({
      calls: 10,
      failed: 2,
      successRate: 0.8,
    });
    expect(summarizeUsage([{ ...a, calls: 0, failed: 0 }]).successRate).toBeNull();
  });
});
