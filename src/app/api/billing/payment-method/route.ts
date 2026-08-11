import { NextResponse } from "next/server";
import { withWorkspaceAuth } from "@/shared/auth/with-workspace-auth";
import { toHttpErrorResponse } from "@/shared/api/http-error-response";
import { getWorkspacePaymentMethod } from "@/features/billing/server/billing-account-service";

/**
 * GET /api/billing/payment-method — the card Stripe will charge next.
 *
 * ADMIN ONLY. A card's brand and last four are the workspace's payment
 * identity; a viewer who can read the plan has no business reading them.
 *
 * `{ paymentMethod: null }` is the ANSWER, not an error, for every workspace
 * that has never paid and for any environment without a Stripe key — the
 * service decides that, this handler only carries it (§2, thin handler).
 */
export const GET = withWorkspaceAuth(
  async (_request, { workspaceId }) => {
    try {
      return NextResponse.json({
        paymentMethod: await getWorkspacePaymentMethod(workspaceId),
      });
    } catch (err) {
      return toHttpErrorResponse("billing/payment-method", err);
    }
  },
  { minRole: "admin" }
);
