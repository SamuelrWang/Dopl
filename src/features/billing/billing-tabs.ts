/**
 * Which half of the billing page a URL opens on.
 *
 * Both tabs sit behind ONE route (`[segment]` = WORKSPACE segment); a second
 * path level would mean re-deriving every `./url.ts` helper, the `upgrade_url`
 * envelopes in the wild, and the desktop's hand-copied deep-link table. Hence
 * a `?tab=` query param.
 *
 * ⚠ Kept OUT of `./url.ts` — that is the money-URL builder (Stripe
 * `return_url`, 402 envelopes); `?tab=` is part of none of them.
 *
 * ⚠ Must stay pure — no React, no `next/*`, no `server-only`: RSC page resolves
 * first paint, client shell holds it as state after.
 */

export type BillingTab = "usage" | "billing";

/**
 * `?billing=` intent WINS; then `?tab=`; bare visit opens Usage.
 *
 * ⚠ Intent outranking explicit `?tab=` is not obvious — do not flip it. Shell
 * writes `?tab=` on every tab click via `replaceState`, so a checkout return
 * becomes `?billing=success&tab=usage` the moment someone glances at Usage;
 * resolving that to Usage never mounts the post-payment poll
 * (`plans-billing-core`, only consumer of `billing=success`), stranding a payer
 * on a stale plan. Shell DROPS `billing` on manual tab click, so the pair never
 * coexists long enough to override a live choice.
 */
export function resolveBillingTab(
  tabParam: string | null | undefined,
  hasBillingIntent: boolean
): BillingTab {
  if (hasBillingIntent) return "billing";
  if (tabParam === "usage" || tabParam === "billing") return tabParam;
  return "usage";
}
