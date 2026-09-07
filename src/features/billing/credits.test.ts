/**
 * INVARIANT SUITE — MCP credit constants + the TWO period rules. `credits.ts` is
 * the ONE retune spot; pinned here are the PER-MEMBER seat allowance, the
 * PERSONAL wallet allowance, and WHICH WINDOW each wallet is charged to.
 *
 * ⚠ **REWRITTEN 2026-09-07 for Samuel's per-seat + personal-wallet ruling.** It
 * used to pin `MONTHLY_MCP_CREDITS` — one POOLED allowance per workspace
 * (free 500 / solo 10,000 / team 25,000 workspace-wide) — and a case asserting
 * that team was FLAT and deliberately not a multiple of solo. Both are gone
 * with the map: the allowance is per MEMBER now and multiplies by the roster.
 */

import { describe, it, expect } from "vitest";
import {
  CREDITS_PER_MCP_CALL,
  PERSONAL_MONTHLY_CREDITS,
  SEAT_MONTHLY_CREDITS,
  personalCreditPeriod,
  resolveCreditPeriod,
  seatCreditsForPlan,
} from "./credits";

const NOW = new Date("2026-08-11T12:00:00.000Z");

describe("allowances", () => {
  it("charges one credit per MCP tool call", () => {
    expect(CREDITS_PER_MCP_CALL).toBe(1);
  });

  it("pins the PER-MEMBER seat allowance (Samuel, 2026-09-07: 100 free / 5,000 paid)", () => {
    expect(SEAT_MONTHLY_CREDITS).toEqual({ free: 100, solo: 5_000, team: 5_000 });
  });

  it("resolves a per-member allowance per plan id", () => {
    expect(seatCreditsForPlan("free")).toBe(100);
    expect(seatCreditsForPlan("team")).toBe(5_000);
  });

  it("🔒 legacy SOLO takes the PAID figure, not the free one", () => {
    // Retired from sale, still live on real rows. A legacy payer's members are
    // entitled to what paid members get; falling back to free would quietly cut
    // a paying workspace's allowance by 98%.
    expect(seatCreditsForPlan("solo")).toBe(SEAT_MONTHLY_CREDITS.team);
  });

  it("🔒 the paid allowance is PER MEMBER, so Team is NOT a workspace-wide pool", () => {
    // ⚠ THE REVERT DETECTOR FOR THE POOLED MODEL. Under `MONTHLY_MCP_CREDITS`
    // Team was 25,000 for the whole workspace however many people were in it;
    // this figure is what EACH member gets, and nothing here divides by a seat
    // count. A revert to a pooled map fails this and the map assertion above.
    expect(SEAT_MONTHLY_CREDITS.team).toBe(5_000);
    expect(seatCreditsForPlan("team")).toBe(SEAT_MONTHLY_CREDITS.team);
  });

  it("pins the PERSONAL wallet allowance — one tier this wave", () => {
    expect(PERSONAL_MONTHLY_CREDITS).toBe(500);
  });

  it("🔒 the personal allowance is NOT a plan lookup — the home space has no plan", () => {
    // It is a bare constant on purpose (A5): Samuel gave workspace figures and
    // no personal one, so this holds the status-quo free allowance rather than
    // inventing a price. A map here would imply a tier that cannot be bought.
    expect(typeof PERSONAL_MONTHLY_CREDITS).toBe("number");
    expect(PERSONAL_MONTHLY_CREDITS).not.toBe(SEAT_MONTHLY_CREDITS.free);
  });
});

/**
 * THE PERSONAL WALLET'S WINDOW — always the UTC calendar month, because a
 * personal wallet has no subscription to anchor to.
 */
describe("personalCreditPeriod", () => {
  it("is the UTC calendar month containing `now`", () => {
    expect(personalCreditPeriod(NOW)).toEqual({
      periodStart: "2026-08-01T00:00:00.000Z",
      periodEnd: "2026-09-01T00:00:00.000Z",
    });
  });

  it("rolls the year at a December boundary", () => {
    expect(personalCreditPeriod(new Date("2026-12-31T23:59:59.000Z"))).toEqual({
      periodStart: "2026-12-01T00:00:00.000Z",
      periodEnd: "2027-01-01T00:00:00.000Z",
    });
  });

  it("is UTC, not local — a late-UTC-month instant does not roll early", () => {
    expect(personalCreditPeriod(new Date("2026-08-31T23:30:00.000Z"))).toEqual({
      periodStart: "2026-08-01T00:00:00.000Z",
      periodEnd: "2026-09-01T00:00:00.000Z",
    });
  });

  it("🔒 is the SAME window a free-verdict seat gets — one month boundary, not two", () => {
    // Two spellings of "the calendar month" is how the meter and the counter
    // come to disagree about which key a burn landed on.
    expect(personalCreditPeriod(NOW)).toEqual(
      resolveCreditPeriod(
        { currentPeriodStart: null, currentPeriodEnd: null },
        "free",
        NOW
      )
    );
  });

  it("🔒 IGNORES a subscription anchor because it takes none — no anchor branch exists", () => {
    // `personalCreditPeriod` accepts only a clock. If a future personal PAID
    // tier lands, it grows `resolveCreditPeriod`'s anchor branch rather than a
    // second copy of it (`credits.ts`).
    expect(personalCreditPeriod.length).toBe(0);
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
