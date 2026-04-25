"use client";

import { useEffect, useState } from "react";
import { Button } from "@/shared/ui/button";

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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4">
      <div
        className="w-full max-w-md rounded-2xl bg-[var(--panel-surface,#0a0a0a)] border border-white/[0.08] p-6"
        style={{
          boxShadow:
            "0 12px 40px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.06)",
        }}
      >
        <h2 className="text-xl font-semibold text-white/95">
          Your free trial has ended
        </h2>
        <p className="mt-2 text-sm text-white/60 leading-relaxed">
          Subscribe for <strong className="text-white/85">$7.99/mo</strong> to
          keep using Dopl — unlimited ingestion, MCP access, canvas, and
          cluster sync.
        </p>

        {error ? (
          <p className="mt-3 rounded-[4px] border border-red-500/20 bg-red-500/10 px-3 py-2 text-sm text-red-300">
            {error}
          </p>
        ) : null}

        <div className="mt-5 flex gap-2">
          <Button
            size="lg"
            className="flex-1 cursor-pointer"
            onClick={handleSubscribe}
            disabled={loading}
          >
            {loading ? "Loading…" : "Subscribe — $7.99/mo"}
          </Button>
          {onClose ? (
            <Button
              variant="outline"
              size="lg"
              className="cursor-pointer"
              onClick={onClose}
              disabled={loading}
            >
              Close
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
