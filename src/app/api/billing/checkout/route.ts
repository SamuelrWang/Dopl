import { NextResponse } from "next/server";
import { withWorkspaceAuth } from "@/shared/auth/with-workspace-auth";
import { supabaseAdmin } from "@/shared/supabase/admin";
import {
  createPortalSession,
  createWorkspaceCheckoutSession,
} from "@/features/billing/server/stripe";
import {
  countActiveMembers,
  getWorkspaceBilling,
} from "@/features/billing/server/workspace-billing";

/**
 * Start a per-seat Pro checkout for the active workspace. Admin/owner
 * only (withWorkspaceAuth minRole). Seat quantity = current active
 * member count; the webhook keeps it in sync afterward.
 */
export const POST = withWorkspaceAuth(
  async (_request, { userId, workspaceId }) => {
    // Block a second checkout whenever a live subscription already exists —
    // any non-canceled status (active AND past_due) means Stripe is still
    // billing this workspace, so a new session would create a duplicate sub.
    // Point the caller at the billing portal to manage the existing one.
    const billing = await getWorkspaceBilling(workspaceId);
    if (billing?.stripeSubscriptionId && billing.status !== "canceled") {
      const portalUrl = billing.stripeCustomerId
        ? await createPortalSession(billing.stripeCustomerId)
        : null;
      return NextResponse.json(
        {
          error: "Workspace already has an active subscription",
          portalUrl,
        },
        { status: 409 }
      );
    }

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
    const clientSecret = await createWorkspaceCheckoutSession({
      workspaceId,
      quantity,
      email: profile.email,
      stripeCustomerId: billing?.stripeCustomerId,
    });

    return NextResponse.json({ clientSecret });
  },
  { minRole: "admin" }
);
