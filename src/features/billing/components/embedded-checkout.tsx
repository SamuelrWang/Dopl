"use client";

import { apiErrorFrom } from "@/shared/api/api-envelope";
import { userFacingMessage } from "@/shared/api/user-facing-message";
import { useCallback, useEffect, useState } from "react";
import { loadStripe } from "@stripe/stripe-js";
import {
  CheckoutElementsProvider,
  useCheckout,
  PaymentElement,
  type StripeCheckoutValue,
} from "@stripe/react-stripe-js/checkout";
import { Skeleton } from "@/shared/ui/skeleton";
import type { CheckoutPlan } from "../url";
import { checkoutAppearance } from "./checkout-appearance";

/**
 * Lazy singleton, never a module-level read: `process` doesn't exist in the
 * Vite-bundled desktop renderer, so a top-level `process.env.*` is an
 * import-time ReferenceError that whites out the whole SPA (same rule as
 * `@/shared/supabase/browser.ts`).
 */
let stripePromise: ReturnType<typeof loadStripe> | null = null;
function getStripePromise() {
  if (!stripePromise) {
    stripePromise = loadStripe(
      (typeof process !== "undefined" &&
        process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY) ||
        ""
    );
  }
  return stripePromise;
}

/**
 * Native checkout: backend creates a custom-checkout session
 * (`ui_mode: "elements"`), we render its `client_secret` through our own
 * `PaymentElement` + pay button — no Stripe iframe chrome.
 *
 * `plan` is typed `CheckoutPlan` rather than pinned to a string so this form's
 * body and the plans the route accepts (`app/api/billing/checkout › readPlan`)
 * are one union; `solo` answers 400 `PLAN_RETIRED`, and a plan the addressed
 * container cannot buy answers 400 `PLAN_NOT_FOR_CONTAINER`.
 * `workspaceId` → `x-workspace-id`; omitting it makes the server resolve
 * fail-closed from memberships (sole workspace auto-targets; 0 or 2+ →
 * WORKSPACE_REQUIRED).
 */
export function EmbeddedCheckoutForm({
  workspaceId,
  plan,
}: {
  workspaceId?: string;
  plan: CheckoutPlan;
}) {
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [portalUrl, setPortalUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const loadSecret = useCallback(async () => {
    setError(null);
    setPortalUrl(null);
    setLoading(true);
    try {
      const res = await fetch("/api/billing/checkout", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(workspaceId ? { "x-workspace-id": workspaceId } : {}),
        },
        body: JSON.stringify({ plan }),
      });
      if (!res.ok) {
        const errBody: unknown = await res.json().catch(() => ({}));
        // Live-sub 409 ships a portal link; "Try again" would just 409 again.
        const portal = extractPortalUrl(errBody);
        if (portal) setPortalUrl(portal);
        setError(userFacingMessage(apiErrorFrom(res.status, errBody)));
        return;
      }
      const data = await res.json();
      if (!data.clientSecret) {
        setError("Checkout server returned no session — please try again.");
        return;
      }
      setClientSecret(data.clientSecret);
    } catch (err) {
      setError(userFacingMessage(err));
    } finally {
      setLoading(false);
    }
  }, [workspaceId, plan]);

  useEffect(() => {
    loadSecret();
  }, [loadSecret]);

  if (error) {
    return (
      <CheckoutErrorCard
        message={error}
        portalUrl={portalUrl}
        onRetry={() => {
          setClientSecret(null);
          loadSecret();
        }}
      />
    );
  }

  if (loading || !clientSecret) {
    return <CheckoutSkeleton />;
  }

  return (
    <CheckoutElementsProvider
      stripe={getStripePromise()}
      options={{
        clientSecret,
        elementsOptions: { appearance: checkoutAppearance },
      }}
    >
      <CheckoutPaymentForm plan={plan} />
    </CheckoutElementsProvider>
  );
}

