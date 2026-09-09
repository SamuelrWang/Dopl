/**
 * DAY GROUPING — pure, UTC, and the same function on both sides of the wire.
 *
 * ⚠ THE DST CASE IS THE POINT. A local-zone key makes one day 23 or 25 hours
 * long, which puts two rows an hour apart into two different groups (or one row
 * into a day that has two 01:30s). A UTC day is 24 hours on every day of the
 * year, so the grouping is stable wherever the reader is standing.
 */

import { describe, expect, it } from "vitest";
import type { Revision } from "../types";
import { groupByDay } from "./group";

function rev(id: string, createdAt: string): Revision {
  return {
    id,
    resourceType: "knowledge_entry",
    resourceId: "e-1",
    workspaceId: "ws-1",
    actor: { userId: "u-1", kind: "user", agentSessionId: null },
    op: "edit",
    summary: null,
    payload: { body: "b" },
    contentHash: "h",
    createdAt,
    updatedAt: createdAt,
  };
}

describe("groupByDay", () => {
  it("answers nothing for nothing", () => {
    expect(groupByDay([])).toEqual([]);
  });

  it("keeps the incoming order — newest day first, newest row first", () => {
    const days = groupByDay([
      rev("c", "2026-09-09T18:00:00.000Z"),
      rev("b", "2026-09-09T09:00:00.000Z"),
      rev("a", "2026-09-08T23:00:00.000Z"),
    ]);
    expect(days.map((d) => d.day)).toEqual(["2026-09-09", "2026-09-08"]);
    expect(days[0].revisions.map((r) => r.id)).toEqual(["c", "b"]);
    expect(days[1].revisions.map((r) => r.id)).toEqual(["a"]);
  });

  it("does NOT sort — a repository that stopped ordering must show through", () => {
    const days = groupByDay([
      rev("a", "2026-09-08T23:00:00.000Z"),
      rev("c", "2026-09-09T18:00:00.000Z"),
    ]);
    expect(days.map((d) => d.day)).toEqual(["2026-09-08", "2026-09-09"]);
  });

  it("re-opens no group — rows of one day arriving apart still land together", () => {
    // ⚠ The map is keyed, so a day that appears twice in the input is ONE group
    // in the output. That is what lets a second PAGE merge into the first's
    // last day instead of printing a duplicate heading.
    const days = groupByDay([
      rev("a", "2026-09-09T18:00:00.000Z"),
      rev("b", "2026-09-08T18:00:00.000Z"),
      rev("c", "2026-09-09T02:00:00.000Z"),
    ]);
    expect(days).toHaveLength(2);
    expect(days[0].revisions.map((r) => r.id)).toEqual(["a", "c"]);
  });

  it("🔒 groups in UTC across a spring-forward boundary", () => {
    // 2026-03-08 is US spring-forward. Two rows either side of 02:00 local
    // Eastern are the SAME UTC day and must group as one.
    const days = groupByDay([
      rev("after", "2026-03-08T07:30:00.000Z"),
      rev("before", "2026-03-08T06:30:00.000Z"),
    ]);
    expect(days).toHaveLength(1);
    expect(days[0].day).toBe("2026-03-08");
  });

  it("🔒 a UTC midnight boundary splits, whatever the reader's zone", () => {
    const days = groupByDay([
      rev("later", "2026-09-09T00:00:00.000Z"),
      rev("earlier", "2026-09-08T23:59:59.999Z"),
    ]);
    expect(days.map((d) => d.day)).toEqual(["2026-09-09", "2026-09-08"]);
  });

  it("accepts the Postgres `+00` stamp shape as well as the ISO one", () => {
    const days = groupByDay([rev("a", "2026-09-09 18:00:00+00")]);
    expect(days[0].day).toBe("2026-09-09");
  });
});
