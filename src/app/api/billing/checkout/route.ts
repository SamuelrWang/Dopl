import { NextResponse, type NextRequest } from "next/server";
import { withWorkspaceAuth } from "@/shared/auth/with-workspace-auth";
import { supabaseAdmin } from "@/shared/supabase/admin";
import {
  createPortalSession,
  createWorkspaceCheckoutSession,
} from "@/features/billing/server/stripe";
import {
  claimWorkspaceCheckout,
  countActiveMembers,
  getWorkspaceBilling,
  releaseWorkspaceCheckout,
} from "@/features/billing/server/workspace-billing";
import { composeSegment } from "@/shared/lib/url/parse-segment";

/** 400 for a body still asking to buy the retired Solo/"Pro" plan. ⚠ A REFUSAL,
 *  not a silent upgrade to Team: a caller that asked for a $5.99 flat plan must
 *  not be handed an $8.00-per-seat subscription because the server decided for
 *  them. */
function planRetired() {
  return NextResponse.json(
    {
      error: "PLAN_RETIRED",
      message: "Pro is no longer sold. Team is $8.00 per seat per month.",
    },
    { status: 400 }
  );
}

/**
 * Plan from an optional JSON body. **Team is the only purchasable plan**
 * (2026-09-07, spec A6) — absent/unrecognized defaults to `"team"`, and an
 * explicit `"solo"` is REFUSED rather than coerced. Returns `null` to mean
 * "answer 400", never a plan the caller did not ask for.
 */
async function readPlan(request: NextRequest): Promise<"team" | null> {
  try {
    const body = (await request.json()) as { plan?: unknown };
    if (body?.plan === "solo") return null;
  } catch {
  }
  return "team";
}

function checkoutConflict(portalUrl: string | null) {
  return NextResponse.json(
    { error: "Workspace already has an active subscription", portalUrl },
    { status: 409 }
  );
}

/**
 * Subscription checkout for the active workspace. Admin/owner only. **Team only, per-seat**
 * (quantity = active member count, synced by the webhook).
 *
 * ⚠ SOLO/"PRO" IS RETIRED FROM SALE (2026-09-07, Samuel's per-seat ruling — spec A6). This route
 * no longer mints a Solo session for anybody: a body asking for it answers 400 `PLAN_RETIRED`.
 * The `SOLO_REQUIRES_SINGLE_MEMBER` 409 that used to guard it is DELETED with the sale, not
 * relaxed. Live `solo` rows are untouched — they keep billing until they cancel, or move to Team
 * in place via `POST /api/billing/upgrade-to-team`.
 */
export const POST = withWorkspaceAuth(
  async (request, { userId, workspaceId, workspaceSlug, workspacePublicId }) => {
    // ⚠ Every Stripe URL returns to THIS workspace's `/billing/{segment}`, never the caller's
    // default workspace — see `features/billing/url.ts`.
    const segment = composeSegment(workspaceSlug, workspacePublicId);
    // ⚠ Any NON-CANCELED status (active AND past_due) means Stripe is still billing this
    // workspace, so a second session would create a duplicate sub.
    const billing = await getWorkspaceBilling(workspaceId);
    if (billing?.stripeSubscriptionId && billing.status !== "canceled") {
      const portalUrl = billing.stripeCustomerId
        ? await createPortalSession(billing.stripeCustomerId, segment)
        : null;
      return checkoutConflict(portalUrl);
    }

    // Cross-instance claim: a single-statement compare-and-set in Postgres (self-expires after
    // 2 min), immune to the PgBouncer/advisory-lock leak an earlier attempt hit. A concurrent
    // checkout on ANY lambda that loses the claim is turned away rather than minting a duplicate.
    // ⚠ Residual: fences concurrent session-CREATION only, not the checkout lifetime. A
    // SEQUENTIAL re-checkout landing during webhook lag (claim released, `stripeSubscriptionId`
    // not yet persisted) can still mint a duplicate — closing that needs webhook-side dedup.
    if (!(await claimWorkspaceCheckout(workspaceId))) {
      const portalUrl = billing?.stripeCustomerId
        ? await createPortalSession(billing.stripeCustomerId, segment)
        : null;
      return checkoutConflict(portalUrl);
    }

    // Claim spans claim → session-create → release (~ms), freed unconditionally in the `finally`
    // so an abandoned or plan-switching checkout is never locked out.
    try {
      const plan = await readPlan(request);
      if (!plan) return planRetired();

      const { data: profile } = await supabaseAdmin()
        .from("profiles")
        .select("email")
        .eq("id", userId)
        .single();
      if (!profile?.email) {
        return NextResponse.json(
          { error: "User email not found" },
          { status: 400 }
        );
      }

      const quantity = await countActiveMembers(workspaceId);

      // Re-read billing before minting: a webhook may have persisted a subscription id since
      // the first read. Defense-in-depth behind the claim.
      const fresh = await getWorkspaceBilling(workspaceId);
      if (fresh?.stripeSubscriptionId && fresh.status !== "canceled") {
        const portalUrl = fresh.stripeCustomerId
          ? await createPortalSession(fresh.stripeCustomerId, segment)
          : null;
        return checkoutConflict(portalUrl);
      }

      const clientSecret = await createWorkspaceCheckoutSession({
        workspaceId,
        plan,
        quantity,
        email: profile.email,
        stripeCustomerId: fresh?.stripeCustomerId ?? billing?.stripeCustomerId,
        segment,
      });

      return NextResponse.json({ clientSecret });
    } finally {
      // ⚠ Release on EVERY path. Holding past here falsely 409s the same user's retry for up to
      // the 2-min self-expiry — a conversion regression. Concurrent requests are still serialized
      // by the claim (the loser 409s before minting). Best-effort; self-expiry is the backstop.
      try {
        await releaseWorkspaceCheckout(workspaceId);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(
          `[checkout] Failed to release checkout claim for workspace ${workspaceId}: ${message}`
        );
      }
    }
  },
  // sessionOnly: billing mutations need an interactive session, never a background MCP agent.
  { minRole: "admin", sessionOnly: true }
);
