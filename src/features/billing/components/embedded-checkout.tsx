"use client";

import { useCallback, useEffect, useState } from "react";
import { loadStripe } from "@stripe/stripe-js";
import {
  CheckoutElementsProvider,
  useCheckout,
  PaymentElement,
  type StripeCheckoutValue,
} from "@stripe/react-stripe-js/checkout";
import { Skeleton } from "@/shared/ui/skeleton";
import { checkoutAppearance } from "./checkout-appearance";

const stripePromise = loadStripe(
  process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY!
);

/**
 * Native checkout for a paid plan. The backend creates a custom-checkout
 * session (`ui_mode: "elements"`) and we render its `client_secret` through
 * our own design-system-styled `PaymentElement` + pay button — no Stripe
 * iframe chrome. `plan` picks the price the backend sells: "solo" ($5.99
 * flat, single-member workspaces only — the server 409s
 * SOLO_REQUIRES_SINGLE_MEMBER otherwise) or "team" ($7.99 per seat).
 * `workspaceId` scopes the checkout to the workspace being upgraded (sent as
 * `x-workspace-id`); omitting it makes the server resolve fail-closed from
 * memberships (a sole workspace auto-targets; 0 or 2+ → WORKSPACE_REQUIRED).
 *
 * Self-contained: mounts inside the upgrade modal or the settings modal with
 * no page assumptions, and stays max-width friendly.
 */
export function EmbeddedCheckoutForm({
  workspaceId,
  plan,
}: {
  workspaceId?: string;
  plan: "solo" | "team";
}) {
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [portalUrl, setPortalUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Preserve the original client-secret fetch flow: POST /api/billing/checkout
  // with `{plan}` + optional `x-workspace-id`, parse either error envelope,
  // and surface the portal-link escape hatch on the live-sub 409.
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
        // The "already has an active subscription" 409 ships a portal
        // link — surface it, since "Try again" would just 409 again.
        const portal = extractPortalUrl(errBody);
        if (portal) setPortalUrl(portal);
        setError(
          extractErrorMessage(errBody) || `Checkout failed (HTTP ${res.status})`
        );
        return;
      }
      const data = await res.json();
      if (!data.clientSecret) {
        setError("Checkout server returned no session — please try again.");
        return;
      }
      setClientSecret(data.clientSecret);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Checkout failed");
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
      stripe={stripePromise}
      options={{
        clientSecret,
        elementsOptions: { appearance: checkoutAppearance },
      }}
    >
      <CheckoutPaymentForm plan={plan} />
    </CheckoutElementsProvider>
  );
}

/**
 * The payment form once the session exists. Reads the initialized checkout
 * from `useCheckout()`, renders a compact order summary derived from the
 * session's own total/line item, the `PaymentElement`, and a full-width pay
 * button that calls `checkout.confirm()`.
 */
function CheckoutPaymentForm({ plan }: { plan: "solo" | "team" }) {
  const result = useCheckout();
  const [confirming, setConfirming] = useState(false);
  const [confirmError, setConfirmError] = useState<string | null>(null);

  if (result.type === "loading") {
    return <CheckoutSkeleton />;
  }
  if (result.type === "error") {
    return <CheckoutErrorCard message={result.error.message} />;
  }

  const checkout = result.checkout;
  const { planName, summaryDetail, totalLabel } = describeOrder(checkout, plan);

  const handleConfirm = async () => {
    setConfirming(true);
    setConfirmError(null);
    // No args → the session's server-set return_url drives the post-payment
    // redirect (the app shell handles `/canvas?billing=success`). A successful
    // card confirm typically redirects the page — that is the intended flow,
    // so we leave the button in its "Processing…" state on success.
    const confirmResult = await checkout.confirm();
    if (confirmResult.type === "error") {
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
 * Describe the order from the session itself rather than hardcoding prices:
 * the plan total (`checkout.total.total`) and the first line item (seat
 * quantity + per-seat unit amount) already carry Stripe-formatted, localized
 * currency strings.
 */
function describeOrder(checkout: StripeCheckoutValue, plan: "solo" | "team") {
  const item = checkout.lineItems[0];
  const interval = item?.recurring?.interval ?? "month";
  // `amount` is Stripe's pre-formatted currency string (e.g. "$5.99").
  const totalLabel = `${checkout.total.total.amount} / ${interval}`;
  const planName = plan === "solo" ? "Solo Pro" : "Team";

  const seats = item?.quantity ?? 1;
  const unitAmount = item?.unitAmount.amount;
  const summaryDetail =
    plan === "team" && unitAmount
      ? `${seats} ${seats === 1 ? "seat" : "seats"} × ${unitAmount} / ${interval}`
      : `Billed ${intervalAdverb(interval)}`;

  return { planName, summaryDetail, totalLabel };
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

/** Skeleton matching the checkout shape (summary + fields + pay button) —
 *  `animate-pulse` on `surface-raised-2` via the shared `Skeleton` primitive. */
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

/**
 * Shared error card — surfaced both when the client-secret fetch fails
 * (optional portal link + retry) and when Stripe fails to initialize the
 * checkout from the secret (message only).
 */
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

/**
 * Pull a human-readable message from either error envelope the billing
 * routes emit: flat `{ error: "CODE" | "text", message? }` (checkout
 * 409s) or nested `{ error: { code, message } }` (HttpError.toResponseBody).
 */
function extractErrorMessage(body: unknown): string | null {
  if (typeof body !== "object" || body === null) return null;
  const env = body as {
    error?: { message?: unknown } | string;
    message?: unknown;
  };
  if (typeof env.message === "string" && env.message) return env.message;
  if (typeof env.error === "string" && env.error) return env.error;
  if (
    typeof env.error === "object" &&
    env.error !== null &&
    typeof env.error.message === "string" &&
    env.error.message
  ) {
    return env.error.message;
  }
  return null;
}

/** The live-sub 409 carries `portalUrl` (flat envelope) — the escape
 *  hatch to manage the existing subscription instead of re-checkout. */
function extractPortalUrl(body: unknown): string | null {
  if (typeof body !== "object" || body === null) return null;
  const url = (body as { portalUrl?: unknown }).portalUrl;
  return typeof url === "string" && url ? url : null;
}
