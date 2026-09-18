/**
 * Which half of the billing page a URL opens on. Both tabs sit behind one route
 * (`[segment]`), so this is a `?tab=` query param: a second path level would
 * mean re-deriving every `./url.ts` helper, the `upgrade_url` envelopes in the
 * wild and the desktop's deep-link table. Kept out of `./url.ts`, which builds
 * money URLs only.
 *
 * Must stay pure — no React, no `next/*`, no `server-only`: the RSC page
 * resolves first paint, the client shell holds it as state after.
 */

export type BillingTab = "usage" | "billing";

/**
 * `?billing=` intent wins; then `?tab=`; a bare visit opens Usage.
 *
 * Intent outranking an explicit `?tab=` is deliberate — do not flip it. The
 * shell writes `?tab=` on every tab click via `replaceState`, so a checkout
 * return becomes `?billing=success&tab=usage` the moment someone glances at
 * Usage; resolving that to Usage never mounts the post-payment poll
 * (`plans-billing-core`, the only consumer of `billing=success`), stranding a
 * payer on a stale plan. The shell drops `billing` on a manual tab click, so
 * the pair never coexists long enough to override a live choice.
 */
export function resolveBillingTab(
  tabParam: string | null | undefined,
  hasBillingIntent: boolean
): BillingTab {
  if (hasBillingIntent) return "billing";
  if (tabParam === "usage" || tabParam === "billing") return tabParam;
  return "usage";
}
