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

/** Plan from an optional JSON body; absent/invalid defaults to "team" (per-seat). */
async function readPlan(request: NextRequest): Promise<"solo" | "team"> {
  try {
    const body = (await request.json()) as { plan?: unknown };
    if (body?.plan === "solo" || body?.plan === "team") return body.plan;
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
 * Subscription checkout for the active workspace. Admin/owner only. Team is per-seat (quantity =
 * active member count, synced by the webhook); Solo is flat and requires a single-member workspace.
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
      if (plan === "solo" && quantity !== 1) {
        return NextResponse.json(
          {
            error: "SOLO_REQUIRES_SINGLE_MEMBER",
            message:
              "Pro is for single-member workspaces. Choose Team to bring others.",
          },
          { status: 409 }
        );
      }

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
