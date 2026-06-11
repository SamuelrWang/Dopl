"use client";

import { useEffect, useRef, useState } from "react";

const POLL_INTERVAL_MS = 3500;

/**
 * Poll GET /api/onboarding/mcp-status until an active MCP OAuth token
 * shows up for the signed-in user. Stops itself once connected (or on
 * unmount). `enabled` lets the connect step pause polling after the
 * user skips.
 */
export function useMcpConnectionPoll(enabled: boolean): boolean {
  const [connected, setConnected] = useState(false);
  const connectedRef = useRef(false);

  useEffect(() => {
    if (!enabled || connectedRef.current) return;
    let cancelled = false;

    async function check() {
      try {
        const res = await fetch("/api/onboarding/mcp-status", {
          cache: "no-store",
        });
        if (!res.ok) return;
        const body = (await res.json()) as { connected?: boolean };
        if (body.connected && !cancelled) {
          connectedRef.current = true;
          setConnected(true);
        }
      } catch {
        // Transient network failure — next tick retries.
      }
    }

    void check();
    const timer = setInterval(() => {
      if (connectedRef.current) {
        clearInterval(timer);
        return;
      }
      void check();
    }, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [enabled]);

  return connected;
}
