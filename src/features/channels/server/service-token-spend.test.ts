import { beforeEach, describe, expect, it, vi } from "vitest";
import { marksFrom, readTokenSpend } from "./service-token-spend";
import { listTokenSpend } from "./repository-token-spend";
import type { SessionStateEntryInput } from "../schema-sessions";

/**
 * The two rules the ledger's correctness rests on, pinned at the pure seam:
 * WHICH reports become marks, and WHAT a mark carries. The merge itself
 * (`GREATEST(stored, reported)`) lives in SQL and is pinned by the migration,
 * not here — a mocked repository asserting a monotonic merge would be testing
 * the mock.
 *
 * ⚠ **THE READ IS PINNED TOO SINCE 2026-09-06, AND FOR ONE FACT ONLY: IT NAMES
 * NO DAYS.** Samuel ruled the strip buckets by the operator's LOCAL day, so this
 * function stopped bucketing at all — a UTC bucket on the wire is the
 * half-conversion the surface must never be handed. The bucketing itself is
 * pinned where it now happens (`apps/desktop-ui/src/pages/home/
 * overview-token-spend.test.ts`).
 */
// ⚠ BOTH EXPORTS ARE DECLARED even though only one is exercised: a mock factory
// that omits a name the module under test imports fails at the USE site with a
// "no export defined" throw, which reads as a broken test rather than as the
// missing stub it is.
vi.mock("./repository-token-spend", () => ({
  listTokenSpend: vi.fn(),
  recordTokenSpend: vi.fn(),
}));
const mockList = vi.mocked(listTokenSpend);

function entry(over: Partial<SessionStateEntryInput> = {}): SessionStateEntryInput {
  return {
    sessionKey: "chan:thread:agent",
    channelId: "11111111-1111-4111-8111-111111111111",
    name: "agent-abc",
    state: "working",
    startedAt: "2026-09-06T01:00:00.000Z",
    tokensSpent: 40_000,
    ...over,
  } as SessionStateEntryInput;
}

describe("marksFrom", () => {
  it("carries a measured run, preferring the operator's name over the agent id", () => {
    const [mark] = marksFrom([entry({ displayName: "Prime" })]);
    expect(mark).toMatchObject({
      session_key: "chan:thread:agent",
      started_at: "2026-09-06T01:00:00.000Z",
      tokens: 40_000,
      agent_name: "Prime",
    });
  });

  it("falls back to the agent id when the operator never named it", () => {
    expect(marksFrom([entry()])[0].agent_name).toBe("agent-abc");
  });

  // ⚠ THE RUN-IDENTITY RULE. `sessionKey` is reused by the next session on the
  // same thread, so a report with no `startedAt` cannot be attributed to a run
  // and must contribute NOTHING rather than merge into another run's row.
  it("drops a report with no startedAt", () => {
    expect(marksFrom([entry({ startedAt: null })])).toEqual([]);
  });

  // ⚠ NULL IS NOT ZERO. An unmeasured run must not be recorded as having spent
  // nothing — that is a measurement nobody took.
  it("drops a report whose tokensSpent was never measured", () => {
    expect(marksFrom([entry({ tokensSpent: null })])).toEqual([]);
  });

  // ⚠ …AND ZERO IS NOT NULL. A run measured under one 10k bucket reports 0, and
  // it is a run that happened.
  it("keeps a measured zero", () => {
    expect(marksFrom([entry({ tokensSpent: 0 })])[0].tokens).toBe(0);
  });

  it("keeps every live session in one push, so the write stays a single call", () => {
    const marks = marksFrom([
      entry({ sessionKey: "a" }),
      entry({ sessionKey: "b", tokensSpent: 10_000 }),
      entry({ sessionKey: "c", startedAt: null }),
    ]);
    expect(marks.map((m) => m.session_key)).toEqual(["a", "b"]);
  });
});

describe("readTokenSpend", () => {
  beforeEach(() => {
    mockList.mockReset();
  });

  /**
   * 🔒 **NO DAY KEYS ON THE WIRE** (Samuel's ruling, 2026-09-06). This used to
   * answer `points: [{ day: "2026-09-06", tokens }]`, bucketed in UTC, and a
   * renderer wanting local days could only have shifted those labels — the
   * half-conversion this feature refused from the start. Runs travel as
   * instants; the surface names the days.
   */
  it("hands each run over as an instant, bucketing nothing", async () => {
    mockList.mockResolvedValue({
      rows: [
        { started_at: "2026-09-06T03:30:00.000Z", tokens: 30_000 },
        { started_at: "2026-09-06T23:30:00.000Z", tokens: 10_000 },
      ] as never,
      truncated: false,
    });

    const report = await readTokenSpend("user-1", "2026-08-06T00:00:00.000Z");

    expect(report.marks).toEqual([
      { at: "2026-09-06T03:30:00.000Z", tokens: 30_000 },
      { at: "2026-09-06T23:30:00.000Z", tokens: 10_000 },
    ]);
    // ⚠ THE TWO RUNS ARE ON ONE UTC DAY AND CAN BE ON TWO LOCAL ONES. Nothing
    // here may decide which — that is the whole ruling, and a `day`, a `total`
    // or a `runs` field would be this file deciding it anyway.
    expect(report).not.toHaveProperty("points");
    expect(report).not.toHaveProperty("total");
    expect(report).not.toHaveProperty("runs");
  });

  /** ⚠ The row bound still travels: a clipped window must be SAYABLE on the
   *  surface, or a short month reads as a quiet one. */
  it("carries the read's truncation through", async () => {
    mockList.mockResolvedValue({ rows: [], truncated: true });
    expect(await readTokenSpend("user-1", "2026-08-06T00:00:00.000Z")).toEqual({
      marks: [],
      truncated: true,
    });
  });

  /** ⚠ `bigint` COLUMNS ARRIVE AS STRINGS through PostgREST, and a string in the
   *  renderer's sum is a concatenation. */
  it("reads a stringified count as a number", async () => {
    mockList.mockResolvedValue({
      rows: [{ started_at: "2026-09-06T03:30:00.000Z", tokens: "50000" }] as never,
      truncated: false,
    });
    expect((await readTokenSpend("user-1", "x")).marks[0].tokens).toBe(50_000);
  });
});
