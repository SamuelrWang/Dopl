import { NextResponse } from "next/server";
import { withWorkspaceAuth } from "@/shared/auth/with-workspace-auth";
import { toHttpErrorResponse } from "@/shared/api/http-error-response";
import { listWorkspaceInvoices } from "@/features/billing/server/billing-account-service";

/**
 * GET /api/billing/invoices — the workspace's Stripe invoice history. ADMIN ONLY: what a
 * workspace has been charged is not a member-level fact.
 * ONE Stripe page, no cursor — the service asks for `INVOICE_PAGE_SIZE`
 * (`features/billing/billing-account.ts`); a workspace that outgrows it has the Stripe-hosted
 * portal. `[]` for no Stripe customer and for an environment with no key.
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
