/**
 * Prices — the one place a dollar figure is written down, plus the money
 * formatter every surface renders it through. Exists to close F-672
 * (2026-09-08): the constants used to live in a `"use client"` hook module
 * `plans.ts` could not import, so it hard-coded `"$8.00"`, and a price edited
 * in one place and not the other is public pricing misrepresentation no test
 * can see.
 *
 * Must stay pure/framework-free: no React, no `"use client"`, no `server-only`,
 * no `next/*` — RSC pages, the `server-only` entitlements tree, a client hook
 * and the desktop SPA all read it, and a directive would block one of them.
 *
 * Display prices only; Stripe is the authority. The live ids are env
 * (`STRIPE_PRO_SEAT_PRICE_ID`, `STRIPE_PERSONAL_PRO_PRICE_ID`,
 * `STRIPE_PERSONAL_MAX_PRICE_ID`, `STRIPE_SOLO_PRICE_ID`,
 * `STRIPE_LEGACY_SEAT_PRICE_ID`) — read the env, never this file, to answer
 * what a customer is actually charged.
 */

/**
 * Pro — the personal paid tier, flat per month (2026-09-08). Sold on a
 * `kind='home'` container only; buys the personal wallet's paid allowance
 * (`credits.ts › PERSONAL_MONTHLY_CREDITS`).
 */
export const PRO_PRICE = 8.99;

/**
 * Max — the second personal paid tier, flat per month (2026-10-22, Samuel's
 * "third tier at $24.99"). Same container rules as Pro (`kind='home'` only),
 * a bigger allowance (`credits.ts › PERSONAL_MONTHLY_CREDITS`).
 */
export const MAX_PRICE = 24.99;

/** The flat monthly price of each personal paid tier — the one lookup a
 *  surface that renders "the plan in front of it" reads, so a third personal
 *  tier is one row here rather than another ternary at every call site. */
export const PERSONAL_PLAN_PRICES = {
  pro: PRO_PRICE,
  max: MAX_PRICE,
} as const satisfies Record<"pro" | "max", number>;

/**
 * Team — per active seat, per month (2026-09-08). Seats sync with membership;
 * each member gets their own non-pooled allowance (`credits.ts ›
 * SEAT_MONTHLY_CREDITS`). Deliberately the same number as `PRO_PRICE` and not
 * an alias of it: collapsing them would make moving one a refactor.
 */
export const TEAM_SEAT_PRICE = 8.99;

/**
 * Solo/"Pro" — flat monthly, single-member standard workspace. Legacy since
 * 2026-09-07: nothing sells it, and the constant says what a workspace already
 * on it pays. Not `PRO_PRICE` — that is the live personal plan.
 */
export const SOLO_PRICE = 5.99;

/**
 * LAUNCH PRICING — the "50% off" badge and the struck-through "was" price on the
 * personal paid cards (2026-10-22, Samuel: "a 50% off badge for Pro and for
 * Power … show the full price crossed out and show the current price").
 *
 * ⚠ **THE END DATE AND THE "WAS" PRICES ARE SAMUEL'S CALL, NOT ENGINEERING'S.**
 * A struck-through reference price is a legal claim (FTC 16 CFR 233.1, and the
 * stricter state rules): it must be a price the plan is genuinely offered at
 * outside the promotion, and the promotion must genuinely end. So the offer is
 * BOUNDED — `launchOfferFor` returns `null` after `LAUNCH_PRICE_ENDS` and every
 * surface drops the badge and the strike on its own — and both inputs live here
 * and nowhere else. Moving the date or a "was" price is a one-line edit; do not
 * restate either figure in copy.
 *
 * `LAUNCH_PRICE_ENDS` is the LAST DAY of the offer, inclusive, in UTC.
 */
export const LAUNCH_PRICE_ENDS = "2026-12-31";

/** "Was" prices, by personal plan. A plan absent here has no offer. */
export const LAUNCH_COMPARE_PRICES: Partial<Record<"pro" | "max", number>> = {
  pro: 17.98,
  max: 49.98,
};

export interface LaunchOffer {
  /** The struck-through reference price. */
  wasPrice: number;
  /** Rounded whole percent off the reference, e.g. `50`. Derived, never typed,
   *  so the badge cannot disagree with the two prices beside it. */
  percentOff: number;
}

/** First instant AFTER the offer — midnight UTC the day after the last day. */
function launchEndsAtMs(): number {
  const lastDay = Date.parse(`${LAUNCH_PRICE_ENDS}T00:00:00Z`);
  return Number.isNaN(lastDay) ? 0 : lastDay + 24 * 60 * 60 * 1000;
}

/**
 * The live launch offer for a plan, or `null` (no offer, offer over, or a "was"
 * price that is not above the real one — a 0% or negative "discount" must never
 * render). Called at RENDER, never at module load: a long-lived server process
 * would otherwise keep the badge up past the end date until its next restart.
 * An unparseable end date fails CLOSED (no badge).
 */
export function launchOfferFor(
  planId: string,
  now: Date = new Date()
): LaunchOffer | null {
  if (planId !== "pro" && planId !== "max") return null;
  const wasPrice = LAUNCH_COMPARE_PRICES[planId];
  const price = PERSONAL_PLAN_PRICES[planId];
  if (wasPrice === undefined || !(wasPrice > price)) return null;
  if (now.getTime() >= launchEndsAtMs()) return null;
  return { wasPrice, percentOff: Math.round((1 - price / wasPrice) * 100) };
}

/** `$8.99`, `$23.97` — money in copy. Two decimals always, no `.00` stripping:
 *  a price list where one row has cents and another does not reads as a typo. */
export function formatMoney(amount: number): string {
  return `$${amount.toFixed(2)}`;
}
