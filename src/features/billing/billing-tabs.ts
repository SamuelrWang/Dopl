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
 * A `?billing=` intent WINS. Upgrade / success / return all mean the visitor
 * arrived MID-TRANSACTION (a 402 envelope, a checkout return, a portal return)
 * and the plan cards are what they were sent for. Only then does `?tab=`
 * decide; a bare visit opens on Usage — the question a member has.
 *
 * WHY THE INTENT OUTRANKS AN EXPLICIT `?tab=`, WHICH IS NOT THE OBVIOUS ORDER.
 * The pair is not a user preference against a hint — it is a URL that has been
 * EDITED after the fact. The shell writes `?tab=` on every tab click with
 * `replaceState`, so `?billing=success&tab=usage` is what a checkout return
 * becomes the moment someone glances at Usage, and reloading or sharing that
 * URL used to resolve to Usage — where the post-payment poll
 * (`plans-billing-core`, the ONLY consumer of `billing=success`) never mounts,
 * so a paying customer sits on a stale Starter plan with nothing scheduled to
 * correct it. Ordering the other way makes the money path the one that cannot
 * be lost to a stray param. The shell closes the pair from its side too: a
 * manual tab click DROPS `billing` from the URL, because that click is what
 * consumes the intent — so the two are never both present for long enough for
 * this precedence to override a live choice.
 */
export function resolveBillingTab(
  tabParam: string | null | undefined,
  hasBillingIntent: boolean
): BillingTab {
  if (hasBillingIntent) return "billing";
  if (tabParam === "usage" || tabParam === "billing") return tabParam;
  return "usage";
}
