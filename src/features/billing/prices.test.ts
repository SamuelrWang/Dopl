/**
 * Prices + the launch offer (2026-10-22). The offer is a LEGAL claim — a
 * struck-through reference price — so it must be bounded: it renders only while
 * `LAUNCH_PRICE_ENDS` has not passed, only for a plan with a "was" price ABOVE
 * its real one, and the percent is derived, never typed.
 */

import { describe, it, expect } from "vitest";
import {
  LAUNCH_COMPARE_PRICES,
  LAUNCH_PRICE_ENDS,
  MAX_PRICE,
  PERSONAL_PLAN_PRICES,
  PRO_PRICE,
  launchOfferFor,
} from "./prices";
import { MAX_PLAN_NAME, PERSONAL_PLANS, PERSONAL_PAID_PLANS } from "./plans";
import { PERSONAL_MONTHLY_CREDITS } from "./credits";

const DURING = new Date("2026-10-22T12:00:00.000Z");
const LAST_DAY_LATE = new Date(`${LAUNCH_PRICE_ENDS}T23:59:59.000Z`);
const DAY_AFTER = new Date(
  Date.parse(`${LAUNCH_PRICE_ENDS}T00:00:00.000Z`) + 24 * 60 * 60 * 1000
);

describe("the personal prices", () => {
  it("pins Max at $24.99 and Pro at $8.99 (Samuel)", () => {
    expect(MAX_PRICE).toBe(24.99);
    expect(PRO_PRICE).toBe(8.99);
    expect(PERSONAL_PLAN_PRICES).toEqual({ pro: 8.99, max: 24.99 });
  });
});

describe("launchOfferFor", () => {
  it("offers 50% off Pro ($17.98 → $8.99) and Max ($49.98 → $24.99) during the launch", () => {
    expect(launchOfferFor("pro", DURING)).toEqual({ wasPrice: 17.98, percentOff: 50 });
    expect(launchOfferFor("max", DURING)).toEqual({ wasPrice: 49.98, percentOff: 50 });
  });

  it("is still live on the LAST day, through 23:59:59 UTC", () => {
    expect(launchOfferFor("max", LAST_DAY_LATE)).not.toBeNull();
  });

  it("🔒 AUTO-HIDES the day after the end date — no badge, no strike", () => {
    expect(launchOfferFor("pro", DAY_AFTER)).toBeNull();
    expect(launchOfferFor("max", DAY_AFTER)).toBeNull();
  });

  it("offers nothing on a plan with no reference price", () => {
    for (const plan of ["free", "team", "solo", "enterprise"]) {
      expect(launchOfferFor(plan, DURING)).toBeNull();
    }
  });

  it("🔒 every reference price is ABOVE the real one — a 0% or negative discount cannot render", () => {
    for (const plan of PERSONAL_PAID_PLANS) {
      const was = LAUNCH_COMPARE_PRICES[plan];
      if (was !== undefined) expect(was).toBeGreaterThan(PERSONAL_PLAN_PRICES[plan]);
    }
  });

  it("defaults `now` to the real clock", () => {
    const offer = launchOfferFor("pro");
    expect(offer === null || offer.percentOff === 50).toBe(true);
  });
});

describe("the Max card", () => {
  const card = PERSONAL_PLANS.find((p) => p.id === "max");

  it("is the third personal card, cheapest first, named from ONE constant", () => {
    expect(PERSONAL_PLANS.map((p) => p.id)).toEqual(["free", "pro", "max"]);
    expect(card?.name).toBe(MAX_PLAN_NAME);
  });

  it("interpolates its price and allowance — no restated figure can drift", () => {
    expect(card?.priceMonthly).toBe("$24.99");
    expect(card?.priceNote).toBe("/ month");
    expect(card?.features).toContain(
      `${PERSONAL_MONTHLY_CREDITS.max.toLocaleString("en-US")} credits / month`
    );
    expect(card?.features).toContain("20,000 credits / month");
  });
});
