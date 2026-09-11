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
 * ⚠ A live legacy Solo workspace with 2+ active members is a race/bug — we do
 * NOT resize its flat quantity (the entitlements backstop degrades it to free
 * multi-member rules) but we warn so the anomaly is visible.
 *
 * ⚠ UNCHANGED BY THE 2026-09-07 SOLO RETIREMENT (spec A6): Solo is off sale,
 * so this branch can gain no NEW rows, and the ones it has still need it.
 *
 * 🔒 **`pro` IS FLAT TOO, AND ITS ARM IS THE ONE THING THIS FILE GAINED ON
 * 2026-09-08.** A personal Pro subscription is one price at quantity 1 on a
 * `kind='personal'` container. Falling through to the Team path would have
 * called `subscriptionItems.update` on it with a member count — a BILLED
 * proration against a subscription that has no seat item at all — so the
 * refusal is explicit rather than incidental. It warns on `members > 1` for the
 * same reason the Solo arm does: a second member on a container that cannot
 * have one is an anomaly worth seeing, not worth resizing.
 *
 * Proration uses Stripe's account default.
 */
export async function syncSeatQuantity(workspaceId: string): Promise<void> {
  if (!isStripeConfigured()) return;

  const billing = await getWorkspaceBilling(workspaceId);
  if (!billing) return;

  const live =
    billing.status === "active" || billing.status === "past_due";

  // ⚠ ONE ARM FOR BOTH FLAT PLANS. `solo` (legacy standard workspace) and `pro`
  // (personal container) are priced per SUBSCRIPTION, not per seat; neither has
  // a quantity to true up, and both want the same anomaly warning.
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
          `personal container cannot hold a second member by construction).`
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