function CheckoutPaymentForm({ plan }: { plan: CheckoutPlan }) {
  const result = useCheckout();
  const [confirming, setConfirming] = useState(false);
  const [confirmError, setConfirmError] = useState<string | null>(null);

  if (result.type === "loading") {
    return <CheckoutSkeleton />;
  }
  if (result.type === "error") {
    return <CheckoutErrorCard message={userFacingMessage(result.error)} />;
  }

  const checkout = result.checkout;
  const { planName, summaryDetail, totalLabel } = describeOrder(checkout, plan);

  const handleConfirm = async () => {
    setConfirming(true);
    setConfirmError(null);
    // No args → the session's server-set return_url drives the redirect to
    // `/billing/{segment}?billing=success&session_id=…`, where `billing=success`
    // is the signal to poll for the webhook (`features/billing/url.ts`). Success
    // navigates away, so the button deliberately stays "Processing…".
    const confirmResult = await checkout.confirm();
    if (confirmResult.type === "error") {
      // Stripe's buyer errors are written for the payer ("Your card was declined.").
      setConfirmError(confirmResult.error.message);
      setConfirming(false);
    }
  };

  return (
    <div className="space-y-3.5">
      <div className="flex items-center justify-between gap-3 rounded-lg border border-border-default bg-bg-elevated px-3.5 py-2.5">
        <div className="min-w-0">
          <p className="truncate text-body font-medium text-text-primary">
            {planName}
          </p>
          <p className="truncate text-caption text-text-secondary">
            {summaryDetail}
          </p>
        </div>
        <p className="shrink-0 text-body font-semibold text-text-primary">
          {totalLabel}
        </p>
      </div>

      <PaymentElement />

      {confirmError && <p className="text-caption text-danger">{confirmError}</p>}

      <button
        type="button"
        onClick={handleConfirm}
        disabled={confirming}
        className="auth-btn-3d h-9 w-full rounded-lg text-small font-semibold text-white disabled:cursor-not-allowed disabled:opacity-70"
      >
        {confirming ? "Processing…" : `Subscribe — ${totalLabel}`}
      </button>
    </div>
  );
}

/**
 * The plan's own name, keyed off the plan (2026-09-08) so a `pro` session never
 * renders its price under a Team heading. Not `plans.ts › plansForKind`, which
 * answers a container — this form describes the session it was handed.
 */
const CHECKOUT_PLAN_NAME: Record<CheckoutPlan, string> = {
  team: "Team",
  pro: "Pro",
};

/**
 * Order described from the session, not hardcoded prices: `checkout.total.total`
 * and the first line item already carry Stripe-formatted, localized currency.
 * Exported for its test only — mounting the form needs a live Stripe session,
 * so this is the only place the plan→heading and seat-math branches can be
 * pinned.
 */
export function describeOrder(checkout: StripeCheckoutValue, plan: CheckoutPlan) {
  const item = checkout.lineItems[0];
  const interval = item?.recurring?.interval ?? "month";
  // `amount` is Stripe's pre-formatted currency string (e.g. "$8.99").
  const totalLabel = `${checkout.total.total.amount} / ${interval}`;

  const seats = item?.quantity ?? 1;
  const unitAmount = item?.unitAmount.amount;
  // Seat math on `team` only: `pro` is a flat quantity-1 subscription
  // (`server/stripe.ts`), so "1 seat × $8.99" would name a unit the personal
  // container does not have.
  const summaryDetail =
    plan === "team" && unitAmount
      ? `${seats} ${seats === 1 ? "seat" : "seats"} × ${unitAmount} / ${interval}`
      : `Billed ${intervalAdverb(interval)}`;

  return { planName: CHECKOUT_PLAN_NAME[plan], summaryDetail, totalLabel };
}

function intervalAdverb(interval: string): string {
  switch (interval) {
    case "day":
      return "daily";
    case "week":
      return "weekly";
    case "year":
      return "yearly";
    default:
      return "monthly";
  }
}

function CheckoutSkeleton() {
  return (
    <div className="space-y-3.5" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading checkout</span>
      <Skeleton className="h-[52px] w-full rounded-lg" />
      <div className="space-y-3">
        <Skeleton className="h-10 w-full rounded-lg" />
        <Skeleton className="h-10 w-full rounded-lg" />
        <Skeleton className="h-10 w-full rounded-lg" />
      </div>
      <Skeleton className="h-9 w-full rounded-lg" />
    </div>
  );
}

function CheckoutErrorCard({
  message,
  portalUrl,
  onRetry,
}: {
  message: string;
  portalUrl?: string | null;
  onRetry?: () => void;
}) {
  return (
    <div className="rounded-lg border border-danger/30 bg-danger/5 p-4">
      <h3 className="mb-1 text-body font-medium text-danger">
        Checkout couldn&apos;t load
      </h3>
      <p className="mb-3 text-body text-danger/90">{message}</p>
      {(portalUrl || onRetry) && (
        <div className="flex items-center gap-4">
          {portalUrl && (
            <a
              href={portalUrl}
              className="text-body font-medium text-danger underline underline-offset-2 hover:opacity-80"
            >
              Manage existing subscription
            </a>
          )}
          {onRetry && (
            <button
              onClick={onRetry}
              className="text-body text-danger underline underline-offset-2 hover:opacity-80"
            >
              Try again
            </button>
          )}
        </div>
      )}
    </div>
  );
}


/** Live-sub 409 carries `portalUrl` (flat envelope) — manage-instead-of-recheckout. */
function extractPortalUrl(body: unknown): string | null {
  if (typeof body !== "object" || body === null) return null;
  const url = (body as { portalUrl?: unknown }).portalUrl;
  return typeof url === "string" && url ? url : null;
}
