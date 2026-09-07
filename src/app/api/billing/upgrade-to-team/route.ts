import { NextResponse } from "next/server";
import { withWorkspaceAuth } from "@/shared/auth/with-workspace-auth";
import { isStandardWorkspace } from "@/features/workspaces/types";
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
 * Upgrade a live Solo workspace to Team in place. Admin/owner only. Swaps the item's price to the
 * per-seat Team price with quantity = active member count, so the user keeps ONE subscription (no
 * cancel + re-checkout).
 *
 * ⚠ THIS ROUTE EXISTS FOR LEGACY ROWS AND ITS BEHAVIOUR IS UNCHANGED BY THE 2026-09-07 RETIREMENT
 * (spec A6). Solo/"Pro" is off SALE — `POST /api/billing/checkout` refuses it with 400
 * `PLAN_RETIRED` — but the subscriptions already on it keep billing, and this is their one way
 * off it without a cancel-and-repurchase. It is the LAST route that may still read `plan ===
 * "solo"`: when the final legacy row is gone this file goes with it, not before.
 * ⚠ Do NOT stamp `lastStripeEventCreated` here — the authoritative
 * `customer.subscription.updated` webhook carries its own watermark.
 *
 * 🔒 **A CONTAINER IS REFUSED BEFORE THE PLAN IS EVEN READ (2026-09-08, spec
 * §11), AND WITH ITS OWN CODE.** Team is a standard workspace's plan; a
 * `kind='personal'` container's paid plan is `pro` and it is bought, not
 * upgraded into. Falling through would have answered 409 `NOT_ON_SOLO` — a
 * sentence about a plan the caller never had, on a container that could not
 * hold Team even if they did — and, on the one row that WOULD satisfy the solo
 * check, would have swapped a personal container's subscription to the per-seat
 * price. `NOT_A_WORKSPACE` says the true thing instead.
 *
 * 🔒 **A FENCE, SO THE PREDICATE STAYS NEGATIVE AND THE MESSAGE BRANCHES ON THE
 * KIND (F-564, declared in `features/workspaces/home-channel-derivation.test.ts
 * › FENCE_SITES`).** Team belongs on a standard workspace and on nothing else,
 * so a fourth kind must INHERIT this refusal rather than opt into it —
 * repointing at the positive link test would make `personal` upgradable to
 * Team. ⚠ **AND THAT SENTENCE DELIBERATELY DOES NOT SPELL THE TEST OUT**: the
 * gate's third case greps this file's RAW TEXT (comments included) for it, so a
 * docblock quoting the expression would satisfy the gate on behalf of code that
 * had stopped branching. One occurrence, in the branch itself.
 * One sentence cannot describe two containers: telling the owner of a home
 * CHANNEL that "this is your personal space, which has its own Pro plan" names
 * the wrong container and offers them a plan that container cannot hold.
 */
export const POST = withWorkspaceAuth(
  async (_request, { workspaceId, workspaceKind: kind }) => {
    // ⚠ The POSITIVE predicate (§4A, F-295): `link` and `personal` are both
    // refused, and so is any kind added later.
    if (!isStandardWorkspace({ kind })) {
      return NextResponse.json(
        {
          error: "NOT_A_WORKSPACE",
          message:
            kind === "link"
              ? "Team is a workspace plan. This is a home channel, which carries no plan of its own."
              : "Team is a workspace plan. This is your personal space, which has its own Pro plan.",
        },
        { status: 409 }
      );
    }

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

    // ⚠ One atomic call — price AND metadata.plan — so webhook plan derivation stays correct
    // where the price envs are unset (derivePlan falls back to metadata).
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
  // sessionOnly: billing mutations need an interactive session, never a background MCP agent.
  { minRole: "admin", sessionOnly: true }
);
