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

/** Read the requested plan from an optional JSON body. Absent or invalid
 *  bodies default to "team" (the per-seat plan). */
async function readPlan(request: NextRequest): Promise<"solo" | "team"> {
  try {
    const body = (await request.json()) as { plan?: unknown };
    if (body?.plan === "solo" || body?.plan === "team") return body.plan;
  } catch {
    // No body / invalid JSON — fall through to the default.
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
 * Start a subscription checkout for the active workspace. Admin/owner only
 * (withWorkspaceAuth minRole). Team is per-seat (quantity = current active
 * member count, kept in sync by the webhook); Solo is flat and requires a
 * single-member workspace.
 */
export const POST = withWorkspaceAuth(
  async (request, { userId, workspaceId, workspaceSlug, workspacePublicId }) => {
    // Every Stripe URL minted below returns to THIS workspace's billing page
    // (`/billing/{segment}`), never the caller's default workspace and never
    // the retiring `/canvas` — see `features/billing/url.ts`.
    const segment = composeSegment(workspaceSlug, workspacePublicId);
    // Block a second checkout whenever a live subscription already exists —
    // any non-canceled status (active AND past_due) means Stripe is still
    // billing this workspace, so a new session would create a duplicate sub.
    // Point the caller at the billing portal to manage the existing one.
    const billing = await getWorkspaceBilling(workspaceId);
    if (billing?.stripeSubscriptionId && billing.status !== "canceled") {
      const portalUrl = billing.stripeCustomerId
        ? await createPortalSession(billing.stripeCustomerId, segment)
        : null;
      return checkoutConflict(portalUrl);
    }

    // Cross-instance claim (M-3) — atomically stake this workspace for the
    // duration of the create-session critical section only. A truly CONCURRENT
    // checkout that lost the claim (this instance OR any other Vercel lambda)
    // is turned away here instead of racing to mint a duplicate untracked sub.
    // The claim is a single-statement compare-and-set in Postgres (upsert-
    // claim, self-expires after 2 min), immune to the PgBouncer/advisory-lock
    // leak the prior attempt hit. It is RELEASED the instant the section ends
    // (the `finally` below), so it does NOT fence a user who abandons checkout
    // or switches plan (Solo<->Team) — they can retry immediately.
    //
    // Residual: this fences only concurrent session-creation, not the whole
    // checkout lifetime. A SEQUENTIAL re-checkout that lands during the webhook
    // lag (claim already released, `stripeSubscriptionId` not yet persisted)
    // can still mint a duplicate sub; fully closing that needs webhook-side
    // subscription dedup. See claimWorkspaceCheckout / migration
    // 20260720210814_workspace_billing_checkout_claim.sql.
    if (!(await claimWorkspaceCheckout(workspaceId))) {
      const portalUrl = billing?.stripeCustomerId
        ? await createPortalSession(billing.stripeCustomerId, segment)
        : null;
      return checkoutConflict(portalUrl);
    }

    // The claim now spans only claim -> session-create -> release (~ms). It is
    // released UNCONDITIONALLY in the `finally` below on every path, success
    // included, so an abandoned or plan-switching checkout is never locked out.
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

      // Re-read billing right before minting the session: a webhook may have
      // landed (persisting a subscription id) since the first read — e.g. a
      // grandfathered sub, or a prior checkout that completed after this
      // request's claim expired. Defense-in-depth behind the claim above.
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
      // Release the claim on EVERY path — the create-session critical section
      // is over whether we minted a session, hit a validation 409, or threw.
      // Holding it past this point would falsely 409 the same user's retry (an
      // abandon/plan-switch lockout) for up to the 2-minute self-expiry, a
      // conversion regression. Two truly-concurrent requests are still
      // serialized by the claim above (the loser 409s before minting), which
      // is the cross-instance protection this preserves. Best-effort — the
      // 2-minute self-expiry is the backstop if this write fails.
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
  // sessionOnly: billing mutations must come from an interactive session, never
  // a background MCP agent — even one holding a dopl.write token.
  { minRole: "admin", sessionOnly: true }
);
