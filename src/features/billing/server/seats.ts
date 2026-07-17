import "server-only";
import { getStripe, isStripeConfigured, selectSeatItem } from "./stripe";
import {
  countActiveMembers,
  getWorkspaceBilling,
  upsertWorkspaceBilling,
} from "./workspace-billing";

/**
 * Reconcile a Pro workspace's Stripe seat quantity with its current
 * active member count. Called (best-effort) after a member is added or
 * removed.
 *
 * No-ops when:
 *   - Stripe isn't configured (tests / preview — never touch the API),
 *   - the workspace has no active Pro subscription,
 *   - the seat count already matches (avoid needless proration churn).
 *
 * Proration uses Stripe's account default. Isolated here (one Stripe
 * call, all guards in one place) so it stays testable in isolation.
 */
export async function syncSeatQuantity(workspaceId: string): Promise<void> {
  if (!isStripeConfigured()) return;

  const billing = await getWorkspaceBilling(workspaceId);
  if (!billing) return;
  const hasLiveSub =
    billing.plan === "pro" &&
    (billing.status === "active" || billing.status === "past_due") &&
    !!billing.stripeSubscriptionId;
  if (!hasLiveSub || !billing.stripeSubscriptionId) return;

  const quantity = Math.max(1, await countActiveMembers(workspaceId));
  if (billing.seatCount === quantity) return;

  const stripe = getStripe();
  const subscription = await stripe.subscriptions.retrieve(
    billing.stripeSubscriptionId
  );
  const item = selectSeatItem(subscription);
  if (!item) return;

  await stripe.subscriptionItems.update(item.id, { quantity });
  await upsertWorkspaceBilling(workspaceId, { seatCount: quantity });
}
