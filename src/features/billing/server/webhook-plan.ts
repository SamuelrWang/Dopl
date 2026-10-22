import "server-only";
import type Stripe from "stripe";
import { findWorkspaceById } from "@/features/workspaces/server/repository";
import {
  isStandardWorkspace,
  type WorkspaceKind,
} from "@/features/workspaces/types";
import { isPersonalPaidPlan, type PlanId } from "../plans";
import {
  getLegacySeatPriceId,
  getPersonalMaxPriceId,
  getPersonalProPriceId,
  getSeatPriceId,
  getSoloPriceId,
} from "./stripe";

/**
 * Which PLAN a Stripe subscription is, and whether the container it lands on
 * can hold that plan. Split out of `webhook-handler.ts` on 2026-09-08 (spec
 * §11) because the second question is new, needs a workspace read the handler
 * otherwise has no reason to make, and the pair together was pushing that file
 * over the 500-line cap (INVARIANTS §1).
 */

/**
 * Item price is authoritative; inconclusive (unknown price, or the price envs
 * unset in this environment) falls back to subscription metadata, then `team`.
 *
 * The arms, in the order they are asked:
 *   • CURRENT per-seat Team price, or the LEGACY $7.99 seat price → `team`: a
 *     legacy seat sub is a Team sub, its price moved and its plan did not.
 *   • Personal Max price → `max` (2026-10-22), then personal Pro → `pro`
 *     (2026-09-08). Max is asked first only because a sub mid-swap could in
 *     principle carry both lines, and the bigger tier is the one being sold.
 *   • Flat Solo price → `solo`. Legacy-only (2026-09-07, spec A6), but every
 *     live Solo sub still sends events here and dropping the arm would re-plan a
 *     paying Solo workspace as Team on its next invoice event.
 *
 * The `team` default is deliberately not `pro`: every unstamped unknown-price
 * subscription that can reach it predates `pro`.
 *
 * 🔒 **`max` IS NEVER GRANTED BY METADATA ALONE WHILE ITS PRICE ENV IS SET
 * (2026-10-22).** Metadata is a fallback for an environment that cannot tell —
 * the price envs unset. Where `STRIPE_PERSONAL_MAX_PRICE_ID` IS set and the item
 * price is not it, a `plan: "max"` stamp is stale or hand-edited (a Max → Pro
 * schedule phase that lost its metadata, a dashboard edit), and honouring it
 * would hand the 20,000 allowance to a subscription Stripe bills at another
 * price. Such a sub falls through to the `team` default, which
 * `reportPlanContainerMismatch` logs on a home space and which entitles a home
 * space's wallet to nothing more than the free figure
 * (`credits.ts › personalCreditsForPlan`).
 */
export function derivePlan(subscription: Stripe.Subscription): PlanId {
  const priceIds = (subscription.items?.data ?? [])
    .map((item) => item.price?.id)
    .filter((id): id is string => Boolean(id));
  const has = (priceId: string | null) => !!priceId && priceIds.includes(priceId);

  if (has(getSeatPriceId()) || has(getLegacySeatPriceId())) return "team";
  if (has(getPersonalMaxPriceId())) return "max";
  if (has(getPersonalProPriceId())) return "pro";
  if (has(getSoloPriceId())) return "solo";

  const metaPlan = subscription.metadata?.plan;
  if (metaPlan === "max") return getPersonalMaxPriceId() ? "team" : "max";
  if (metaPlan === "team" || metaPlan === "pro" || metaPlan === "solo") {
    return metaPlan;
  }
  return "team";
}

/**
 * Does this plan belong on this container's KIND? `pro` and `max` are sold only
 * on a `kind='home'` container and `team` only on a standard workspace
 * (spec §11.1); `solo` and `free` are legacy/absent and constrain nothing.
 */
function planFitsKind(plan: PlanId, kind: WorkspaceKind | undefined): boolean {
  if (isPersonalPaidPlan(plan)) return kind === "home";
  // The positive predicate (§4A, F-295), never `kind !== "home"` — a
  // fourth kind must not become sellable by the act of being named.
  if (plan === "team") return isStandardWorkspace({ kind });
  return true;
}

/**
 * Report, never refuse. `checkout/route.ts` is the fence that keeps `pro` on a
 * home space and `team` on a standard workspace, refused before Stripe
 * is called. By the time an event reaches the webhook the money has moved, so a
 * contradiction is an operator problem: dropping the write would leave a paying
 * customer with no plan. Logged at ERROR, plan written as derived.
 *
 * One extra read on the webhook path, accepted: these are the low-frequency
 * subscription events, not the per-call credit path. A workspace the read cannot
 * find is not reported — a miss is a deleted workspace.
 */
export async function reportPlanContainerMismatch(
  workspaceId: string,
  plan: PlanId
): Promise<void> {
  if (!isPersonalPaidPlan(plan) && plan !== "team") return;
  const workspace = await findWorkspaceById(workspaceId);
  if (!workspace || planFitsKind(plan, workspace.kind)) return;
  console.error(
    `[webhook] Plan/container mismatch: workspace ${workspaceId} is kind ` +
      `'${workspace.kind ?? "standard"}' but the subscription derives plan ` +
      `'${plan}'. Written as derived — the checkout route is the fence, so ` +
      `this is either a bypass of it or a subscription edited in Stripe.`
  );
}
