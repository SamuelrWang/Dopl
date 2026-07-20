import { NextResponse, type NextRequest } from "next/server";
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

/**
 * Start a subscription checkout for the active workspace. Admin/owner only
 * (withWorkspaceAuth minRole). Team is per-seat (quantity = current active
 * member count, kept in sync by the webhook); Solo is flat and requires a
 * single-member workspace.
 */
export const POST = withWorkspaceAuth(
  async (request, { userId, workspaceId }) => {
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
            "Solo Pro is for single-member workspaces. Choose Team to bring others.",
        },
        { status: 409 }
      );
    }

    const clientSecret = await createWorkspaceCheckoutSession({
      workspaceId,
      plan,
      quantity,
      email: profile.email,
      stripeCustomerId: billing?.stripeCustomerId,
    });

    return NextResponse.json({ clientSecret });
  },
  { minRole: "admin" }
);
