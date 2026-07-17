import { NextResponse } from "next/server";
import { withWorkspaceAuth } from "@/shared/auth/with-workspace-auth";
import { createPortalSession } from "@/features/billing/server/stripe";
import { getWorkspaceBilling } from "@/features/billing/server/workspace-billing";

/**
 * Open the Stripe billing portal for the active workspace. Admin/owner
 * only. Requires the workspace to have a Stripe customer (i.e. it has
 * subscribed at least once).
 */
export const POST = withWorkspaceAuth(
  async (_request, { workspaceId }) => {
    const billing = await getWorkspaceBilling(workspaceId);
    if (!billing?.stripeCustomerId) {
      return NextResponse.json(
        { error: "No billing account to manage for this workspace" },
        { status: 400 }
      );
    }

    try {
      const url = await createPortalSession(billing.stripeCustomerId);
      return NextResponse.json({ url });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      console.error(`[billing/portal] createPortalSession failed: ${message}`);
      return NextResponse.json(
        { error: "Failed to create billing portal session. Please try again." },
        { status: 500 }
      );
    }
  },
  { minRole: "admin" }
);
