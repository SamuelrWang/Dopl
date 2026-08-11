/**
 * WHICH HALF OF THE BILLING PAGE A URL OPENS ON.
 *
 * `/billing/[segment]` carries two tabs — Usage and Billing — behind ONE route,
 * because `[segment]` is the WORKSPACE segment and a second path level would
 * mean re-deriving every helper in `./url.ts`, the `upgrade_url` envelopes
 * already in the wild, and the desktop's hand-copied deep-link table. The tab
 * is therefore a `?tab=` query param.
 *
 * NOT IN `./url.ts` DELIBERATELY. That module is the money-URL BUILDER — every
 * Stripe `return_url` and 402 envelope resolves through it, and `?tab=` is not
 * part of any of them. This is the read side of one optional param, and it
 * lives apart so nothing here can change what a `return_url` looks like.
 *
 * Pure — no React, no `next/*`, no `server-only`: the RSC page resolves the tab
 * for the first paint and the client shell holds it as state from there.
 */

export type BillingTab = "usage" | "billing";

/**
 * `?tab=` wins when it names a tab. Otherwise a `?billing=` intent decides:
 * upgrade / success / return all mean the visitor arrived MID-TRANSACTION (a
 * 402 envelope, a checkout return, a portal return) and the plan cards are what
 * they were sent for. A bare visit opens on Usage — the question a member has.
 */
export function resolveBillingTab(
  tabParam: string | null | undefined,
  hasBillingIntent: boolean
): BillingTab {
  if (tabParam === "usage" || tabParam === "billing") return tabParam;
  return hasBillingIntent ? "billing" : "usage";
}
