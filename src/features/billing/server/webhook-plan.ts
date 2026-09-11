import "server-only";
import type Stripe from "stripe";
import { findWorkspaceById } from "@/features/workspaces/server/repository";
import {
  isStandardWorkspace,
  type WorkspaceKind,
} from "@/features/workspaces/types";
import type { PlanId } from "../plans";
import {
  getLegacySeatPriceId,
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
 *   • CURRENT per-seat Team price, or the LEGACY $7.99 seat price → `team`. ⚠ A
 *     legacy seat sub is a TEAM sub — its price moved, its plan did not — and
 *     leaving it out sent it to the metadata fallback, where an older session
 *     that stamped nothing landed on `team` by accident rather than by rule.
 *   • Personal Pro price → `pro` (2026-09-08).
 *   • Flat Solo price → `solo`. ⚠ LEGACY-ONLY (2026-09-07, spec A6): off sale
 *     is not off the books. Every live Solo sub still sends events here, and
 *     dropping the arm would silently re-plan a paying Solo workspace as Team
 *     on its next invoice event.
 *
 * ⚠ THE `team` DEFAULT IS THE OLD ONE AND IS DELIBERATELY NOT `pro`. It is what
 * an unrecognized price on an unstamped subscription resolves to, and the whole
 * population of those predates `pro` entirely.
 */
export function derivePlan(subscription: Stripe.Subscription): PlanId {
  const priceIds = (subscription.items?.data ?? [])
    .map((item) => item.price?.id)
    .filter((id): id is string => Boolean(id));
  const has = (priceId: string | null) => !!priceId && priceIds.includes(priceId);

  if (has(getSeatPriceId()) || has(getLegacySeatPriceId())) return "team";
  if (has(getPersonalProPriceId())) return "pro";
  if (has(getSoloPriceId())) return "solo";

  const metaPlan = subscription.metadata?.plan;
  if (metaPlan === "team" || metaPlan === "pro" || metaPlan === "solo") {
    return metaPlan;
  }
  return "team";
}

/**
 * Does this plan belong on this container's KIND? `pro` is sold only on a
 * `kind='personal'` container and `team` only on a standard workspace
 * (spec §11.1); `solo` and `free` are legacy/absent and constrain nothing.
 */
function planFitsKind(plan: PlanId, kind: WorkspaceKind | undefined): boolean {
  if (plan === "pro") return kind === "personal";
  // ⚠ THE POSITIVE PREDICATE (§4A, F-295), never `kind !== "personal"` — a
  // fourth kind must not become sellable by the act of being named.
  if (plan === "team") return isStandardWorkspace({ kind });
  return true;
}

/**
 * 🔒 REPORT, NEVER REFUSE. A `pro` subscription must land on a personal
 * container and a `team` one on a standard workspace, and `checkout/route.ts`
 * is the FENCE that makes it so — refused before Stripe is ever called, which
 * is the only moment a refusal is free.
 *
 * By the time an event reaches the webhook the money has already moved, so a
 * contradiction here is an operator problem, not a request to reject: dropping
 * the write would leave a paying customer with no plan and no trace beyond a
 * webhook that answered 200. It is logged at ERROR (it is a bug in the fence
 * upstream, or a subscription edited by hand in the Stripe dashboard) and the
 * plan is written as derived.
 *
 * ⚠ ONE EXTRA READ ON THE WEBHOOK PATH, accepted: the events that reach it are
 * the low-frequency subscription ones, not the per-call credit path.
 * ⚠ A workspace the read cannot find is NOT reported — the resolver already
 * mapped this id, so a miss is a deleted workspace, whose own handlers say so.
 */
export async function reportPlanContainerMismatch(
  workspaceId: string,
  plan: PlanId
): Promise<void> {
  if (plan !== "pro" && plan !== "team") return;
  const workspace = await findWorkspaceById(workspaceId);
  if (!workspace || planFitsKind(plan, workspace.kind)) return;
  console.error(
    `[webhook] Plan/container mismatch: workspace ${workspaceId} is kind ` +
      `'${workspace.kind ?? "standard"}' but the subscription derives plan ` +
      `'${plan}'. Written as derived — the checkout route is the fence, so ` +
      `this is either a bypass of it or a subscription edited in Stripe.`
  );
}
