/**
 * Invariant suite — MCP credit constants and the two period rules: the
 * per-member seat allowance, the personal wallet allowance, and which window
 * each wallet is charged to.
 *
 * 2026-09-07: rewritten for the per-seat + personal-wallet ruling (the pooled
 * `MONTHLY_MCP_CREDITS` map and its flat-team case went with it).
 * 2026-09-08: extended for the personal Pro tier — two cases were inverted
 * rather than added beside their predecessors, because a suite keeping both
 * spellings of a superseded rule is green under either.
 */

import { describe, it, expect } from "vitest";
import {
  CREDITS_PER_MCP_CALL,
  PERSONAL_MONTHLY_CREDITS,
  SEAT_MONTHLY_CREDITS,
  personalCreditPeriod,
  personalCreditsForPlan,
  resolveCreditPeriod,
  seatCreditsForPlan,
} from "./credits";

const NOW = new Date("2026-08-11T12:00:00.000Z");

describe("allowances", () => {
  it("charges one credit per MCP tool call", () => {
    expect(CREDITS_PER_MCP_CALL).toBe(1);
  });

  it("pins the PER-MEMBER seat allowance (Samuel, 2026-09-07: 100 free / 5,000 paid)", () => {
    expect(SEAT_MONTHLY_CREDITS).toEqual({
      free: 100,
      solo: 5_000,
      team: 5_000,
      pro: 5_000,
    });
  });

  it("🔒 carries a `pro` key that NO seat ever reads — it is there for the Record type", () => {
    // `pro` is sold only on a `kind='personal'` container, which has no seats.
    // The key exists so `Record<PlanId, number>` stays exhaustive and the next
    // plan id is a compile error rather than a silent `undefined`; the credits
    // service never routes a seat burn through it
    // (`server/credits-service.test.ts`).
    expect(SEAT_MONTHLY_CREDITS.pro).toBe(5_000);
    expect(Object.keys(SEAT_MONTHLY_CREDITS).sort()).toEqual([
      "free",
      "pro",
      "solo",
      "team",
    ]);
  });

  it("resolves a per-member allowance per plan id", () => {
    expect(seatCreditsForPlan("free")).toBe(100);
    expect(seatCreditsForPlan("team")).toBe(5_000);
  });

  it("🔒 legacy SOLO takes the PAID figure, not the free one", () => {
    // Retired from sale, still live on real rows: a legacy payer's members are
    // entitled to what paid members get, and falling back to free would quietly
    // cut a paying workspace's allowance by 98%.
    expect(seatCreditsForPlan("solo")).toBe(SEAT_MONTHLY_CREDITS.team);
  });

  it("🔒 the paid allowance is PER MEMBER, so Team is NOT a workspace-wide pool", () => {
    // Revert detector for the pooled model: under `MONTHLY_MCP_CREDITS` Team was
    // 25,000 workspace-wide, where this figure is what each member gets and
    // nothing divides by a seat count.
    expect(SEAT_MONTHLY_CREDITS.team).toBe(5_000);
    expect(seatCreditsForPlan("team")).toBe(SEAT_MONTHLY_CREDITS.team);
  });

  it("pins the PERSONAL wallet allowance — TWO tiers (Samuel, 2026-09-08: 500 free / 5,000 Pro)", () => {
    expect(PERSONAL_MONTHLY_CREDITS).toEqual({ free: 500, pro: 5_000 });
  });

  it("🔒 the personal allowance IS a plan lookup now — the home space has a plan", () => {
    // Revert detector for the one-tier model: the superseded case asserted
    // `typeof PERSONAL_MONTHLY_CREDITS === "number"`, true until the personal
    // tier was priced. A revert to the bare constant fails this and every
    // `.free`/`.pro` read in the tree.
    expect(typeof PERSONAL_MONTHLY_CREDITS).toBe("object");
    expect(Object.keys(PERSONAL_MONTHLY_CREDITS).sort()).toEqual(["free", "pro"]);
  });

  it("🔒 free PERSONAL (500) is NOT free SEAT (100) — different things, different numbers", () => {
    // A free seat is one of many inside somebody's workspace; a free personal
    // wallet is a person's entire home space. Collapsing them cuts every
    // existing user's allowance by 80%.
    expect(PERSONAL_MONTHLY_CREDITS.free).toBe(500);
    expect(PERSONAL_MONTHLY_CREDITS.free).not.toBe(SEAT_MONTHLY_CREDITS.free);
  });

  it("🔒 Pro buys the SAME 5,000 a paid seat gets (Samuel: \"team individual is also 5,000\")", () => {
    expect(PERSONAL_MONTHLY_CREDITS.pro).toBe(SEAT_MONTHLY_CREDITS.team);
  });
});

/**
 * The personal limit is a verdict lookup and anything but `pro` is free. The
 * verdict comes from `server/entitlements.ts › entitledPlanFor`, so a canceled
 * Pro row arrives as `free` and gets the free allowance.
 */
describe("personalCreditsForPlan", () => {
  it("gives a `pro` verdict 5,000 and a `free` verdict 500", () => {
    expect(personalCreditsForPlan("pro")).toBe(5_000);
    expect(personalCreditsForPlan("free")).toBe(500);
  });

  it("🔒 answers FREE for a workspace plan that cannot be on a personal container", () => {
    // The safe direction: `team` and `solo` cannot be the verdict here, and if a
    // bad row produced one, reading it as paid would hand a free home space
    // credits nobody bought — which a taxonomy-wide lookup would do.
    expect(personalCreditsForPlan("team")).toBe(PERSONAL_MONTHLY_CREDITS.free);
    expect(personalCreditsForPlan("solo")).toBe(PERSONAL_MONTHLY_CREDITS.free);
  });

  it("reads the map, so retuning the map retunes the answer", () => {
    expect(personalCreditsForPlan("pro")).toBe(PERSONAL_MONTHLY_CREDITS.pro);
    expect(personalCreditsForPlan("free")).toBe(PERSONAL_MONTHLY_CREDITS.free);
  });
});

/**
 * The personal wallet's window — the UTC calendar month, with no subscription to
 * anchor to.
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

  it("🔒 STILL takes no anchor — the Pro window grew `resolveCreditPeriod`, not a copy of it", () => {
    // Since 2026-09-08 the personal paid tier goes through
    // `resolveCreditPeriod`'s anchor branch
    // (`server/personal-wallet.ts › personalWalletTier`), so this function stays
    // clock-only — the free / no-row arm. A second anchor branch here is the
    // regression.
    expect(personalCreditPeriod.length).toBe(0);
  });
});

/** Live future anchor — the shape a mid-period cancellation leaves behind. */
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

  it("anchors a PERSONAL `pro` subscription the same way (2026-09-08)", () => {
    // The personal wallet is not special-cased: its window is this same
    // function, so a Pro home space rolls on its Stripe date and not on the 1st
    // — otherwise the payer gets a second month's allowance early, every month.
    expect(resolveCreditPeriod(LIVE_ANCHOR, "pro", NOW)).toEqual({
      periodStart: "2026-07-21T09:30:00.000Z",
      periodEnd: "2026-08-21T09:30:00.000Z",
    });
  });
});

/**
 * Cancellation lockout, pinned at the rule that heals it: a mid-period cancel
 * leaves a future-ending anchor, and honouring it would charge the first
 * free-plan call to a period key the paid plan already spent. Reading the
 * verdict first heals it on next consume, no webhook.
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
