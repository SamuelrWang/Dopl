import { NextResponse } from "next/server";
import { withWorkspaceAuth } from "@/shared/auth/with-workspace-auth";
import { toHttpErrorResponse } from "@/shared/api/http-error-response";
import { listWorkspaceInvoices } from "@/features/billing/server/billing-account-service";

/**
 * GET /api/billing/invoices — the workspace's Stripe invoice history.
 *
 * ADMIN ONLY, for the same reason as the payment method: what a workspace has
 * been charged is not a member-level fact.
 *
 * ONE STRIPE PAGE, NO CURSOR. The service asks for `INVOICE_PAGE_SIZE`
 * (`features/billing/billing-account.ts`) and the table renders what comes
 * back; a workspace that outgrows two years of invoices has the Stripe-hosted
 * portal, which paginates properly. `[]` is the answer for a workspace with no
 * Stripe customer and for an environment with no key.
 */
export const GET = withWorkspaceAuth(
  async (_request, { workspaceId }) => {
    try {
      return NextResponse.json({
        invoices: await listWorkspaceInvoices(workspaceId),
      });
    } catch (err) {
      return toHttpErrorResponse("billing/invoices", err);
    }
  },
  { minRole: "admin" }
);
