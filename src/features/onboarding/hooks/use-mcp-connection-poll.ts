"use client";

import { useEffect, useRef, useState } from "react";
import { apiRequest } from "@/shared/api/api-client";

const POLL_INTERVAL_MS = 3500;

/**
 * Poll GET /api/onboarding/mcp-status until the signed-in user has an active
 * MCP OAuth token. Self-stops on connect/unmount; `enabled` pauses it on skip.
 *
 * ⚠ `apiRequest`, not `fetch` — packaged desktop renderer ships
 * `connect-src 'none'` and rides the IPC transport. Route is `force-dynamic`
 * with no cache-control, so no `cache: "no-store"` is needed.
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
        // Transient failure — next tick retries.
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
