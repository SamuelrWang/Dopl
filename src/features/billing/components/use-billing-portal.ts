"use client";

import { useState } from "react";

/**
 * THE Stripe billing portal handoff, in one place.
 *
 * Two surfaces on this page reach the hosted portal — the plans pane's "Manage
 * billing" / "Update payment method" and the payment-method card's "Update" —
 * and they were about to hand-roll the same POST + redirect twice. The portal
 * is a same-tab redirect on the web (the desktop binding does its own
 * `openExternal`, which is why this hook is web-side only).
 *
 * The route's error body is FLAT (`{error: "…"}`, a legacy shape predating the
 * nested envelope), while the auth wrapper's is nested — so both are read here,
 * because the caller cannot tell which layer refused.
 */
export interface BillingPortal {
  open: () => Promise<void>;
  loading: boolean;
  error: string | null;
}

export function useBillingPortal(workspaceId?: string): BillingPortal {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function open() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/billing/portal", {
        method: "POST",
        headers: workspaceId ? { "x-workspace-id": workspaceId } : undefined,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.url) {
        const message =
          typeof data.error === "string"
            ? data.error
            : typeof data.error?.message === "string"
              ? data.error.message
              : "Couldn't open billing portal";
        throw new Error(message);
      }
      window.location.href = data.url;
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Couldn't open billing portal"
      );
    } finally {
      setLoading(false);
    }
  }

  return { open, loading, error };
}
