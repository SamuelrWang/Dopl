import { NextResponse } from "next/server";
import { withWorkspaceAuth } from "@/shared/auth/with-workspace-auth";
import {
  getSeatPriceId,
  getStripe,
  selectSeatItem,
} from "@/features/billing/server/stripe";
import {
  countActiveMembers,
  getWorkspaceBilling,
  upsertWorkspaceBilling,
} from "@/features/billing/server/workspace-billing";

/**
 * Upgrade a live Solo workspace to Team in place. Admin/owner only.
 * Swaps the subscription item's price to the per-seat Team price and sets
 * quantity = active member count, so the user keeps one subscription (no
 * cancel + re-checkout). The optimistic local upsert reflects the change
 * immediately; the authoritative `customer.subscription.updated` webhook
 * confirms it (with its own event watermark), so we do NOT stamp
 * `lastStripeEventCreated` here.
 */
export const POST = withWorkspaceAuth(
  async (_request, { workspaceId }) => {
    const billing = await getWorkspaceBilling(workspaceId);
    const live =
      billing?.status === "active" || billing?.status === "past_due";
    if (billing?.plan !== "solo" || !live || !billing.stripeSubscriptionId) {
      return NextResponse.json(
        {
          error: "NOT_ON_SOLO",
          message:
            "This workspace is not on an active Solo plan, so there is nothing to upgrade to Team.",
        },
        { status: 409 }
      );
    }

    const seatPriceId = getSeatPriceId();
    if (!seatPriceId) {
      return NextResponse.json(
        {
          error: "SEAT_PRICE_NOT_CONFIGURED",
          message:
            "Per-seat Team price not configured. Set STRIPE_PRO_SEAT_PRICE_ID in env.",
        },
        { status: 500 }
      );
    }

    const qty = Math.max(1, await countActiveMembers(workspaceId));

    const stripe = getStripe();
    const subscription = await stripe.subscriptions.retrieve(
      billing.stripeSubscriptionId
    );
    const item = selectSeatItem(subscription);
    if (!item) {
      return NextResponse.json(
        {
          error: "SUBSCRIPTION_ITEM_NOT_FOUND",
          message: "Could not locate the subscription item to upgrade.",
        },
        { status: 500 }
      );
    }

    // One atomic call: swap the item price AND restamp metadata.plan, so
    // webhook plan derivation stays correct even in an environment where
    // the price envs are unset (derivePlan falls back to metadata).
    await stripe.subscriptions.update(billing.stripeSubscriptionId, {
      items: [{ id: item.id, price: seatPriceId, quantity: qty }],
      metadata: { ...subscription.metadata, plan: "team" },
    });

    await upsertWorkspaceBilling(workspaceId, {
      plan: "team",
      stripePriceId: seatPriceId,
      seatCount: qty,
    });

    return NextResponse.json({ ok: true, seatCount: qty });
  },
  // sessionOnly: billing mutations must come from an interactive session, never
  // a background MCP agent — even one holding a dopl.write token.
  { minRole: "admin", sessionOnly: true }
);
