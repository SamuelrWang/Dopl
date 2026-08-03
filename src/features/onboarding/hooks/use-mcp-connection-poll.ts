"use client";

import { useEffect, useRef, useState } from "react";
import { apiRequest } from "@/shared/api/api-client";

const POLL_INTERVAL_MS = 3500;

/**
 * Poll GET /api/onboarding/mcp-status until an active MCP OAuth token
 * shows up for the signed-in user. Stops itself once connected (or on
 * unmount). `enabled` lets the connect step pause polling after the
 * user skips.
 *
 * Goes through `apiRequest` rather than `fetch` so the desktop SPA's
 * onboarding port rides the IPC transport (the packaged renderer ships
 * `connect-src 'none'`). The route is `force-dynamic` and sends no
 * cache-control, so dropping the old `cache: "no-store"` changes nothing
 * on the web.
 */
export function useMcpConnectionPoll(enabled: boolean): boolean {
  const [connected, setConnected] = useState(false);
  const connectedRef = useRef(false);

  useEffect(() => {
    if (!enabled || connectedRef.current) return;
    let cancelled = false;

    async function check() {
      try {
        const body = await apiRequest<{ connected?: boolean }>(
          "/api/onboarding/mcp-status"
        );
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
