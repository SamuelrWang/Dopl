/**
 * PRICES — the ONE place a dollar figure is written down, and the money
 * formatter every surface renders it through.
 *
 * ⚠ Must stay pure/framework-free: no React, no `"use client"`, no
 * `server-only`, no `next/*`. `plans.ts` (imported by RSC pages and the
 * `server-only` entitlements tree), `components/use-workspace-entitlements.ts`
 * (a client hook) and the desktop SPA all read it, and a module with a
 * directive on top cannot be imported by all three.
 *
 * 🔒 **THIS FILE EXISTS TO CLOSE F-672 (2026-09-08).** `TEAM_SEAT_PRICE` and
 * `SOLO_PRICE` used to live in `components/use-workspace-entitlements.ts` — a
 * `"use client"` React hook module — so `plans.ts` could not reach them and
 * wrote `priceMonthly: "$8.00"` as a STRING LITERAL instead. That literal is
 * quoted on the public pricing page: a price change edited in one of the two
 * places and not the other is PUBLIC PRICING MISREPRESENTATION that no test
 * could see, because a string is a string. Both halves import from here now,
 * `plans.ts` INTERPOLATES, and there is one number to change.
 *
 * ⚠ **DISPLAY PRICES, AND STRIPE IS THE AUTHORITY.** Nothing here touches a
 * Stripe price object; these are what the product SAYS. The live ids are env
 * (`STRIPE_PRO_SEAT_PRICE_ID`, `STRIPE_PERSONAL_PRO_PRICE_ID`,
 * `STRIPE_SOLO_PRICE_ID`, `STRIPE_LEGACY_SEAT_PRICE_ID`). Deploy state is a
 * measurement (CLAUDE.md): read the env, never this file, to answer "what does
 * a customer get charged".
 */

/**
 * **Pro — the PERSONAL paid tier, flat per month** (Samuel, 2026-09-08: "For
 * individual, 899"). Sold on a `kind='personal'` container only. Buys 5,000
 * credits a month on the personal wallet (`credits.ts ›
 * PERSONAL_MONTHLY_CREDITS`).
 */
export const PRO_PRICE = 8.99;

/**
 * **Team — per active seat, per month** (Samuel, 2026-09-08: "Team seats are
 * 799 … I think we should make it 899"). Seats sync with membership; each
 * member gets their own non-pooled 5,000 (`credits.ts › SEAT_MONTHLY_CREDITS`).
 *
 * ⚠ **DELIBERATELY THE SAME NUMBER AS `PRO_PRICE`, AND NOT AN ALIAS OF IT.**
 * "This will be for both individual and team" is a pricing decision that
 * happens to be one figure today; collapsing them into one constant would make
 * moving ONE of them a refactor instead of an edit.
 */
export const TEAM_SEAT_PRICE = 8.99;

/**
 * Solo/"Pro" — flat monthly, single-member STANDARD workspace. ⚠ **LEGACY
 * LABEL ONLY** since 2026-09-07: nothing sells this plan, and the constant
 * exists to say what a workspace already on it pays. ⚠ Not to be confused with
 * `PRO_PRICE`: `solo` is a retired standard-workspace plan, `pro` is the live
 * personal one.
 */
export const SOLO_PRICE = 5.99;

/** `$8.99`, `$23.97` — money in COPY. Two decimals always, no `.00` stripping:
 *  a price list where one row has cents and another does not reads as a typo. */
export function formatMoney(amount: number): string {
  return `$${amount.toFixed(2)}`;
}
