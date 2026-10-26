import { describe, expect, it } from "vitest";
import { bucketByLocalDay, localDayKey, windowDays } from "./token-spend-days";

const expected = (at: Date) =>
  new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit" }).format(at);

function atLocal(daysAgo: number, hour: number, minute = 0): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() - daysAgo, hour, minute);
}

const mark = (at: Date, tokens: number) => ({ at: at.toISOString(), tokens });

describe("localDayKey", () => {
  it("names the operator's calendar day, not the UTC one", () => {
    const earlyToday = atLocal(0, 0, 30);
    const lateTonight = atLocal(0, 23, 30);
    expect(localDayKey(earlyToday)).toBe(expected(earlyToday));
    expect(localDayKey(earlyToday)).toBe(localDayKey(lateTonight));
  });
});

describe("windowDays", () => {
  it("is 31 contiguous local days ending today, oldest first", () => {
    const days = windowDays(31);
    expect(days).toHaveLength(31);
    expect(new Set(days).size).toBe(31);
    expect(days[30]).toBe(expected(new Date()));
    expect(days[0]).toBe(expected(atLocal(30, 12)));
    expect([...days].sort()).toEqual(days);
  });
});

describe("bucketByLocalDay", () => {
  const days = windowDays(31);

  it("adds up the runs that share a local day", () => {
    const { byDay, total, runs } = bucketByLocalDay(
      [mark(atLocal(0, 0, 30), 30_000), mark(atLocal(0, 23, 30), 10_000), mark(atLocal(1, 12), 5_000)],
      days
    );
    expect(byDay.get(expected(new Date()))).toBe(40_000);
    expect(byDay.get(expected(atLocal(1, 12)))).toBe(5_000);
    expect({ total, runs }).toEqual({ total: 45_000, runs: 3 });
  });

  it("drops a run outside the drawn window from the total and the count", () => {
    const { byDay, total, runs } = bucketByLocalDay(
      [mark(atLocal(0, 12), 20_000), mark(atLocal(40, 12), 90_000)],
      days
    );
    expect(byDay.size).toBe(1);
    expect({ total, runs }).toEqual({ total: 20_000, runs: 1 });
  });

  it("drops an unparseable instant rather than bucketing it as today", () => {
    const { byDay, total, runs } = bucketByLocalDay([{ at: "not-a-date", tokens: 10_000 }], days);
    expect({ size: byDay.size, total, runs }).toEqual({ size: 0, total: 0, runs: 0 });
  });
});
