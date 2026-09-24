"use client";

import { apiErrorFrom } from "@/shared/api/api-envelope";
import { userFacingMessage } from "@/shared/api/user-facing-message";
import { useState } from "react";

/**
 * The Stripe billing portal handoff, one place — reached from the plans pane and
 * the payment-method card. Same-tab redirect, web-side only; desktop does its
 * own `openExternal`.
 *
 * The route's error body is flat (`{error: "…"}`, legacy shape) while the auth
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
      if (!res.ok) throw apiErrorFrom(res.status, data);
      if (!data.url) throw new Error("no portal url");
      window.location.href = data.url;
    } catch (err) {
      setError(userFacingMessage(err, "Couldn't open billing portal"));
    } finally {
      setLoading(false);
    }
  }

  return { open, loading, error };
}
