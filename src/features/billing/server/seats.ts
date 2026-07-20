import "server-only";
import { getStripe, isStripeConfigured, selectSeatItem } from "./stripe";
import {
  countActiveMembers,
  getWorkspaceBilling,
  upsertWorkspaceBilling,
} from "./workspace-billing";

/**
 * Reconcile a Team workspace's Stripe seat quantity with its current
 * active member count. Called (best-effort) after a member is added or
 * removed.
 *
 * No-ops when:
 *   - Stripe isn't configured (tests / preview — never touch the API),
 *   - the workspace has no active Team subscription (Solo is flat — its
 *     quantity is always 1 and is never touched here),
 *   - the seat count already matches (avoid needless proration churn).
 *
 * Solo is single-member by contract; a live Solo workspace with 2+ active
 * members is a race/bug. We do NOT resize its (flat) Stripe quantity — the
 * entitlements backstop degrades it to free multi-member rules — but we
 * warn so the anomaly is visible.
 *
 * Proration uses Stripe's account default. Isolated here (one Stripe
 * call, all guards in one place) so it stays testable in isolation.
 */
export async function syncSeatQuantity(workspaceId: string): Promise<void> {
  if (!isStripeConfigured()) return;

  const billing = await getWorkspaceBilling(workspaceId);
  if (!billing) return;

  const live =
    billing.status === "active" || billing.status === "past_due";

  if (billing.plan === "solo" && live && billing.stripeSubscriptionId) {
    const members = await countActiveMembers(workspaceId);
    if (members > 1) {
      console.warn(
        `[seats] Solo workspace ${workspaceId} has ${members} active members; ` +
          `Solo is single-member and flat. Not resizing Stripe quantity ` +
          `(entitlements backstop degrades it to free multi-member rules).`
      );
    }
    return;
  }

  const hasLiveSub =
    billing.plan === "team" && live && !!billing.stripeSubscriptionId;
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
