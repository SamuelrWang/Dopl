"use client";

import { CreditCard } from "lucide-react";
import { SkeletonLine } from "@/shared/ui/skeleton";
import { formatCardExpiry, formatCardLabel } from "../billing-account";
import { useWorkspacePaymentMethod } from "./use-billing-account";
import type { BillingPortal } from "./use-billing-portal";

/**
 * Card on file. READ HERE, EDIT IN STRIPE — showing brand/last4/expiry needs no
 * PCI surface of our own; "Update" is the hosted-portal handoff.
 *
 * Rendered by `billing-plans-pane.tsx` only for a paid workspace with a Stripe
 * customer, so `null` = Stripe has no card for an existing customer.
 *
 * ⚠ Error branch checked BEFORE the empty one: "No card on file" is a
 * MEASUREMENT; a read that threw measured nothing. Retry, not the portal —
 * nothing here says the portal would work either.
 */
export function BillingPaymentMethod({
  workspaceId,
  portal,
}: {
  workspaceId: string;
  portal: BillingPortal;
}) {
  const { paymentMethod, loading, isError, retry } = useWorkspacePaymentMethod(
    workspaceId,
    true
  );
  const expiry = paymentMethod ? formatCardExpiry(paymentMethod) : null;

  return (
    <section className="bento px-6 py-5">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-title font-semibold tracking-tight text-text-primary">
          Payment method
        </h2>
        <button
          type="button"
          disabled={portal.loading}
          onClick={() => void portal.open()}
          className="btn-light flex h-8 cursor-pointer items-center justify-center rounded-lg px-4 text-small font-medium text-text-primary disabled:cursor-default disabled:opacity-50"
        >
          Update
        </button>
      </div>

      {loading ? (
        <div className="mt-4 space-y-2.5" role="status" aria-busy="true">
          <span className="sr-only">Loading payment method</span>
          <SkeletonLine w="46%" h={12} />
          <SkeletonLine w="28%" />
        </div>
      ) : isError ? (
        <p className="mt-4 text-caption text-danger" role="alert">
          Couldn&apos;t load the payment method.{" "}
          <button
            type="button"
            onClick={() => void retry()}
            className="cursor-pointer font-medium underline underline-offset-2 hover:text-text-primary"
          >
            Retry
          </button>
        </p>
      ) : paymentMethod ? (
        <div className="mt-4 flex items-center gap-3">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg border border-border-strong bg-bg-inset text-text-secondary">
            <CreditCard size={14} />
          </span>
          <div>
            <div className="text-body font-medium text-text-primary">
              {formatCardLabel(paymentMethod)}
            </div>
            {/* No expiry from Stripe → no line; "00 / 0" is not a date. */}
            {expiry && (
              <div className="text-caption text-text-secondary">
                Expires {expiry}
              </div>
            )}
          </div>
        </div>
      ) : (
        <p className="mt-4 text-caption text-text-secondary">
          No card on file. Add one in the Stripe billing portal — Update opens
          it.
        </p>
      )}

      {portal.error && (
        <p className="mt-3 text-caption text-danger">{portal.error}</p>
      )}
    </section>
  );
}
