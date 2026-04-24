"use client";

import { useEffect, useState } from "react";
import { PaywallModal } from "./paywall-modal";

/**
 * Mounted at the root of authenticated surfaces (canvas). Polls
 * /api/billing/access once per minute. When access is denied (trial
 * expired, never started), it shows the paywall modal as a blocking
 * overlay. No credits, no tier copy — subscribe or bounce.
 */
export function PaywallGate() {
  const [blocked, setBlocked] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function check() {
      try {
        const res = await fetch("/api/billing/access");
        if (!res.ok) return;
        const data = await res.json();
        if (cancelled) return;
        setBlocked(!data.allowed);
      } catch {
        // Silent — never block on transient fetch failure.
      }
    }

    check();
    const interval = window.setInterval(check, 60_000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, []);

  return <PaywallModal open={blocked} />;
}
