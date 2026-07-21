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

    // Cross-instance claim (M-3 full fix) — atomically stake this workspace
    // before minting a Stripe subscription. A concurrent checkout that lost
    // the claim (this instance OR any other Vercel lambda) is turned away
    // here instead of racing to create a duplicate untracked sub during the
    // window before the webhook persists `stripeSubscriptionId`. The claim is
    // a single-statement compare-and-set in Postgres (upsert-claim, self-
    // expires after 2 min), immune to the PgBouncer/advisory-lock leak the
    // prior attempt hit. See claimWorkspaceCheckout / migration
    // 20260720210814_workspace_billing_checkout_claim.sql.
    if (!(await claimWorkspaceCheckout(workspaceId))) {
      const portalUrl = billing?.stripeCustomerId
        ? await createPortalSession(billing.stripeCustomerId)
        : null;
      return checkoutConflict(portalUrl);
    }

    // Hold the claim only on the success path (a live checkout session was
    // minted): it blocks a racing second checkout until the webhook clears it
    // on `checkout.session.completed` or it self-expires (2 min). Every
    // terminal non-success path below releases it so the caller can retry at
    // once (e.g. solo/team mismatch) rather than waiting out the expiry.
    let holdClaim = false;
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
      // landed (persisting a subscription id) since the first read — e.g. a
      // grandfathered sub, or a prior checkout that completed after this
      // request's claim expired. Defense-in-depth behind the claim above.
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

      // Session minted: keep the claim in force until the webhook clears it.
      holdClaim = true;
      return NextResponse.json({ clientSecret });
    } finally {
      // Release on every path except a successfully-minted session (which
      // must keep the claim to fence a concurrent checkout). Best-effort —
      // the 2-minute self-expiry is the backstop if this write fails.
      if (!holdClaim) {
        try {
          await releaseWorkspaceCheckout(workspaceId);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          console.error(
            `[checkout] Failed to release checkout claim for workspace ${workspaceId}: ${message}`
          );
        }
      }
    }
  },
  // sessionOnly: billing mutations must come from an interactive session, never
  // a background MCP agent — even one holding a dopl.write token.
  { minRole: "admin", sessionOnly: true }
);
