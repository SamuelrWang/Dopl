/**
 * What the checkout form says it is selling. `describeOrder` is the only
 * assertable part of this module — everything else needs a live Stripe session
 * and the `@stripe/react-stripe-js` provider — and it holds the plan's own name,
 * which was the constant `"Team"` until 2026-09-08, so a `pro` session would
 * have rendered a Pro price under a Team heading.
 */

import { describe, expect, it } from "vitest";
import { describeOrder } from "./embedded-checkout";

/** The three fields `describeOrder` reads off a Stripe checkout session. */
function session(unitAmount: string, quantity: number, total: string) {
  return {
    lineItems: [
      { quantity, unitAmount: { amount: unitAmount }, recurring: { interval: "month" } },
    ],
    total: { total: { amount: total } },
  } as unknown as Parameters<typeof describeOrder>[0];
}

describe("the order line above the card form", () => {
  it("names Team and does the seat math", () => {
    const order = describeOrder(session("$8.99", 4, "$35.96"), "team");
    expect(order.planName).toBe("Team");
    expect(order.summaryDetail).toBe("4 seats × $8.99 / month");
    expect(order.totalLabel).toBe("$35.96 / month");
  });

  it("names Pro and does NOT invent a seat", () => {
    // `pro` is a flat quantity-1 subscription (`server/stripe.ts`), so
    // "1 seat × $8.99" would name a unit the home space does not have.
    const order = describeOrder(session("$8.99", 1, "$8.99"), "pro");
    expect(order.planName).toBe("Pro");
    expect(order.summaryDetail).toBe("Billed monthly");
    expect(order.totalLabel).toBe("$8.99 / month");
  });

  it("takes every figure from the session, never from a price constant", () => {
    // Stripe's own pre-formatted, localized strings — a coupon, a proration or a
    // currency this app does not know about must still print correctly.
    const order = describeOrder(session("€7,50", 2, "€15,00"), "team");
    expect(order.summaryDetail).toBe("2 seats × €7,50 / month");
    expect(order.totalLabel).toBe("€15,00 / month");
  });
});
