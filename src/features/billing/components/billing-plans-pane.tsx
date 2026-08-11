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
 * BILLING — money, top to bottom, in the order the questions get asked.
 *
 *   1. What am I on, and what else is there  → the shipped `PlansBilling` pane
 *   2. What is it charging                   → the card on file
 *   3. What has it charged                   → invoices
 *   4. How do I stop                         → cancel (or resume)
 *   5. How do I leave entirely               → delete account
 *
 * THREE OF THOSE FIVE ARE ADMIN-ONLY AND STRIPE-ONLY, and both halves of that
 * gate are load-bearing. `canManage` keeps a member from firing two routes that
 * would answer 403; `has_stripe_customer` keeps a free workspace from rendering
 * an empty card and an empty invoice table — it has no Stripe customer, so
 * there is genuinely nothing to show, and a "no invoices yet" box on a Starter
 * workspace reads as a bug.
 *
 * DELETE ACCOUNT STAYS LAST, on this tab. It is account-level rather than
 * workspace-level, and the desktop app links out to this page specifically to
 * reach it (`apps/desktop-ui/.../account-actions.tsx`, plan D4) — so it may not
 * move to the Usage tab, where nobody arriving from that link would look.
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
  /** Passed straight through from `PlansBilling` to the tab shell, which
   *  disables the tab switcher while Stripe's card form is mounted — switching
   *  tabs unmounts this pane and takes the half-entered card with it. */
  onCheckoutOpenChange?: (open: boolean) => void;
}) {
  // Same args as the panes below → one cache entry, one request.
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
