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
 * `STRIPE_SOLO_PRICE_ID`, `STRIPE_LEGACY_SEAT_PRICE_ID`) — read the env, never
 * this file, to answer what a customer is actually charged.
 */

/**
 * Pro — the personal paid tier, flat per month (2026-09-08). Sold on a
 * `kind='home'` container only; buys the personal wallet's paid allowance
 * (`credits.ts › PERSONAL_MONTHLY_CREDITS`).
 */
export const PRO_PRICE = 8.99;

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

/** `$8.99`, `$23.97` — money in copy. Two decimals always, no `.00` stripping:
 *  a price list where one row has cents and another does not reads as a typo. */
export function formatMoney(amount: number): string {
  return `$${amount.toFixed(2)}`;
}
