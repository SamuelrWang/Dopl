/**
 * CreditBadge — shows the user's credit balance in the panel header.
 *
 * Mirrors the main-site CreditBadge (src/components/layout/header.tsx).
 * Refetches on visibilitychange so balance stays fresh without polling.
 */

import { useCallback, useEffect, useState } from "react";
import { useBgMessage } from "../hooks/useBgMessage";
import type { CreditsSnapshot } from "@/background/api-client";

const PRICING_URL = "https://usedopl.com/pricing";

export function CreditBadge() {
  const { send } = useBgMessage();
  const [balance, setBalance] = useState<number | null>(null);

  const refresh = useCallback(async () => {
    try {
      const snap = await send<CreditsSnapshot>({ type: "GET_CREDITS" });
      if (snap && typeof snap.balance === "number") {
        setBalance(snap.balance);
      }
    } catch {
      // Don't render badge on failure.
    }
  }, [send]);

  useEffect(() => {
    void refresh();
    const onVisibility = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [refresh]);

  if (balance === null) return null;

  return (
    <button
      type="button"
      onClick={() => chrome.tabs.create({ url: PRICING_URL })}
      title="Credits remaining this cycle — click to manage"
      className="flex items-center gap-1 px-2 py-0.5 rounded-full font-mono text-[10px]
        uppercase tracking-wide text-[var(--text-muted)] hover:text-[var(--text-secondary)]
        transition-colors cursor-pointer"
    >
      <svg
        width="9"
        height="9"
        viewBox="0 0 16 16"
        fill="currentColor"
        aria-hidden
      >
        <circle cx="8" cy="8" r="7" fill="none" stroke="currentColor" strokeWidth="1.5" />
        <text x="8" y="11" textAnchor="middle" fontSize="9" fontWeight="bold" fill="currentColor">C</text>
      </svg>
      {balance}
    </button>
  );
}
