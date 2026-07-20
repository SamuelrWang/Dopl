"use client";

import { useCallback, useEffect, useState } from "react";
import { loadStripe } from "@stripe/stripe-js";
import {
  EmbeddedCheckoutProvider,
  EmbeddedCheckout,
} from "@stripe/react-stripe-js";

const stripePromise = loadStripe(
  process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY!
);

/**
 * Embedded Stripe checkout for a paid plan. `plan` picks the price the
 * backend sells: "solo" ($5.99 flat, single-member workspaces only —
 * the server 409s SOLO_REQUIRES_SINGLE_MEMBER otherwise) or "team"
 * ($7.99 per seat). `workspaceId` scopes the checkout to the workspace
 * being upgraded (sent as `x-workspace-id`); omitting it makes the
 * server resolve fail-closed from memberships (a sole workspace
 * auto-targets; 0 or 2+ → WORKSPACE_REQUIRED).
 */
export function EmbeddedCheckoutForm({
  workspaceId,
  plan,
}: {
  workspaceId?: string;
  plan: "solo" | "team";
}) {
  const [error, setError] = useState<string | null>(null);
  const [portalUrl, setPortalUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchClientSecret = useCallback(async () => {
    setError(null);
    setPortalUrl(null);
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
        const msg =
          extractErrorMessage(errBody) || `Checkout failed (HTTP ${res.status})`;
        setError(msg);
        throw new Error(msg);
      }
      const data = await res.json();
      if (!data.clientSecret) {
        const msg = "Checkout server returned no session — please try again.";
        setError(msg);
        throw new Error(msg);
      }
      setLoading(false);
      return data.clientSecret;
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Checkout failed";
      setError(msg);
      setLoading(false);
      throw err;
    }
  }, [workspaceId, plan]);

  useEffect(() => {
    setError(null);
    setLoading(true);
  }, []);

  if (error) {
    return (
      <div className="rounded-lg border border-danger/30 bg-danger/5 p-4">
        <h3 className="mb-1 text-body font-medium text-danger">
          Checkout couldn&apos;t load
        </h3>
        <p className="mb-3 text-body text-danger/90">{error}</p>
        <div className="flex items-center gap-4">
          {portalUrl && (
            <a
              href={portalUrl}
              className="text-body font-medium text-danger underline underline-offset-2 hover:opacity-80"
            >
              Manage existing subscription
            </a>
          )}
          <button
            onClick={() => {
              setError(null);
              setPortalUrl(null);
              setLoading(true);
            }}
            className="text-body text-danger underline underline-offset-2 hover:opacity-80"
          >
            Try again
          </button>
        </div>
      </div>
    );
  }

  return (
    <div id="checkout" className="relative min-h-[200px]">
      {loading && (
        <div className="absolute inset-0 flex items-center justify-center text-small text-text-muted">
          Loading checkout…
        </div>
      )}
      <EmbeddedCheckoutProvider
        stripe={stripePromise}
        options={{ fetchClientSecret }}
      >
        <EmbeddedCheckout />
      </EmbeddedCheckoutProvider>
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
