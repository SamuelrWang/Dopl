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
 * PARTIAL mitigation for concurrent-checkout duplicate-subscription (M-3),
 * NOT a full fix. The 409 guard below only trips once `stripeSubscriptionId`
 * is persisted — between "start checkout" and the webhook writing that id,
 * two racing requests can each mint a Stripe subscription. Adding a real
 * cross-instance claim needs schema we're not touching here.
 *
 * This in-process set collapses the common case: a double-click / retry /
 * React double-invoke landing on the SAME warm serverless instance can't
 * both create a session. It does NOTHING across instances (Vercel may route
 * concurrent requests to different lambdas), so a residual race remains —
 * narrowed further by the Stripe idempotencyKey in createWorkspaceCheckout-
 * Session (same workspace+plan+quantity+hour → one session) and the billing
 * re-read immediately before session creation. Residual risk is documented,
 * accepted, and left for the main thread to fully close (advisory lock or a
 * `checkout_pending` column) if it wants a hard guarantee.
 */
const inflightCheckouts = new Set<string>();

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
      return checkoutConflict(portalUrl);
    }

    // In-process claim (M-3 partial mitigation) — reject a concurrent checkout
    // for the same workspace on this instance instead of minting a 2nd sub.
    if (inflightCheckouts.has(workspaceId)) {
      return NextResponse.json(
        { error: "A checkout is already in progress for this workspace" },
        { status: 409 }
      );
    }
    inflightCheckouts.add(workspaceId);
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
              "Solo Pro is for single-member workspaces. Choose Team to bring others.",
          },
          { status: 409 }
        );
      }

      // Re-read billing right before minting the session: a webhook may have
      // landed (persisting a subscription id) since the first read, in which
      // case creating another session would duplicate the sub. Cheap defense
      // that shrinks — but does not eliminate — the cross-instance race.
      const fresh = await getWorkspaceBilling(workspaceId);
      if (fresh?.stripeSubscriptionId && fresh.status !== "canceled") {
        const portalUrl = fresh.stripeCustomerId
          ? await createPortalSession(fresh.stripeCustomerId)
          : null;
        return checkoutConflict(portalUrl);
      }

      const clientSecret = await createWorkspaceCheckoutSession({
        workspaceId,
        plan,
        quantity,
        email: profile.email,
        stripeCustomerId: fresh?.stripeCustomerId ?? billing?.stripeCustomerId,
      });

      return NextResponse.json({ clientSecret });
    } finally {
      inflightCheckouts.delete(workspaceId);
    }
  },
  // sessionOnly: billing mutations must come from an interactive session, never
  // a background MCP agent — even one holding a dopl.write token.
  { minRole: "admin", sessionOnly: true }
);
