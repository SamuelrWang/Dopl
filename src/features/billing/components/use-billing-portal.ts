"use client";

import { useState } from "react";

/**
 * THE Stripe billing portal handoff, one place. Two surfaces reach it (plans
 * pane "Manage billing"/"Update payment method", payment-method card
 * "Update"). Same-tab redirect, web-side only — desktop does its own
 * `openExternal`.
 *
 * ⚠ Route's error body is FLAT (`{error: "…"}`, legacy shape) while the auth
 * wrapper's is nested; both are read here since the caller cannot tell which
 * layer refused.
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
