import { NextResponse } from "next/server";
import { withWorkspaceAuth } from "@/shared/auth/with-workspace-auth";
import { createPortalSession } from "@/features/billing/server/stripe";
import { getWorkspaceBilling } from "@/features/billing/server/workspace-billing";
import { composeSegment } from "@/shared/lib/url/parse-segment";

/** Stripe billing portal for the active workspace. Admin/owner only; requires a Stripe customer. */
export const POST = withWorkspaceAuth(
  async (_request, { workspaceId, workspaceSlug, workspacePublicId }) => {
    const billing = await getWorkspaceBilling(workspaceId);
    if (!billing?.stripeCustomerId) {
      return NextResponse.json(
        { error: "No billing account to manage for this workspace" },
        { status: 400 }
      );
    }

    try {
      // ⚠ Returns to THIS workspace's billing page, not the caller's default one.
      const url = await createPortalSession(
        billing.stripeCustomerId,
        composeSegment(workspaceSlug, workspacePublicId)
      );
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
  // sessionOnly: billing mutations need an interactive session, never a background MCP agent.
  { minRole: "admin", sessionOnly: true }
);
