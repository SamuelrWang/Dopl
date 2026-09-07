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
import { isStandardWorkspace } from "@/features/workspaces/types";
import { PRO_PRICE, TEAM_SEAT_PRICE, formatMoney } from "@/features/billing/prices";

/** 400 for a body still asking to buy the retired Solo plan. ⚠ A REFUSAL, not a
 *  silent upgrade: a caller that asked for a $5.99 flat WORKSPACE plan must not
 *  be handed a per-seat subscription because the server decided for them, and
 *  must not be handed personal Pro either — that is a different container. */
function planRetired() {
  return NextResponse.json(
    {
      error: "PLAN_RETIRED",
      message: `The old flat plan is no longer sold. Team is ${formatMoney(TEAM_SEAT_PRICE)} per seat per month; Pro is ${formatMoney(PRO_PRICE)} a month for your personal space.`,
    },
    { status: 400 }
  );
}

/**
 * 400 for a plan meeting the WRONG CONTAINER KIND. ⚠ THE MESSAGE NAMES THE
 * SURFACE that can sell it, because every caller of this route holds one
 * workspace id and no way to guess the other one.
 */
function planNotForContainer(plan: "team" | "pro") {
  return NextResponse.json(
    {
      error: "PLAN_NOT_FOR_CONTAINER",
      message:
        plan === "pro"
          ? "Pro is for your personal space; open billing from Home."
          : "Team is for a workspace.",
    },
    { status: 400 }
  );
}

/** What the body asked for. `retired` is an explicit `solo`; `unknown` is an
 *  absent, unparseable or unrecognized plan, which the CONTAINER then decides
 *  (the desktop Upgrade button POSTs no body at all). */
type PlanRequest = "team" | "pro" | "retired" | "unknown";

/**
 * Plan from an optional JSON body. **Team and Pro are the purchasable plans**
 * (2026-09-08, spec §11); an explicit `"solo"` is REFUSED rather than coerced,
 * and anything else is `unknown` rather than a plan the caller did not ask for.
 *
 * ⚠ IT DOES NOT DEFAULT TO `team` ANY MORE, and that is the whole edit: a
 * default chosen here is a default chosen before the container kind is known,
 * which is exactly how a personal container would end up buying seats.
 */
async function readPlan(request: NextRequest): Promise<PlanRequest> {
  try {
    const body = (await request.json()) as { plan?: unknown };
    if (body?.plan === "solo") return "retired";
    if (body?.plan === "team" || body?.plan === "pro") return body.plan;
  } catch {
  }
  return "unknown";
}

function checkoutConflict(portalUrl: string | null) {
  return NextResponse.json(
    { error: "Workspace already has an active subscription", portalUrl },
    { status: 409 }
  );
}

/**
 * Subscription checkout for the active CONTAINER. Admin/owner only. Two plans, and the container's
 * KIND decides which one it may buy (2026-09-08, spec §11):
 *   • a STANDARD workspace buys `team`, per-seat, quantity = active member count;
 *   • a `kind='personal'` container buys `pro`, flat, quantity 1.
 *
 * 🔒 **THE KIND FENCE IS HERE, AND HERE IS THE ONLY PLACE IT IS FREE.** Both plans are $8.99, both
 * live on `workspace_billing` keyed by container id, and nothing downstream can tell them apart
 * once the money has moved — `webhook-plan.ts › reportPlanContainerMismatch` can only LOG a
 * subscription that landed wrong. Refusing before Stripe is called is what makes that log an
 * operator's alarm rather than the normal path.
 *
 * ⚠ AN ABSENT PLAN IS ANSWERED BY THE CONTAINER, NOT BY A DEFAULT — team on a standard workspace,
 * pro on a personal one. The desktop Upgrade button POSTs no body, and it is right in both places.
 *
 * ⚠ SOLO IS RETIRED FROM SALE (2026-09-07, Samuel's per-seat ruling — spec A6) and `pro` is NOT its
 * return: Solo was a flat plan for a whole workspace. A body asking for it answers 400
 * `PLAN_RETIRED`. The `SOLO_REQUIRES_SINGLE_MEMBER` 409 that used to guard it is DELETED with the
 * sale, not relaxed. Live `solo` rows are untouched — they keep billing until they cancel, or move
 * to Team in place via `POST /api/billing/upgrade-to-team`.
 */
export const POST = withWorkspaceAuth(
  async (
    request,
    { userId, workspaceId, workspaceSlug, workspacePublicId, workspaceKind }
  ) => {
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
      const requested = await readPlan(request);
      if (requested === "retired") return planRetired();
      const isStandard = isStandardWorkspace({ kind: workspaceKind });
      // ⚠ The POSITIVE predicate for `team` (§4A, F-295) and an explicit
      // `personal` for `pro`: a link container is neither, and a fourth kind
      // must not become sellable by the act of being named.
      const plan =
        requested === "unknown" ? (isStandard ? "team" : "pro") : requested;
      if (plan === "pro" && workspaceKind !== "personal") {
        return planNotForContainer("pro");
      }
      if (plan === "team" && !isStandard) return planNotForContainer("team");

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

      // ⚠ Pro is flat — a personal container has exactly one member, so the
      // count is both known and unbillable. Skipping it also skips a read.
      const quantity = plan === "pro" ? 1 : await countActiveMembers(workspaceId);

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
