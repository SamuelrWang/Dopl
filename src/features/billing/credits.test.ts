/**
 * INVARIANT SUITE — MCP credit constants + period rule. `credits.ts` is the ONE
 * retune spot; pinned here are the per-plan allowance map and WHICH WINDOW a
 * call is charged to.
 */

import { describe, it, expect } from "vitest";
import {
  CREDITS_PER_MCP_CALL,
  MONTHLY_MCP_CREDITS,
  monthlyCreditsForPlan,
  resolveCreditPeriod,
} from "./credits";

const NOW = new Date("2026-08-11T12:00:00.000Z");

describe("allowances", () => {
  it("charges one credit per MCP tool call", () => {
    expect(CREDITS_PER_MCP_CALL).toBe(1);
  });

  it("pins the per-plan monthly allowance", () => {
    expect(MONTHLY_MCP_CREDITS).toEqual({ free: 500, solo: 10_000, team: 25_000 });
  });

  it("resolves an allowance per plan id", () => {
    expect(monthlyCreditsForPlan("free")).toBe(500);
    expect(monthlyCreditsForPlan("solo")).toBe(10_000);
    expect(monthlyCreditsForPlan("team")).toBe(25_000);
  });

  it("team is FLAT per workspace, not per seat — it is not a multiple of solo", () => {
    // Guards the pricing DECISION: per-seat team is not expressible here.
    expect(MONTHLY_MCP_CREDITS.team).toBeGreaterThan(MONTHLY_MCP_CREDITS.solo);
  });
});

/** Live future anchor — shape a mid-period cancellation leaves behind. */
const LIVE_ANCHOR = {
  currentPeriodStart: "2026-07-21T09:30:00.000Z",
  currentPeriodEnd: "2026-08-21T09:30:00.000Z",
};

const CALENDAR = {
  periodStart: "2026-08-01T00:00:00.000Z",
  periodEnd: "2026-09-01T00:00:00.000Z",
};

describe("resolveCreditPeriod — subscription anchor", () => {
  it("uses the stamped subscription window when the end is still in the future", () => {
    expect(resolveCreditPeriod(LIVE_ANCHOR, "team", NOW)).toEqual({
      periodStart: "2026-07-21T09:30:00.000Z",
      periodEnd: "2026-08-21T09:30:00.000Z",
    });
  });

  it("anchors a solo subscription the same way", () => {
    expect(resolveCreditPeriod(LIVE_ANCHOR, "solo", NOW)).toEqual({
      periodStart: "2026-07-21T09:30:00.000Z",
      periodEnd: "2026-08-21T09:30:00.000Z",
    });
  });
});

/**
 * Cancellation lockout, pinned at the rule that heals it. A mid-period cancel
 * leaves a future-ending anchor; honouring it would charge the first free-plan
 * call to the period key the paid plan already spent past 500. Verdict read
 * FIRST heals it on next consume, no webhook.
 */
describe("resolveCreditPeriod — a FREE verdict ignores the anchor", () => {
  it("uses the calendar month even when a live future anchor is stamped", () => {
    expect(resolveCreditPeriod(LIVE_ANCHOR, "free", NOW)).toEqual(CALENDAR);
  });

  it("ignores an anchor whose window has barely started (worst case for lockout)", () => {
    expect(
      resolveCreditPeriod(
        {
          currentPeriodStart: "2026-08-10T00:00:00.000Z",
          currentPeriodEnd: "2026-09-10T00:00:00.000Z",
        },
        "free",
        NOW
      )
    ).toEqual(CALENDAR);
  });

  it("is the SAME window a never-subscribed free workspace gets — one key, not two", () => {
    expect(resolveCreditPeriod(LIVE_ANCHOR, "free", NOW)).toEqual(
      resolveCreditPeriod(
        { currentPeriodStart: null, currentPeriodEnd: null },
        "free",
        NOW
      )
    );
  });
});

describe("resolveCreditPeriod — UTC calendar-month fallback", () => {
  it("falls back when the workspace has no billing row at all", () => {
    expect(
      resolveCreditPeriod(
        { currentPeriodStart: null, currentPeriodEnd: null },
        "free",
        NOW
      )
    ).toEqual(CALENDAR);
  });

  it("falls back when only the END is stamped (pre-credits rows)", () => {
    expect(
      resolveCreditPeriod(
        { currentPeriodStart: null, currentPeriodEnd: "2026-08-21T00:00:00.000Z" },
        "team",
        NOW
      )
    ).toEqual(CALENDAR);
  });

  it("falls back on a LAPSED window — a stale anchor would never roll", () => {
    expect(
      resolveCreditPeriod(
        {
          currentPeriodStart: "2026-05-01T00:00:00.000Z",
          currentPeriodEnd: "2026-06-01T00:00:00.000Z",
        },
        "team",
        NOW
      )
    ).toEqual(CALENDAR);
  });

  it("falls back on an unparseable stamp rather than producing Invalid Date", () => {
    expect(
      resolveCreditPeriod(
        { currentPeriodStart: "not-a-date", currentPeriodEnd: "also-not" },
        "team",
        NOW
      )
    ).toEqual(CALENDAR);
  });

  it("rolls the year at a December boundary", () => {
    expect(
      resolveCreditPeriod(
        { currentPeriodStart: null, currentPeriodEnd: null },
        "free",
        new Date("2026-12-31T23:59:59.000Z")
      )
    ).toEqual({
      periodStart: "2026-12-01T00:00:00.000Z",
      periodEnd: "2027-01-01T00:00:00.000Z",
    });
  });

  it("is UTC, not local — a late-UTC-month instant does not roll early", () => {
    expect(
      resolveCreditPeriod(
        { currentPeriodStart: null, currentPeriodEnd: null },
        "free",
        new Date("2026-08-31T23:30:00.000Z")
      )
    ).toEqual(CALENDAR);
  });
});
