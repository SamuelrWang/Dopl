"use client";

import { DeleteAccount } from "@/shared/layout/settings-modal/sections/delete-account";
import { PlansBilling } from "@/shared/layout/settings-modal/sections/plans-billing";
import { meetsMinRole, type Role } from "@/features/workspaces/types";
import type { CheckoutPlan } from "../url";
import { BillingCancelPlan } from "./billing-cancel-plan";
import { BillingInvoices } from "./billing-invoices";
import { BillingPaymentMethod } from "./billing-payment-method";
import { useBillingPortal } from "./use-billing-portal";
import { useWorkspaceEntitlements } from "./use-workspace-entitlements";

/**
 * BILLING pane: plan → card → invoices → cancel/resume → delete account.
 *
 * ⚠ Both halves of the card/invoices/cancel gate are load-bearing. `canManage`
 * keeps a member from firing routes that answer 403; `has_stripe_customer`
 * keeps a free workspace from rendering an empty card + invoice table for a
 * customer that does not exist.
 *
 * ⚠ Delete account stays LAST on THIS tab — the desktop app links here
 * specifically to reach it (`apps/desktop-ui/.../account-actions.tsx`, plan
 * D4); moving it to Usage strands that link.
 */
export function BillingPlansPane({
  workspaceId,
  role,
  billingReturn,
  initialCheckoutPlan,
  onCheckoutOpenChange,
}: {
  workspaceId: string;
  role: Role;
  billingReturn: "success" | "return" | null;
  initialCheckoutPlan: CheckoutPlan | null;
  /** From `PlansBilling` to the tab shell: disables the tab switcher while
   *  Stripe's card form is mounted — switching tabs unmounts this pane. */
  onCheckoutOpenChange?: (open: boolean) => void;
}) {
  // Same args as panes below → one cache entry, one request.
  const ent = useWorkspaceEntitlements(workspaceId);
  const portal = useBillingPortal(workspaceId);
  const canManage = meetsMinRole(role, "admin");
  const hasStripeAccount = canManage && ent.isPaid && ent.has_stripe_customer;

  return (
    <>
      <section className="bento px-6 py-5">
        <PlansBilling
          billingReturn={billingReturn}
          initialCheckoutPlan={initialCheckoutPlan}
          onCheckoutOpenChange={onCheckoutOpenChange}
          role={role}
          workspaceId={workspaceId}
        />
        <p className="mt-4 text-caption text-text-muted">
          Done here? Go back to the Dopl app — your plan updates there on its
          own.
        </p>
      </section>

      {hasStripeAccount && (
        <BillingPaymentMethod workspaceId={workspaceId} portal={portal} />
      )}
      {hasStripeAccount && <BillingInvoices workspaceId={workspaceId} />}
      {hasStripeAccount && (
        <BillingCancelPlan
          workspaceId={workspaceId}
          cancelAtPeriodEnd={ent.cancelAtPeriodEnd}
          currentPeriodEnd={ent.subscription_period_end}
        />
      )}

      <section className="bento px-6 py-5">
        <h2 className="mb-1 text-title font-semibold tracking-tight text-text-primary">
          Account
        </h2>
        <p className="mb-4 text-caption text-text-secondary">
          Deleting your account is permanent, which is why it stays here rather
          than behind a click in the app.
        </p>
        <DeleteAccount />
      </section>
    </>
  );
}
