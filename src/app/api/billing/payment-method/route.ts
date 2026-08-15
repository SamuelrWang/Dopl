import { NextResponse } from "next/server";
import { withWorkspaceAuth } from "@/shared/auth/with-workspace-auth";
import { toHttpErrorResponse } from "@/shared/api/http-error-response";
import { getWorkspacePaymentMethod } from "@/features/billing/server/billing-account-service";

/**
 * GET /api/billing/payment-method — the card Stripe will charge next. ADMIN ONLY: brand + last
 * four are the workspace's payment identity, not a viewer-level fact.
 * `{ paymentMethod: null }` is the ANSWER, not an error, for a workspace that has never paid and
 * for an environment without a Stripe key.
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
