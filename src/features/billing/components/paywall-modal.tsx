"use client";

import { useEffect, useState } from "react";

interface Props {
  open: boolean;
  onClose?: () => void;
}

/**
 * Shown when hasActiveAccess() returns expired or never_started.
 * Single CTA — subscribe to $7.99/mo Pro. No tier selection, no credits UI.
 */
export function PaywallModal({ open, onClose }: Props) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) setError(null);
  }, [open]);

  if (!open) return null;

  async function handleSubscribe() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/billing/checkout", { method: "POST" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Checkout failed (${res.status})`);
      }
      const { clientSecret } = await res.json();
      // Hand off to the embedded-checkout component / billing page. We
      // redirect to a dedicated checkout route with the secret in the URL
      // fragment so it doesn't hit the server.
      window.location.href = `/settings/billing?checkout=${encodeURIComponent(clientSecret)}`;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-md rounded-lg bg-white p-6 shadow-xl">
        <h2 className="text-xl font-semibold">Your free trial has ended</h2>
        <p className="mt-2 text-sm text-gray-600">
          Subscribe for <strong>$7.99/mo</strong> to keep using Dopl — unlimited
          ingestion, MCP access, canvas, and cluster sync.
        </p>

        {error ? (
          <p className="mt-3 rounded bg-red-50 p-2 text-sm text-red-700">
            {error}
          </p>
        ) : null}

        <div className="mt-5 flex gap-2">
          <button
            onClick={handleSubscribe}
            disabled={loading}
            className="flex-1 rounded bg-black px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
          >
            {loading ? "Loading…" : "Subscribe — $7.99/mo"}
          </button>
          {onClose ? (
            <button
              onClick={onClose}
              disabled={loading}
              className="rounded border px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            >
              Close
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
