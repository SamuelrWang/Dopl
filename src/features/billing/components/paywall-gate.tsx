"use client";

import { useApiQuery } from "@/shared/hooks/use-api-query";
import { PaywallModal } from "./paywall-modal";

/**
 * Mounted at the root of authenticated surfaces (canvas). Re-checks
 * /api/billing/access once per minute via the query layer. When access
 * is denied (trial expired, never started), it shows the paywall modal
 * as a blocking overlay. Never blocks on a failed fetch.
 */
export function PaywallGate() {
  const query = useApiQuery<{ allowed: boolean }>("/api/billing/access", {
    refetchInterval: 60_000,
  });
  const blocked = query.data ? !query.data.allowed : false;
  return <PaywallModal open={blocked} />;
}
