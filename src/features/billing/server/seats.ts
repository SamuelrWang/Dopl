import "server-only";
import { getStripe, isStripeConfigured, selectSeatItem } from "./stripe";
import {
  countActiveMembers,
  getWorkspaceBilling,
  upsertWorkspaceBilling,
} from "./workspace-billing";

/**
 * Reconcile a Team workspace's Stripe seat quantity with its active member
 * count. Best-effort, after a member is added or removed.
 *
 * No-ops when: Stripe isn't configured (tests/preview — never touch the API);
 * no active Team subscription (legacy Solo and personal Pro are FLAT, quantity
 * always 1); or the seat count already matches (avoid proration churn).
 *
 * A live flat plan (legacy Solo, or personal Pro since 2026-09-08) with 2+ active
 * members is an anomaly: the quantity is never resized — falling through to the
 * Team path would call `subscriptionItems.update` with a member count, a billed
 * proration against a subscription with no seat item — but it is warned about so
 * the anomaly is visible.
 *
 * Proration uses Stripe's account default.
 */
export async function syncSeatQuantity(workspaceId: string): Promise<void> {
  if (!isStripeConfigured()) return;

  const billing = await getWorkspaceBilling(workspaceId);
  if (!billing) return;

  const live =
    billing.status === "active" || billing.status === "past_due";

  // One arm for both flat plans: `solo` and `pro` are priced per subscription, not
  // per seat, so neither has a quantity to true up.
  const flat = billing.plan === "solo" || billing.plan === "pro";
  if (flat && live && billing.stripeSubscriptionId) {
    const members = await countActiveMembers(workspaceId);
    if (members > 1) {
      const label =
        billing.plan === "solo" ? "legacy Solo workspace" : "personal Pro container";
      console.warn(
        `[seats] ${label} ${workspaceId} has ${members} active members; ` +
          `this plan is single-member and flat. Not resizing Stripe quantity ` +
          `(entitlements backstop degrades solo to free multi-member rules; a ` +
          `home space cannot hold a second member by construction).`
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
