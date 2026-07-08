"use client";

import { useState } from "react";
import { Button } from "@/shared/ui/button";
import { EmbeddedCheckoutForm } from "./embedded-checkout";

interface Props {
  open: boolean;
  onClose?: () => void;
}

/**
 * Shown when hasActiveAccess() returns expired or never_started.
 * Single CTA — subscribe to $7.99/mo Pro, via the embedded Stripe
 * checkout rendered in place (it fetches its own session).
 */
export function PaywallModal({ open, onClose }: Props) {
  const [showCheckout, setShowCheckout] = useState(false);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-scrim p-4">
      <div
        className="w-full max-w-md rounded-2xl bg-[var(--panel-surface,#0a0a0a)] border border-border-default p-6 max-h-[85vh] overflow-y-auto"
        style={{
          boxShadow:
            "0 12px 40px rgba(0,0,0,0.5), inset 0 1px 0 var(--hairline-shine)",
        }}
      >
        {showCheckout ? (
          <>
            <button
              type="button"
              onClick={() => setShowCheckout(false)}
              className="mb-3 text-sm text-text-tertiary hover:text-text-secondary transition-colors"
            >
              &larr; Back
            </button>
            <EmbeddedCheckoutForm />
          </>
        ) : (
          <>
            <h2 className="text-xl font-semibold text-text-primary">
              Your free trial has ended
            </h2>
            <p className="mt-2 text-sm text-text-tertiary leading-relaxed">
              Subscribe for <strong className="text-text-secondary">$7.99/mo</strong> to
              keep using Dopl — unlimited ingestion, MCP access, canvas, and
              cluster sync.
            </p>

            <div className="mt-5 flex gap-2">
              <Button
                size="lg"
                className="flex-1 cursor-pointer"
                onClick={() => setShowCheckout(true)}
              >
                Subscribe — $7.99/mo
              </Button>
              {onClose ? (
                <Button
                  variant="outline"
                  size="lg"
                  className="cursor-pointer"
                  onClick={onClose}
                >
                  Close
                </Button>
              ) : null}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
