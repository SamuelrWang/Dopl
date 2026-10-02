"use client";

import { useEffect, useRef, useState } from "react";
import { apiRequest } from "@/shared/api/api-client";

const POLL_INTERVAL_MS = 3500;
/** ⚠ Backoff ceiling for a FAILING poll — the bound, not a tuning knob. */
const POLL_MAX_INTERVAL_MS = 60_000;

/**
 * 3.5s doubling to 60s. ⚠ The FIRST failure keeps 3.5s so a blip recovers fast.
 * Same convention as `dopl-desktop-app/main/listener-heal.js › listRetryDelay`.
 */
function backoffMs(consecutiveFailures: number): number {
  if (consecutiveFailures <= 0) return POLL_INTERVAL_MS;
  return Math.min(
    POLL_MAX_INTERVAL_MS,
    POLL_INTERVAL_MS * 2 ** Math.min(consecutiveFailures - 1, 10)
  );
}

/**
 * Poll GET /api/onboarding/mcp-status until the signed-in user has an active
 * MCP OAuth token. Self-stops on connect/unmount; `enabled` pauses it on skip.
 *
 * ⚠ `apiRequest`, not `fetch` — the packaged renderer has `connect-src 'none'`
 * and rides IPC.
 *
 * ⚠ SELF-SCHEDULING, NOT `setInterval` (2026-08-30 desktop abort-churn incident):
 * a 3.5s interval under a 30s IPC timeout stacked ~9 doomed requests per window
 * against a slow API — an amplifier. Chaining off SETTLEMENT caps in-flight at one.
 *
 * ⚠ AND IT BACKS OFF: a fast-failing server (401 storm) is still hammered by an
 * in-flight guard alone. Failures double the delay to 60s; a success resets it.
 */
export function useMcpConnectionPoll(enabled: boolean): boolean {
  const [connected, setConnected] = useState(false);
  const connectedRef = useRef(false);

  useEffect(() => {
    if (!enabled || connectedRef.current) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let failures = 0;

    async function check() {
      try {
        const body = await apiRequest<{ connected?: boolean }>(
          "/api/onboarding/mcp-status"
        );
        failures = 0;
        if (body.connected && !cancelled) {
          connectedRef.current = true;
          setConnected(true);
        }
      } catch {
        // Transient failure — the next tick retries, further out each time.
        failures += 1;
      }
    }

    // ⚠ Scheduled from settlement, so `check()` never overlaps itself.
    const run = async () => {
      await check();
      if (cancelled || connectedRef.current) return;
      timer = setTimeout(run, backoffMs(failures));
    };
    void run();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [enabled]);

  return connected;
}
